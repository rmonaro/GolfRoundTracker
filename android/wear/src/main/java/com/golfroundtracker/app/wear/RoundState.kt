package com.golfroundtracker.app.wear

import org.json.JSONObject

/**
 * The subset of the phone's `WatchRoundState` this phase renders.
 *
 * Parsed leniently on purpose. The shape is owned by
 * `src/services/watchBridge.ts` and grows there; a watch that threw on an
 * unknown or missing field would break every time the phone learned a new one,
 * and the two are updated independently (the phone updates over the air, the
 * watch through the Play Store). Absent means absent — never a default that
 * could be mistaken for a real reading.
 *
 * Mirrors how the watchOS side decodes: `dict["x"] as? T`, nil if it isn't there.
 */
data class RoundState(
    val active: Boolean,
    val courseName: String?,
    val holeNumber: Int?,
    val par: Int?,
    val distanceYards: Int?,
    val distanceFeet: Int?,
    val scoreVsPar: String?,
    val shotsThisHole: Int?,
    val onGreen: Boolean,
    /**
     * The pin, which is what makes the watch self-sufficient.
     *
     * With these the watch computes its own distance every second from its own
     * GPS; without them it can only render `distanceYards`, which is a number
     * the phone last calculated — and the phone's JS is suspended while it sits
     * in a pocket, so that number stops moving as the golfer walks. Absent
     * means the course has no geometry, not that the phone forgot.
     */
    val pinLat: Double?,
    val pinLng: Double?,
    /**
     * Phone's 2 km at-course gate. Absent → treat as at-course; false → hide
     * the recording controls, matching what the phone does with its own.
     */
    val atCourse: Boolean,
    /** Phone-side auto-track state, so the watch's Track button is a synced
     *  toggle rather than a local one that can disagree with reality. */
    val autoTracking: Boolean,
    val puttsThisHole: Int?,
    val selectedClubId: String?,
    /**
     * User setting: whether the watch should run its motion detector at all.
     * Absent → enabled, matching the watchOS reading of the same field. Gating
     * it here rather than always-on keeps watch battery in the user's control.
     */
    val shotDetection: Boolean,
    val bag: List<Club>
) {
    /** A club as the watch renders it. */
    data class Club(
        val clubId: String,
        val name: String,
        val isPutter: Boolean,
        val typicalYards: Int?
    )

    companion object {
        val NONE = RoundState(
            active = false,
            courseName = null,
            holeNumber = null,
            par = null,
            distanceYards = null,
            distanceFeet = null,
            scoreVsPar = null,
            shotsThisHole = null,
            onGreen = false,
            pinLat = null,
            pinLng = null,
            atCourse = true,
            autoTracking = false,
            puttsThisHole = null,
            selectedClubId = null,
            shotDetection = true,
            bag = emptyList()
        )

        fun fromJson(raw: String): RoundState = try {
            val o = JSONObject(raw)
            RoundState(
                active = o.optBoolean("active", false),
                courseName = o.optStringOrNull("courseName"),
                holeNumber = o.optIntOrNull("holeNumber"),
                par = o.optIntOrNull("par"),
                distanceYards = o.optIntOrNull("distanceYards"),
                distanceFeet = o.optIntOrNull("distanceFeet"),
                scoreVsPar = o.optStringOrNull("scoreVsPar"),
                shotsThisHole = o.optIntOrNull("shotsThisHole"),
                onGreen = o.optBoolean("onGreen", false),
                pinLat = o.optDoubleOrNull("pinLat"),
                pinLng = o.optDoubleOrNull("pinLng"),
                // Absent means "don't block" — the phone omits the key when it
                // has no location of its own to judge with, and refusing to let
                // a golfer record a shot because the PHONE can't see a course is
                // the wrong way to fail.
                atCourse = o.optBoolean("atCourse", true),
                autoTracking = o.optBoolean("autoTracking", false),
                puttsThisHole = o.optIntOrNull("puttsThisHole"),
                selectedClubId = o.optStringOrNull("selectedClubId"),
                shotDetection = o.optBoolean("shotDetection", true),
                bag = o.optJSONArray("bag").toClubs()
            )
        } catch (err: Throwable) {
            // A malformed payload must not take the watch app down mid-round.
            // Showing "no round" is wrong but recoverable; a crash on the first
            // tee is not.
            android.util.Log.w("RoundState", "unparseable state: $raw", err)
            NONE
        }
    }
}

/** `optString` returns "" for a missing key, which is not the same as absent. */
private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).ifEmpty { null }

private fun JSONObject.optIntOrNull(key: String): Int? =
    if (isNull(key) || !has(key)) null else optInt(key)

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (isNull(key) || !has(key)) null else optDouble(key).takeIf { !it.isNaN() }

private fun org.json.JSONArray?.toClubs(): List<RoundState.Club> {
    if (this == null) return emptyList()
    val out = ArrayList<RoundState.Club>(length())
    for (i in 0 until length()) {
        val o = optJSONObject(i) ?: continue
        val id = o.optStringOrNull("clubId") ?: continue
        out.add(
            RoundState.Club(
                clubId = id,
                name = o.optStringOrNull("name") ?: "Club",
                isPutter = o.optBoolean("isPutter", false),
                typicalYards = o.optIntOrNull("typicalYards")
            )
        )
    }
    return out
}
