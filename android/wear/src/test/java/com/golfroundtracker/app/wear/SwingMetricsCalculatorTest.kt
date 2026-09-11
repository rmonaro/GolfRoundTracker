package com.golfroundtracker.app.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The metrics calculator against synthetic windows.
 *
 * These pin the SCALES, which is the thing that actually matters here. The
 * phone's rules engine and the `swing_metrics` table are calibrated against the
 * watchOS numbers, so a Wear watch producing subtly different ones would poison
 * a shared swing history without ever looking wrong on screen — no error, no
 * crash, just a player whose tempo appears to change when they switch watches.
 */
class SwingMetricsCalculatorTest {

    private val calc = SwingMetricsCalculator()
    private val dt = 0.01

    private fun sample(t: Double, omega: Double, accelG: Double = 0.1) = MotionSample(
        t = t,
        ax = accelG, ay = 0.0, az = 0.0,
        gx = 0.0, gy = 0.0, gz = omega,
        gravX = 0.0, gravY = 0.0, gravZ = 1.0
    )

    /**
     * backswing 0.6 s, downswing 0.2 s, then a settle.
     *
     * `backswingOmega` is separate from the peak on purpose. Classification
     * reads BOTH — a putt is a slow downswing AND a short quiet backswing (the
     * integrated rotation) — so a window that always swings the backswing hard
     * can never produce one, whatever the peak. Discovered by this test
     * asserting `putt` and getting `chip`.
     */
    private fun window(
        peakOmega: Double = 20.0,
        isAir: Boolean = false,
        backswingOmega: Double = 4.0
    ): SwingWindow {
        val samples = mutableListOf<MotionSample>()
        var t = 0.0
        repeat(60) { samples.add(sample(t, backswingOmega)); t += dt }  // backswing
        val tTop = t
        repeat(20) { samples.add(sample(t, -peakOmega)); t += dt } // downswing
        val tImpact = t
        repeat(60) { samples.add(sample(t, 0.1)); t += dt }        // finish
        return SwingWindow(
            samples = samples,
            tStart = 0.0,
            tTop = tTop,
            tImpact = tImpact,
            tFinish = t,
            isAirSwing = isAir,
            peakImpactG = if (isAir) 0.4 else 7.0
        )
    }

    @Test
    fun `timings and tempo come from the phase boundaries`() {
        val m = calc.compute(window())
        assertEquals(600, m.backswingTimeMs)
        assertEquals(200, m.downswingTimeMs)
        // 600 / 200 — the ratio golfers actually talk about.
        assertEquals(3.0, m.tempoRatio, 0.01)
    }

    @Test
    fun `every score stays inside 0-100`() {
        // Clamping is not cosmetic: these are persisted and compared across
        // swings, and a 137 would skew a player's history permanently.
        for (peak in listOf(0.5, 5.0, 20.0, 60.0, 500.0)) {
            val m = calc.compute(window(peakOmega = peak))
            for ((name, score) in listOf(
                "transition" to m.transitionScore,
                "handSpeed" to m.estimatedHandSpeed,
                "wristRotation" to m.wristRotationScore,
                "finishStability" to m.finishStabilityScore,
                "releaseTiming" to m.releaseTimingScore,
                "deceleration" to m.decelerationScore,
                "transitionDirection" to m.transitionDirectionScore
            )) {
                assertTrue("$name was $score at peak $peak", score in 0..100)
            }
        }
    }

    @Test
    fun `hand speed is relative effort, saturating at a fast wrist`() {
        // 35 rad/s is the 100 mark, copied from the Swift original. A swing at
        // half that should read near 50, not near 100 — the scale has to match
        // or the phone's history is comparing different units.
        assertEquals(50.0, calc.compute(window(peakOmega = 17.5)).estimatedHandSpeed.toDouble(), 3.0)
        assertEquals(100, calc.compute(window(peakOmega = 80.0)).estimatedHandSpeed)
    }

    @Test
    fun `an air swing is labelled as one whatever its shape`() {
        // Round mode filters on this, and the phone keeps rehearsals out of the
        // real-swing stats with it.
        val m = calc.compute(window(peakOmega = 25.0, isAir = true))
        assertEquals("air", m.swingType)
        assertTrue(m.isAirSwing)
    }

    @Test
    fun `a slow quiet stroke classifies as a putt`() {
        // Slow through the ball AND barely any wrist turn going back:
        // 1.5 rad/s over 0.6 s = 0.9 rad, inside the 1.2 rad putt threshold.
        val m = calc.compute(window(peakOmega = 3.0, backswingOmega = 1.5))
        assertEquals("putt", m.swingType)
        assertTrue("backswing rotation should be inside the putt threshold",
            m.backswingRotation < 1.2)
    }

    @Test
    fun `plane axis is a unit vector`() {
        // It exists to compare swing PATTERNS across swings, which only works if
        // it is normalised — an un-normalised axis would encode speed too.
        val axis = calc.compute(window()).planeAxis
        val length = kotlin.math.sqrt(axis.sumOf { it * it })
        assertEquals(1.0, length, 0.001)
    }
}
