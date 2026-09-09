package com.golfroundtracker.app.wear

import kotlin.math.sqrt

/**
 * One motion sample, in the SAME UNITS as watchOS's `CMDeviceMotion`.
 *
 * That equivalence is the whole reason the detector could be ported verbatim,
 * and it does not come free — Android hands out raw sensors in SI units and
 * leaves the fusing to you. See `SwingMotionService` for the conversion:
 *
 *   userAccel     linear acceleration in **g**, gravity already removed
 *   rotationRate  angular velocity in **rad/s**
 *   gravity       gravity direction in **g**
 *
 * Getting the units wrong is a silent failure, not a crash: `impactAccel = 2.5`
 * is 2.5 g, and feeding it m/s² would trip the impact threshold on a brisk
 * walk.
 */
data class MotionSample(
    /** Seconds. Monotonic, from the sensor clock — not wall time. */
    val t: Double,
    val ax: Double, val ay: Double, val az: Double,
    val gx: Double, val gy: Double, val gz: Double,
    val gravX: Double, val gravY: Double, val gravZ: Double
) {
    val angularSpeed: Double get() = sqrt(gx * gx + gy * gy + gz * gz)
    val linearAccelMag: Double get() = sqrt(ax * ax + ay * ay + az * az)

    fun rotationAt(axis: Int): Double = when (axis) {
        0 -> gx
        1 -> gy
        else -> gz
    }
}

/** A completed swing's window, as `SwingMetricsCalculator` would consume it. */
data class SwingWindow(
    val samples: List<MotionSample>,
    val tStart: Double,
    val tTop: Double,
    val tImpact: Double,
    val tFinish: Double,
    val isAirSwing: Boolean,
    /** Peak linear-accel (g) through impact — how hard the strike was. */
    val peakImpactG: Double
)
