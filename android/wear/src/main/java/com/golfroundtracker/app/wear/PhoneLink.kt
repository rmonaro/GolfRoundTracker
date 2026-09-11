package com.golfroundtracker.app.wear

import android.content.Context
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

/**
 * Watch → phone. Two channels, chosen per message by whether losing it matters.
 *
 * See `WearProtocol` for the full reasoning. In short: a recorded shot goes into
 * the durable queue as its own data item and stays on the node until the phone
 * acknowledges by deleting it; a live position goes as a message and is allowed
 * to evaporate.
 */
object PhoneLink {

    /**
     * Makes each queued event's path unique.
     *
     * Two shots recorded in the same millisecond — a real possibility when a
     * putt is holed and the hole auto-advances — would otherwise write to the
     * same path, and the second would overwrite the first before the phone had
     * read it. The counter closes that; the timestamp keeps paths sortable by
     * eye when debugging.
     */
    private val sequence = AtomicLong(0)

    /**
     * Queue an event for the phone. Survives the phone being unreachable, its
     * process being dead, or the watch losing Bluetooth entirely.
     */
    fun sendEvent(context: Context, event: JSONObject) {
        val id = "${System.currentTimeMillis()}-${sequence.incrementAndGet()}"
        val request = PutDataMapRequest.create(WearProtocol.FROM_WATCH_QUEUE_PREFIX + id)
        request.dataMap.putString(WearProtocol.KEY_EVENT_JSON, event.toString())

        Wearable.getDataClient(context)
            .putDataItem(request.asPutDataRequest().setUrgent())
            .addOnFailureListener { err ->
                // The item was not written, so there is nothing on the node to
                // retry from — this is the one genuinely lossy moment in the
                // durable path. Logged loudly because a shot that never made it
                // is otherwise indistinguishable from one the phone ignored.
                android.util.Log.e("PhoneLink", "FAILED to queue watch event: $event", err)
            }
    }

    /**
     * Send a position update. Fire and forget: no retry, no queue, no error
     * surfaced. The next one is a second away.
     */
    fun sendLiveUpdate(context: Context, payload: JSONObject) {
        val bytes = payload.toString().toByteArray(Charsets.UTF_8)
        Wearable.getNodeClient(context).connectedNodes
            .addOnSuccessListener { nodes ->
                for (node in nodes) {
                    Wearable.getMessageClient(context)
                        .sendMessage(node.id, WearProtocol.LIVE_UPDATE_PATH, bytes)
                }
            }
    }

    // --- The messages themselves ---------------------------------------------
    //
    // Each mirrors a variant of `WatchInboundMessage` in
    // `src/services/watchBridge.ts`. The phone parses by `type`, so these names
    // are the contract; nothing validates them at compile time on either side.

    fun autoShot(context: Context, clubId: String?, fix: Fix?) {
        val event = JSONObject()
            .put("type", "autoShot")
            .put("clubId", clubId ?: JSONObject.NULL)
        fix?.let {
            // Only the END position: the phone fills the start from where the
            // ball was last anchored on that hole, which it knows and the watch
            // does not.
            event.put("endLat", it.lat).put("endLng", it.lng)
        }
        sendEvent(context, event)
    }

    fun navigateHole(context: Context, next: Boolean) {
        sendEvent(
            context,
            JSONObject()
                .put("type", "navigateHole")
                .put("direction", if (next) "next" else "prev")
        )
    }

    fun setPin(context: Context, fix: Fix) {
        sendEvent(
            context,
            JSONObject().put("type", "setPin").put("lat", fix.lat).put("lng", fix.lng)
        )
    }

    fun setAutoTrack(context: Context, active: Boolean) {
        sendEvent(context, JSONObject().put("type", "setAutoTrack").put("active", active))
    }

    fun selectClub(context: Context, clubId: String) {
        sendEvent(context, JSONObject().put("type", "selectClub").put("clubId", clubId))
    }

    /**
     * Tracking start/stop is an EVENT (durable — the phone must know tracking
     * began, or the shot it later records has no start point), while the
     * positions that follow are updates. Same message type, two channels, split
     * on `active` being present.
     */
    fun trackingShot(context: Context, active: Boolean, fix: Fix?) {
        val event = JSONObject().put("type", "trackingShot").put("active", active)
        if (active) fix?.let { event.put("startLat", it.lat).put("startLng", it.lng) }
        sendEvent(context, event)
    }

    /**
     * A confirmed ball strike. Durable — this is what unlocks the phone's
     * auto-track for the shot that follows, so losing one costs a recorded shot.
     *
     * `startLat/Lng` carry the watch's fix at impact, with its accuracy and age
     * alongside: the phone compares them against its OWN fix rather than
     * trusting the watch blindly. A 28 m fix from nine seconds ago is worse than
     * the phone's 6 m fix from now, and preferring it put shots on the wrong
     * side of greens.
     */
    fun roundImpact(
        context: Context,
        impactId: Int,
        capturedAtMillis: Long,
        swingType: String,
        handSpeed: Int,
        clubId: String?,
        fix: Fix?
    ) {
        val event = JSONObject()
            .put("type", "roundImpact")
            .put("impactId", impactId)
            .put("capturedAt", capturedAtMillis)
            .put("swingType", swingType)
            .put("handSpeed", handSpeed)
            .put("clubId", clubId ?: JSONObject.NULL)
        fix?.let {
            event.put("startLat", it.lat)
                .put("startLng", it.lng)
                .put("startAccuracyM", it.accuracyM.toDouble())
                .put("startFixAt", it.atMillis)
        }
        sendEvent(context, event)
    }

