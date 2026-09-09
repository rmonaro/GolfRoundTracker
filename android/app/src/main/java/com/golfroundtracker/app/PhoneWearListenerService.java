package com.golfroundtracker.app;

import androidx.annotation.NonNull;

import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;

import java.nio.charset.StandardCharsets;

/**
 * Receives watch → phone traffic and hands it to the Capacitor plugin.
 *
 * Two channels, deliberately different (see {@link WearProtocol}):
 *
 *   • DATA ITEMS under FROM_WATCH_QUEUE_PREFIX — real events (a recorded shot,
 *     a hole change). Durable. This service forwards them, and the plugin
 *     deletes each one only after the WebView has taken it. An event that
 *     arrives with no WebView alive stays on the node and is drained the next
 *     time the app opens; nothing is lost, which is the property a recorded
 *     shot needs and Phase 1 did not have.
 *
 *   • MESSAGES on LIVE_UPDATE_PATH — the live position while tracking. Lossy by
 *     design: each supersedes the last, and one dropped while the phone is out
 *     of range is worth nothing by the time it would arrive.
 *
 * The system starts this service on delivery whether or not the app is in the
 * foreground, which is what lets the durable queue drain promptly instead of
 * waiting for the user to open the app.
 */
public class PhoneWearListenerService extends WearableListenerService {

    @Override
    public void onDataChanged(@NonNull DataEventBuffer events) {
        for (DataEvent event : events) {
            if (event.getType() != DataEvent.TYPE_CHANGED) continue;
            String path = event.getDataItem().getUri().getPath();
            if (path == null || !path.startsWith(WearProtocol.FROM_WATCH_QUEUE_PREFIX)) continue;

            String json = DataMapItem.fromDataItem(event.getDataItem())
                .getDataMap()
                .getString(WearProtocol.KEY_EVENT_JSON);
            if (json == null) continue;

            // Hand it over WITH its uri, so the plugin can delete it as an
            // acknowledgement once JS has actually received it. Deleting here
            // would drop the event whenever the WebView happens to be dead —
            // exactly the case the queue exists for.
            WearQueue.deliverOrHold(this, event.getDataItem().getUri(), json);
        }
    }

    @Override
    public void onMessageReceived(@NonNull MessageEvent event) {
        if (!WearProtocol.LIVE_UPDATE_PATH.equals(event.getPath())) return;
        WatchBridge plugin = WatchBridge.current();
        if (plugin == null) return; // Nothing to update; see the class comment.
        String raw = new String(event.getData(), StandardCharsets.UTF_8);
        plugin.emitRawMessageFromWatch(raw, "live");
    }
}
