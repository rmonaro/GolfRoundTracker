package com.golfroundtracker.app.wear

import android.content.Intent
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * Everything arriving from the phone lands here.
 *
 * Started by the system on delivery, whether or not the watch app is open —
 * which is the property that makes DataClient the right transport for round
 * state. A golfer who raises their wrist mid-hole gets the CURRENT yardage
 * because it was delivered and stored while the screen was off, not because the
 * app woke up and asked.
 */
class PhoneListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            if (event.dataItem.uri.path != WearProtocol.ROUND_STATE_PATH) continue

            val map = DataMapItem.fromDataItem(event.dataItem).dataMap
            val json = map.getString(WearProtocol.KEY_STATE_JSON) ?: continue
            val state = RoundState.fromJson(json)
            RoundStateStore.update(state)

            // The round's lifetime is decided by the PHONE, and it is applied
            // here rather than in the UI on purpose: this service runs whether
            // or not the watch app is open, so a round started on the phone
            // while the watch sits on a wrist with a dark screen still brings
            // the GPS and the exercise session up. Doing it from a composable
            // would mean the round only really began once the user raised their
            // wrist and looked.
            if (state.active) RoundService.start(this) else RoundService.stop(this)
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WearProtocol.COMMAND_PATH) return

        val command = try {
            JSONObject(String(event.data, Charsets.UTF_8))
                .optString(WearProtocol.KEY_COMMAND)
        } catch (err: Throwable) {
            android.util.Log.w("PhoneListener", "unparseable command", err)
            return
        }

        when (command) {
            // The Wear stand-in for HealthKit's startWatchApp. There is no API
            // for a phone to launch a watch app outright; what there is, is a
            // service the system will start on message delivery, which can then
            // start its own Activity. Hence the app must be installed for
            // `launchWatch` to do anything — reflected in the plugin resolving
            // {launched:false} when no capable node is connected.
            WearProtocol.CMD_OPEN_ROUND, WearProtocol.CMD_START_PRACTICE -> {
                val intent = Intent(this, MainActivity::class.java)
                    // Required: there is no Activity on the stack to start from
                    // when the system woke this service directly.
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(EXTRA_START_PRACTICE, command == WearProtocol.CMD_START_PRACTICE)
                startActivity(intent)
            }
            // Phase 4 owns the practice session; accepted and ignored now so the
            // phone's endWatchPractice() is not an error against this build.
            WearProtocol.CMD_END_PRACTICE -> Unit
            else -> android.util.Log.w("PhoneListener", "unknown command: $command")
        }
    }

    companion object {
        const val EXTRA_START_PRACTICE = "startPractice"
    }
}
