package com.golfroundtracker.app;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Android half of the `WatchBridge` Capacitor plugin.
 *
 * Implements the SAME five methods and three events as
 * `ios/App/WatchBridgePlugin.swift`, so `src/services/watchBridge.ts` and
 * everything above it — `useWatchSync`, `usePracticeWatchSync`, the
 * `WatchRoundState` shape, the inbound message union — run unchanged on both
 * platforms. That equivalence is the whole design: the TypeScript layer was
 * already platform-neutral, gated in exactly one place, and this is what
 * un-gates it.
 *
 * WHERE THE TWO PLATFORMS GENUINELY DIFFER, and what is done about it:
 *
 *   • ACTIVATION. WCSession has an explicit activate/activationDidComplete
 *     handshake. The Data Layer has none — Play services is either present or
 *     not. `activate()` therefore reports capability presence instead, and
 *     emits `activationDidComplete` so the JS listener fires on both platforms.
 *
 *   • REACHABILITY. `WCSession.isReachable` means "the watch app is running and
 *     in front of the user". Wear's nearest equivalent is "a node with our
 *     capability is connected", which is TRUE while the watch app is merely
 *     installed and the watch is in Bluetooth range. So Android's `isReachable`
 *     is more optimistic than iOS's by construction. Callers already treat it as
 *     a hint (the phone pushes state regardless), which is why that is safe.
 *
 *   • LAUNCHING. iOS has `HKHealthStore.startWatchApp`. Wear has no
 *     phone-initiated launch that works without the watch app already running a
 *     listener, so `launchWatch` sends a COMMAND and the watch's
 *     WearableListenerService starts the activity. That means it works only if
 *     the app is installed; it resolves `{launched:false}` otherwise rather than
 *     throwing, matching the iOS contract.
 */
@CapacitorPlugin(name = "WatchBridge")
public class WatchBridge extends Plugin {

    /**
     * The live plugin, for {@link PhoneWearListenerService} to hand messages to.
     *
     * A WearableListenerService is constructed by the system as its own
     * component and has no route to a Capacitor plugin instance. A static
     * reference is the pragmatic bridge; it is cleared on destroy, and a message
     * arriving while the WebView is gone is DROPPED rather than queued. That is
     * acceptable only because Phase 1 carries nothing from the watch that must
     * survive — recorded shots, which must, land in Phase 2 as data items,
     * which persist until read.
     */
    private static WatchBridge instance;

    /**
     * Nodes running OUR watch app — the ones worth sending to.
     *
     * Not filtered on `isNearby()`. That was the first version and it is too
     * strict: a node reachable over the cloud, or a paired emulator (which
     * commonly reports itself as not nearby), can still receive data items
     * perfectly well. Nearby is asked about separately, and only to answer
     * `isReachable`.
     */
    private final Set<String> appNodes = Collections.synchronizedSet(new HashSet<>());

    /** Subset of the above that is physically close — the `isReachable` answer. */
    private final Set<String> nearbyAppNodes = Collections.synchronizedSet(new HashSet<>());

    private CapabilityClient.OnCapabilityChangedListener capabilityListener;

    /**
     * Set once Play services says the Wearable API does not exist here.
     *
     * WHAT THAT ACTUALLY MEANS: the Data Layer is not merely "no watch paired",
     * it is not installed. Wearable.API is delivered with the Wear OS companion
     * app (com.google.android.wearable.app), so a phone that has never had it —
     * most emulators, and any phone whose owner has never set up a watch —
     * fails EVERY call with API_UNAVAILABLE, permanently, no matter what is
     * paired later.
     *
     * It has to be latched. Without it `sendState` re-attempts on every state
     * change — several times a minute for a whole round — and each failure logs
     * a twenty-line stack trace for a condition that cannot change while the app
     * is running. This is the exact equivalent of iOS's
     * `WCSession.isSupported() == false`, and the plugin now answers the same
     * way: supported:false, and every method a quiet no-op.
     */
    private volatile boolean wearableUnavailable = false;

    static WatchBridge current() {
        return instance;
    }

    /**
     * True when the failure is "this device has no Data Layer", as opposed to a
     * transient error worth retrying.
     */
    private boolean isApiUnavailable(Throwable err) {
        if (!(err instanceof ApiException)) return false;
        int code = ((ApiException) err).getStatusCode();
        return code == CommonStatusCodes.API_NOT_CONNECTED
            || code == ConnectionResult.API_UNAVAILABLE;
    }

    /** Latch it, and tell JS the same thing iOS says when WCSession is absent. */
    private void markUnavailable(Throwable err) {
        if (wearableUnavailable) return;
        wearableUnavailable = true;
        appNodes.clear();
        nearbyAppNodes.clear();
        android.util.Log.i(
            "WatchBridge",
            "Wearable API unavailable on this device — watch features off. "
                + "This phone has no Wear OS companion app (com.google.android.wearable.app); "
                + "the Data Layer ships with it."
        );
        JSObject event = new JSObject();
        event.put("reachable", false);
        notifyListeners("reachabilityChanged", event);
    }

