package com.golfroundtracker.app.wear

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Turns a completed `SwingWindow` into `SwingMetrics`.
 *
 * A faithful port of `SwingMetricsCalculator.swift`. Every threshold here (35
 * rad/s for a fast wrist, 60 g/s for an aggressive transition, the swing-type
 * cutoffs) was chosen against real swings, so the numbers are copied rather
 * than re-derived — the phone's rules engine and the `swing_metrics` table are
 * calibrated to THESE scales, and a Wear watch producing subtly different ones
 * would poison a shared history without ever looking wrong.
 */
class SwingMetricsCalculator {

    fun compute(w: SwingWindow): SwingMetrics {
        val backswingMs = (w.tTop - w.tStart) * 1000
        val downswingMs = (w.tImpact - w.tTop) * 1000
        val tempo = if (downswingMs > 1) backswingMs / downswingMs else 0.0

        val peakOmega = w.samples.maxOfOrNull { it.angularSpeed } ?: 0.0
        val backswingRotation = integratedRotation(w, w.tStart, w.tTop)

        return SwingMetrics(
            backswingTimeMs = backswingMs.roundToInt(),
            downswingTimeMs = downswingMs.roundToInt(),
            tempoRatio = round2(tempo),
            transitionScore = transitionScore(w),
            estimatedHandSpeed = handSpeedScore(w),
            wristRotationScore = wristRotationScore(w),
            finishStabilityScore = finishStabilityScore(w),
            planeAxis = meanRotationAxis(w, w.tTop, w.tImpact),
            swingType = classifySwing(w, peakOmega, backswingRotation),
            isAirSwing = w.isAirSwing,
            backswingRotation = round2(backswingRotation),
            releaseTimingScore = releaseTimingScore(w),
            decelerationScore = decelerationScore(w),
            transitionDirectionScore = transitionDirectionScore(w),
            addressGravity = addressGravity(w),
            peakImpactG = w.peakImpactG
        )
    }

    /** Motion magnitude + duration + whether contact happened. Rough by design,
     *  and labelled "estimated" everywhere it surfaces. */
    private fun classifySwing(w: SwingWindow, peakOmega: Double, backswingRotation: Double): String {
        if (w.isAirSwing) return "air"
        val totalMs = (w.tFinish - w.tStart) * 1000
        if (peakOmega < 5 && backswingRotation < 1.2) return "putt"
        if (peakOmega < 9 || backswingRotation < 1.6) return "chip"
        if (peakOmega < 16 || backswingRotation < 2.4 || totalMs < 900) return "pitch"
        return "full"
    }

    /** Integrate |angular velocity| over a sub-window → radians of wrist turn. */
    private fun integratedRotation(w: SwingWindow, from: Double, to: Double): Double {
        val seg = w.samples.filter { it.t in from..to }
        if (seg.size <= 1) return 0.0
        var total = 0.0
        for (i in 1 until seg.size) {
            total += seg[i].angularSpeed * (seg[i].t - seg[i - 1].t)
        }
        return total
    }

    /** 0-100: how late peak wrist speed lands in the downswing — lag-like. */
    private fun releaseTimingScore(w: SwingWindow): Int {
        val down = w.samples.filter { it.t in w.tTop..w.tImpact }
        if (down.size <= 1 || w.tImpact <= w.tTop) return 50
        val tPeak = down.maxByOrNull { it.angularSpeed }?.t ?: return 50
        return clampScore((tPeak - w.tTop) / (w.tImpact - w.tTop) * 100)
    }

    /** 0-100: accelerating through impact (>50) vs quitting on it (<50). */
    private fun decelerationScore(w: SwingWindow): Int {
        val late = w.samples.filter { it.t >= w.tImpact - 0.05 && it.t <= w.tImpact }
        val early = w.samples.filter { it.t >= w.tImpact - 0.10 && it.t < w.tImpact - 0.05 }
        if (late.isEmpty() || early.isEmpty()) return 50
        val lateAvg = late.map { it.angularSpeed }.mean()
        val earlyAvg = early.map { it.angularSpeed }.mean()
        if (earlyAvg <= 1e-3) return 50
        return clampScore(50 + (lateAvg - earlyAvg) / earlyAvg * 100)
    }

