package com.golfroundtracker.app.wear

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Distance maths, matching the phone's `teeBox.ts` and the watch's Swift
 * `WatchSession` so the same two points give the same yardage on every device.
 *
 * Haversine on a sphere, not Vincenty on an ellipsoid: at golf distances the
 * difference is under a centimetre, and a golfer's GPS fix is good to three
 * metres on a clear day.
 */
object Geo {
    private const val EARTH_RADIUS_M = 6_371_000.0
    const val METRES_PER_YARD = 0.9144
    private const val METRES_PER_FOOT = 0.3048

    fun metresBetween(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val h = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLng / 2) * sin(dLng / 2)
        // min(1.0, …) guards asin's domain against floating-point overshoot on
        // two identical points, which would otherwise return NaN for a distance
        // of zero — the exact case that happens when a fix repeats.
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
    }

    fun metresToYards(m: Double): Int = (m / METRES_PER_YARD).toInt()

    fun metresToFeet(m: Double): Int = (m / METRES_PER_FOOT).toInt()
}