    @Override
    public void load() {
        instance = this;
        // Kept live for the process lifetime so `reachabilityChanged` fires the
        // way the iOS `sessionReachabilityDidChange` delegate does, rather than
        // only when JS happens to ask.
        capabilityListener = new CapabilityClient.OnCapabilityChangedListener() {
            @Override
            public void onCapabilityChanged(@NonNull CapabilityInfo info) {
                updateNodes(info);
            }
        };
        Wearable.getCapabilityClient(getContext())
            .addListener(capabilityListener, WearProtocol.CAPABILITY_WEAR_APP)
            .addOnFailureListener(err -> {
                if (isApiUnavailable(err)) markUnavailable(err);
            });

        refreshCapability(null);

        // Anything the watch recorded while this WebView did not exist is still
        // sitting on the node. Collect it now — see WearQueue for why push
        // alone is not enough.
        WearQueue.drain(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        if (capabilityListener != null) {
            Wearable.getCapabilityClient(getContext()).removeListener(capabilityListener);
            capabilityListener = null;
        }
    }

    /**
     * Ask Play services who is out there, and answer `call` when the result
     * lands. `call` may be null for the load-time refresh.
     */
    private void refreshCapability(final PluginCall call) {
        if (wearableUnavailable) {
            if (call != null) resolveActivation(call, false, false);
            return;
        }
        Task<CapabilityInfo> task = Wearable.getCapabilityClient(getContext())
            .getCapability(WearProtocol.CAPABILITY_WEAR_APP, CapabilityClient.FILTER_REACHABLE);

        task.addOnSuccessListener(info -> {
            updateNodes(info);
            if (call == null) {
                emitActivation(null);
                return;
            }
            // `isPaired` means A WATCH EXISTS, which is not the same as our app
            // being on it — exactly the iOS distinction — so it needs the node
            // list, not the capability list. Asked second so the answer carries
            // both facts.
            Wearable.getNodeClient(getContext())
                .getConnectedNodes()
                .addOnSuccessListener(nodes -> {
                    resolveActivation(call, true, !nodes.isEmpty());
                    emitActivation(null);
                })
                .addOnFailureListener(err2 -> {
                    // Capability worked but the node list did not. Report what
                    // we do know rather than failing the whole call.
                    resolveActivation(call, true, !appNodes.isEmpty());
                    emitActivation(null);
                });
        }).addOnFailureListener(err -> {
            // No Play services, no watch, an emulator without the Wear stack:
            // all of these are "there is no watch here", not a crash.
            if (isApiUnavailable(err)) markUnavailable(err);
            appNodes.clear();
            nearbyAppNodes.clear();
            if (call != null) resolveActivation(call, false, false);
            emitActivation(err.getMessage());
        });
    }

    /**
     * Answer `activate()` in the SHAPE iOS uses.
     *
     * This is the whole reason the phone reported "not connected" against a
     * perfectly working watch: the first version resolved `{supported, paired}`,
     * while every caller reads `isPaired` — so the check was `undefined`, and
     * `Boolean(undefined)` is false, forever. The five keys below are the
     * contract (`WatchBridgeRawPlugin.activate` in watchBridge.ts); a plugin
     * that implements the same METHODS but a different result shape is not the
     * same plugin, and nothing catches it at compile time.
     */
    private void resolveActivation(PluginCall call, boolean supported, boolean paired) {
        JSObject result = new JSObject();
        result.put("supported", supported);
        // 2 = WCSessionActivationStateActivated, so a numeric check reads the
        // same on both platforms.
        result.put("activationState", supported ? 2 : 0);
        // A watch is paired with this phone. Says nothing about our app.
        result.put("isPaired", paired);
        // A node advertises our capability, i.e. the watch app is installed.
        result.put("isWatchAppInstalled", !appNodes.isEmpty());
        // ...and is close enough to talk to right now.
        result.put("isReachable", !nearbyAppNodes.isEmpty());
        call.resolve(result);
    }

    private void updateNodes(CapabilityInfo info) {
        boolean was = !appNodes.isEmpty();
        appNodes.clear();
        nearbyAppNodes.clear();
        for (Node node : info.getNodes()) {
            appNodes.add(node.getId());
            if (node.isNearby()) nearbyAppNodes.add(node.getId());
        }
        android.util.Log.i(
            "WatchBridge",
            "watch nodes: " + appNodes.size() + " with our app, " + nearbyAppNodes.size() + " nearby"
        );
        boolean now = !appNodes.isEmpty();
        if (was != now) {
            JSObject event = new JSObject();
            event.put("reachable", now);
            notifyListeners("reachabilityChanged", event);
        }
    }

    private void emitActivation(String error) {
        JSObject event = new JSObject();
        // 2 = WCSessionActivationStateActivated, so the JS listener's existing
        // numeric check reads the same on both platforms.
        event.put("activationState", error == null ? 2 : 0);
        event.put("error", error);
        notifyListeners("activationDidComplete", event);
    }

    // --- The five methods ----------------------------------------------------

    @PluginMethod
    public void activate(PluginCall call) {
        refreshCapability(call);
    }

    @PluginMethod
    public void isReachable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("reachable", !nearbyAppNodes.isEmpty());
        call.resolve(result);
    }

