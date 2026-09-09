package com.golfroundtracker.app;

import android.content.Context;
import android.net.Uri;

import com.google.android.gms.wearable.DataItemBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.Wearable;

/**
 * Delivery and acknowledgement for the durable watch → phone event queue.
 *
 * THE CONTRACT, in one sentence: an event data item exists until the WebView has
 * been handed its contents, and deleting it is how we say so.
 *
 * That single rule is what makes a shot recorded on the watch survive the phone
 * being in a pocket with its process killed, out of Bluetooth range, or simply
 * mid-relaunch — the three states a golfer's phone is actually in for most of a
 * round. Delivery is attempted twice, from opposite directions:
 *
 *   • push — {@link PhoneWearListenerService} is started by the system the
 *     moment an item lands, and forwards it if a WebView is alive.
 *   • pull — {@link WatchBridge#load()} drains whatever is still sitting there
 *     when the WebView comes back.
 *
 * Neither alone is sufficient. Push misses everything that arrives while the app
 * is dead; pull alone would hold a shot until the golfer next opened their
 * phone.
 */
final class WearQueue {
    private WearQueue() {}

    /**
     * Give one event to the WebView and delete it, or leave it for the drain.
     *
     * Deliberately does nothing when the plugin is absent. An event left in
     * place is re-read by {@link #drain(Context)}; an event deleted without
     * being delivered is gone for good, and there is no way to tell afterwards
     * that it ever existed.
     */
    static void deliverOrHold(Context context, Uri uri, String json) {
        WatchBridge plugin = WatchBridge.current();
        if (plugin == null) return;
        plugin.emitRawMessageFromWatch(json, "queued");
        acknowledge(context, uri);
    }

    /**
     * Deliver everything the watch has left waiting.
     *
     * Called when the plugin loads. Ordering is whatever the Data Layer returns
     * rather than send order, which is a real difference from watchOS's FIFO
     * `transferUserInfo` queue: two shots recorded seconds apart could arrive
     * reversed. The phone tolerates that already — shots carry their own
     * positions and the reconciler orders by `shot_number`, not by arrival — but
     * anything added to this queue later must not assume sequence.
     */
    static void drain(Context context) {
        Wearable.getDataClient(context)
            .getDataItems(
                new Uri.Builder()
                    .scheme("wear")
                    .path(WearProtocol.FROM_WATCH_QUEUE_PREFIX)
                    .build()
            )
            .addOnSuccessListener(buffer -> {
                try {
                    for (int i = 0; i < buffer.getCount(); i++) {
                        DataMapItem item = DataMapItem.fromDataItem(buffer.get(i));
                        String json = item.getDataMap().getString(WearProtocol.KEY_EVENT_JSON);
                        if (json == null) continue;
                        deliverOrHold(context, item.getUri(), json);
                    }
                } finally {
                    // A DataItemBuffer holds native memory and must be released
                    // explicitly; leaking it is a slow drip, not a crash, which
                    // is exactly the kind that survives testing.
                    releaseQuietly(buffer);
                }
            })
            .addOnFailureListener(err ->
                // Nothing to do about it here: the items are still on the node,
                // and the next load or the next push tries again.
                android.util.Log.w("WearQueue", "could not drain watch events", err)
            );
    }

    /** Delete the item — the acknowledgement. */
    private static void acknowledge(Context context, Uri uri) {
        Wearable.getDataClient(context)
            .deleteDataItems(uri)
            .addOnFailureListener(err ->
                // Left in place, so it will be delivered again on the next
                // drain. A duplicate shot is visible and fixable; a lost one is
                // neither, so this is the right way round to fail.
                android.util.Log.w("WearQueue", "could not acknowledge " + uri, err)
            );
    }

    private static void releaseQuietly(DataItemBuffer buffer) {
        try {
            buffer.release();
        } catch (Throwable ignored) {
            // Released twice, or already closed. Not worth a log line.
        }
    }
}