    /** 0-100: axis consistency backswing → downswing. An over-the-top PROXY,
     *  not a measured club path. */
    private fun transitionDirectionScore(w: SwingWindow): Int {
        val backAxis = meanRotationAxis(w, w.tStart, w.tTop)
        val downAxis = meanRotationAxis(w, w.tTop, w.tImpact)
        val sim = dot(backAxis, downAxis) // -1..1
        return clampScore((sim + 1) / 2 * 100)
    }

    private fun addressGravity(w: SwingWindow): List<Double> {
        val first = w.samples.firstOrNull() ?: return listOf(0.0, 0.0, 0.0)
        return listOf(first.gravX, first.gravY, first.gravZ)
    }

    /** Smoothness of the reversal at the top — lower jerk is smoother. */
    private fun transitionScore(w: SwingWindow, windowS: Double = 0.12): Int {
        val seg = w.samples.filter { it.t in (w.tTop - windowS)..(w.tTop + windowS) }
        if (seg.size <= 2) return 50
        var jerk = 0.0
        for (i in 1 until seg.size) {
            val dt = maxOf(seg[i].t - seg[i - 1].t, 1e-3)
            val dx = seg[i].ax - seg[i - 1].ax
            val dy = seg[i].ay - seg[i - 1].ay
            val dz = seg[i].az - seg[i - 1].az
            jerk += sqrt(dx * dx + dy * dy + dz * dz) / dt
        }
        val avgJerk = jerk / (seg.size - 1)
        // 60 g/s ≈ an aggressive transition.
        return clampScore((1 - min(avgJerk / 60.0, 1.0)) * 100)
    }

    /** Peak angular speed as RELATIVE 0-100 effort. Never mph. */
    private fun handSpeedScore(w: SwingWindow): Int {
        val peak = w.samples.maxOfOrNull { it.angularSpeed } ?: 0.0
        return clampScore(peak / 35.0 * 100) // 35 rad/s ≈ a fast wrist
    }

    /** Consistency of forearm roll through the downswing. */
    private fun wristRotationScore(w: SwingWindow): Int {
        val down = w.samples.filter { it.t in w.tTop..w.tImpact }
        if (down.isEmpty()) return 50
        // z ≈ the crown/forearm axis, the same assumption the Swift version
        // makes — and the same one that would need revisiting if a Wear device
        // turns out to orient its gyroscope differently on the wrist.
        val rolls = down.map { abs(it.gz) }
        val m = rolls.mean()
        val varc = rolls.map { (it - m) * (it - m) }.mean()
        return clampScore((1 - min(varc / (m * m + 1e-3), 1.0)) * 100)
    }

    /** Steadiness in the ~600 ms after impact. */
    private fun finishStabilityScore(w: SwingWindow): Int {
        val seg = w.samples.filter { it.t in w.tImpact..(w.tImpact + 0.6) }
        if (seg.isEmpty()) return 50
        val mags = seg.map { it.linearAccelMag }
        val m = mags.mean()
        val varc = mags.map { (it - m) * (it - m) }.mean()
        return clampScore((1 - min(varc / 1.5, 1.0)) * 100)
    }

    /** Mean angular-velocity direction, normalised. For comparing PATTERNS. */
    private fun meanRotationAxis(w: SwingWindow, from: Double, to: Double): List<Double> {
        val seg = w.samples.filter { it.t in from..to }
        var x = 0.0; var y = 0.0; var z = 0.0
        for (s in seg) { x += s.gx; y += s.gy; z += s.gz }
        val n = sqrt(x * x + y * y + z * z)
        return if (n > 1e-6) listOf(x / n, y / n, z / n) else listOf(0.0, 0.0, 0.0)
    }

    private fun List<Double>.mean(): Double = if (isEmpty()) 0.0 else sum() / size

    private fun dot(a: List<Double>, b: List<Double>): Double {
        var s = 0.0
        for (i in 0 until min(a.size, b.size)) s += a[i] * b[i]
        return s
    }

    private fun clampScore(v: Double): Int = v.roundToInt().coerceIn(0, 100)

    private fun round2(v: Double): Double = (v * 100).roundToInt() / 100.0
}