    @PluginMethod
    public void launchWatch(PluginCall call) {
        boolean startPractice = Boolean.TRUE.equals(call.getBoolean("startPractice", false));
        String command = startPractice
            ? WearProtocol.CMD_START_PRACTICE
            : WearProtocol.CMD_OPEN_ROUND;
        sendCommand(command, call, "launched");
    }

    @PluginMethod
    public void endWatchPractice(PluginCall call) {
        sendCommand(WearProtocol.CMD_END_PRACTICE, call, "sent");
    }

    private void sendCommand(String command, PluginCall call, String resultKey) {
        Set<String> targets = wearableUnavailable ? new HashSet<>() : new HashSet<>(appNodes);
        if (targets.isEmpty()) {
            JSObject result = new JSObject();
            result.put(resultKey, false);
            result.put("reason", "no watch connected");
            call.resolve(result);
            return;
        }
        byte[] payload = ("{\"" + WearProtocol.KEY_COMMAND + "\":\"" + command + "\"}")
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);

        // Fire at every connected node. A phone can legitimately be paired with
        // more than one watch, and there is no way to know which one is on the
        // user's wrist — the watch app itself no-ops if it has nothing to do.
        for (String nodeId : targets) {
            Wearable.getMessageClient(getContext())
                .sendMessage(nodeId, WearProtocol.COMMAND_PATH, payload);
        }
        JSObject result = new JSObject();
        result.put(resultKey, true);
        call.resolve(result);
    }

    @PluginMethod
    public void sendState(PluginCall call) {
        JSObject state = call.getObject("state");
        if (state == null) {
            call.reject("state is required");
            return;
        }
        // Nothing to send to, and nothing that will change. Resolving quietly
        // matches the iOS plugin's behaviour with no paired watch, and stops a
        // round's worth of pushes each logging a stack trace.
        if (wearableUnavailable) {
            call.resolve();
            return;
        }

        PutDataMapRequest request = PutDataMapRequest.create(WearProtocol.ROUND_STATE_PATH);
        request.getDataMap().putString(WearProtocol.KEY_STATE_JSON, state.toString());
        // Data items are deduplicated by content, so an unchanged snapshot would
        // fire no listener on the watch. Usually right — but a resend after the
        // watch app was reinstalled or force-stopped needs to land, and this is
        // what makes every push distinct.
        request.getDataMap().putLong(WearProtocol.KEY_SENT_AT, System.currentTimeMillis());

        PutDataRequest put = request.asPutDataRequest();
        // Round state is worth waking the radio for: a golfer looking at their
        // wrist mid-hole should not see the previous hole's yardage. This is the
        // closest thing the Data Layer has to WCSession's immediate delivery.
        put.setUrgent();

        Wearable.getDataClient(getContext())
            .putDataItem(put)
            .addOnSuccessListener(item -> call.resolve())
            // Deliberately NOT a reject. The iOS `sendState` swallows delivery
            // failures too: the phone pushes on every state change, so the next
            // one is along in seconds, and a rejected promise here would surface
            // as an error toast for something the user cannot act on.
            .addOnFailureListener(err -> {
                if (isApiUnavailable(err)) {
                    markUnavailable(err);
                } else {
                    android.util.Log.w("WatchBridge", "sendState failed", err);
                }
                call.resolve();
            });
    }

    /**
     * Hand a watch event to JS, shaped exactly like the iOS plugin's
     * `messageFromWatch` so the TypeScript parser is shared.
     *
     * `delivery` mirrors the iOS labels: 'live' for something sent while both
     * apps are up (the position stream), 'queued' for something that waited in
     * the durable queue (a recorded shot). `useWatchSync` already treats the
     * two differently.
     */
    void emitRawMessageFromWatch(String json, String delivery) {
        JSObject message;
        try {
            message = new JSObject(json);
        } catch (org.json.JSONException err) {
            android.util.Log.w("WatchBridge", "unparseable message from watch: " + json, err);
            return;
        }
        JSObject event = new JSObject();
        event.put("message", message);
        event.put("delivery", delivery);
        notifyListeners("messageFromWatch", event);
    }
}