    /**
     * A shot the golfer described rather than one inferred from GPS.
     *
     * Currently only putts reach here. GPS CANNOT MEASURE A PUTT — two fixes
     * eight feet apart are inside the error of either — so for a putt the
     * `distanceFeet` the player saw and nudged is the AUTHORITATIVE distance,
     * not a fallback. That is why this message carries it and `autoShot` does
     * not.
     */
    fun recordPutt(
        context: Context,
        clubId: String?,
        made: Boolean,
        distanceFeet: Int?,
        fix: Fix?
    ) {
        val event = JSONObject()
            .put("type", "recordShot")
            .put("clubId", clubId ?: JSONObject.NULL)
            .put("targetType", "putt")
            .put("targetResult", if (made) "made" else "missed")
            .put("distanceFeet", distanceFeet ?: JSONObject.NULL)
        fix?.let { event.put("endLat", it.lat).put("endLng", it.lng) }
        sendEvent(context, event)
    }

    // --- Practice mode --------------------------------------------------------

    fun practiceStarted(context: Context, sessionId: String, clubId: String?) {
        sendEvent(
            context,
            JSONObject()
                .put("type", "practiceStarted")
                .put("sessionId", sessionId)
                .put("clubId", clubId ?: JSONObject.NULL)
        )
    }

    fun practiceClubSelected(context: Context, sessionId: String, clubId: String) {
        sendEvent(
            context,
            JSONObject()
                .put("type", "practiceClubSelected")
                .put("sessionId", sessionId)
                .put("clubId", clubId)
        )
    }

    fun practiceEnded(
        context: Context,
        sessionId: String,
        swingCount: Int,
        durationSeconds: Int,
        health: ExerciseSession.HealthSummary?
    ) {
        val event = JSONObject()
            .put("type", "practiceEnded")
            .put("sessionId", sessionId)
            .put("swingCount", swingCount)
            .put("durationSeconds", durationSeconds)

        // OMITTED, never zeroed. Every health field is optional in the
        // contract, and a zero would be persisted as a genuine reading of
        // nothing — a resting heart rate of 0 in a player's history. A watch
        // with no sensor, a refused permission and a session too short for a
        // reading all land here, and all three mean "we don't know".
        health?.avgHeartRate?.let { event.put("avgHeartRate", it) }
        health?.maxHeartRate?.let { event.put("maxHeartRate", it) }
        health?.minHeartRate?.let { event.put("minHeartRate", it) }
        health?.activeCalories?.let { event.put("activeCalories", it) }
        // hrvSdnn is deliberately absent: Health Services exposes no SDNN
        // equivalent during an exercise, and the iOS value is itself usually
        // missing mid-activity. Inventing one from beat spacing would be a
        // number nobody could trust.

        sendEvent(context, event)
    }

    /**
     * One detected swing's metrics. The phone runs its rules engine on these and
     * writes `swing_metrics`, so the SCALES matter as much as the values — see
     * SwingMetricsCalculator on why the thresholds were copied, not re-derived.
     */
    fun swingDetected(
        context: Context,
        sessionId: String,
        swingIndex: Int,
        clubId: String?,
        metrics: SwingMetrics
    ) {
        val event = JSONObject()
            .put("type", "swingDetected")
            .put("sessionId", sessionId)
            .put("swingIndex", swingIndex)
            .put("clubId", clubId ?: JSONObject.NULL)
            // Epoch SECONDS here, unlike roundImpact's millis. Not a slip — it
            // is what the phone's contract specifies for this message.
            .put("capturedAt", System.currentTimeMillis() / 1000)
            .put("backswingTimeMs", metrics.backswingTimeMs)
            .put("downswingTimeMs", metrics.downswingTimeMs)
            .put("tempoRatio", metrics.tempoRatio)
            .put("transitionScore", metrics.transitionScore)
            .put("estimatedHandSpeed", metrics.estimatedHandSpeed)
            .put("wristRotationScore", metrics.wristRotationScore)
            .put("finishStabilityScore", metrics.finishStabilityScore)
            .put("planeAxis", org.json.JSONArray(metrics.planeAxis))
            .put("swingType", metrics.swingType)
            .put("isAirSwing", metrics.isAirSwing)
            .put("backswingRotation", metrics.backswingRotation)
            .put("releaseTimingScore", metrics.releaseTimingScore)
            .put("decelerationScore", metrics.decelerationScore)
            .put("transitionDirectionScore", metrics.transitionDirectionScore)
            .put("addressGravity", org.json.JSONArray(metrics.addressGravity))
        sendEvent(context, event)
    }

    fun trackingPosition(context: Context, fix: Fix) {
        sendLiveUpdate(
            context,
            JSONObject()
                .put("type", "trackingShot")
                .put("active", true)
                .put("currentLat", fix.lat)
                .put("currentLng", fix.lng)
        )
    }
}
