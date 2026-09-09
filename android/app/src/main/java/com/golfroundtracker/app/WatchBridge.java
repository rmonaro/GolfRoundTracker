package com.golfroundtracker.app;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
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

    /** Nodes with our capability, refreshed by the listener below. */
    private final Set<String> connectedNodes = Collections.synchronizedSet(new HashSet<>());

    private CapabilityClient.OnCapabilityChangedListener capabilityListener;

    static WatchBridge current() {
        return instance;
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
            .addListener(capabilityListener, WearProtocol.CAPABILITY_WEAR_APP);

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
        Task<CapabilityInfo> task = Wearable.getCapabilityClient(getContext())
            .getCapability(WearProtocol.CAPABILITY_WEAR_APP, CapabilityClient.FILTER_REACHABLE);

        task.addOnSuccessListener(info -> {
            updateNodes(info);
            if (call != null) {
                JSObject result = new JSObject();
                result.put("supported", true);
                result.put("paired", !connectedNodes.isEmpty());
                call.resolve(result);
            }
            emitActivation(null);
        }).addOnFailureListener(err -> {
            // No Play services, no watch, an emulator without the Wear stack:
            // all of these are "there is no watch here", not a crash. The iOS
            // plugin reports `supported:false` the same way when
            // WCSession.isSupported() is false.
            connectedNodes.clear();
            if (call != null) {
                JSObject result = new JSObject();
                result.put("supported", false);
                result.put("paired", false);
                call.resolve(result);
            }
            emitActivation(err.getMessage());
        });
    }

    private void updateNodes(CapabilityInfo info) {
        boolean was = !connectedNodes.isEmpty();
        connectedNodes.clear();
        for (Node node : info.getNodes()) {
            if (node.isNearby()) connectedNodes.add(node.getId());
        }
        boolean now = !connectedNodes.isEmpty();
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
        result.put("reachable", !connectedNodes.isEmpty());
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
        Set<String> targets = new HashSet<>(connectedNodes);
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
                android.util.Log.w("WatchBridge", "sendState failed", err);
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
