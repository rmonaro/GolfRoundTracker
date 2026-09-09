package com.golfroundtracker.app.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Synthetic swings through the ported state machine.
 *
 * This is the ONLY part of the Wear port that can be verified without a watch on
 * a wrist, and it is also the part most worth verifying: the detector is where a
 * transcription slip turns into "the app misses every third shot" rather than a
 * compile error. Each test drives motion shaped like the phase it is naming, at
 * the 100 Hz the pipeline requests.
 *
 * These do NOT validate the thresholds — those came from real swings on real
 * hardware and only real swings can re-validate them. They validate that the
 * machine transitions the way the Swift original does.
 */
class SwingDetectorTest {

    private val dt = 0.01 // 100 Hz, matching the requested sensor period

    /** A sample with a given angular speed on one axis and linear accel in g. */
    private fun sample(t: Double, omega: Double, accelG: Double = 0.0) = MotionSample(
        t = t,
        ax = accelG, ay = 0.0, az = 0.0,
        gx = omega, gy = 0.0, gz = 0.0,
        gravX = 0.0, gravY = 0.0, gravZ = 1.0
    )

    /** Feeds samples and returns the time at which the swing completed, if it did. */
    private fun run(detector: SwingDetector, samples: List<MotionSample>): Double? {
        var completed: Double? = null
        for (s in samples) {
            if (detector.advance(s) == SwingPhase.FINISHED) completed = s.t
        }
        return completed
    }

    /**
     * Takeaway → top → downswing → strike → settle.
     *
     * The sign flip on the dominant axis is what marks the top, and it has to
     * happen while the wrist is BELOW the start threshold — that pairing is the
     * subtlest part of the machine.
     */
    private fun fullSwing(
        startT: Double = 100.0,
        impactG: Double = 6.0,
        includeImpact: Boolean = true
    ): List<MotionSample> {
        val out = mutableListOf<MotionSample>()
        var t = startT
        // Backswing: clearly moving, positive axis.
        repeat(60) { out.add(sample(t, 4.0)); t += dt }
        // Top: slow AND reversed — both conditions at once.
        repeat(10) { out.add(sample(t, -0.5)); t += dt }
        // Downswing: accelerating the other way.
        repeat(20) { out.add(sample(t, -12.0)); t += dt }
        // Impact spike.
        if (includeImpact) {
            repeat(3) { out.add(sample(t, -15.0, impactG)); t += dt }
        } else {
            // Rehearsal: keep swinging past the air-swing timeout with no spike.
            repeat(100) { out.add(sample(t, -12.0, 0.3)); t += dt }
        }
        // Settle: quiet for longer than finishSettleS (0.4 s).
        repeat(60) { out.add(sample(t, 0.1)); t += dt }
        return out
    }

    @Test
    fun `detects a full swing and reports the phases`() {
        val detector = SwingDetector()
        val completedAt = run(detector, fullSwing())

        assertNotNull("a struck swing should complete", completedAt)
        assertEquals(SwingPhase.FINISHED, detector.phase)
        assertFalse("a swing with an impact spike is not an air swing", detector.isAirSwing)
        assertTrue("peak impact should record the spike", detector.peakImpactG >= 6.0)

        val window = detector.takeCompletedWindow(fullSwing())
        assertNotNull(window)
        assertTrue("top must fall between takeaway and impact",
            window!!.tTop > window.tStart && window.tTop < window.tImpact)
    }

    @Test
    fun `a rehearsal with no strike is flagged as an air swing`() {
        // This is the distinction round mode depends on: forwarding practice
        // swings as impacts would defeat the false-positive filtering the phone
        // uses them for.
        val detector = SwingDetector()
        run(detector, fullSwing(includeImpact = false))
        assertTrue("no impact spike means air swing", detector.isAirSwing)
    }

    @Test
    fun `quiet wrist produces nothing`() {
        val detector = SwingDetector()
        val idle = (0 until 500).map { sample(100.0 + it * dt, 0.2) }
        assertNull(run(detector, idle))
        assertEquals(SwingPhase.IDLE, detector.phase)
    }

    /**
     * The stall recovery, which exists because without it a phase entered on
     * non-swing motion (pulling a club from the bag) persists forever, and the
     * NEXT real swing is read as its continuation — losing the shot.
     */
    @Test
    fun `a backswing that goes nowhere is abandoned and the next swing still lands`() {
        val detector = SwingDetector()

        // Motion that enters BACKSWING and then just... continues, past the 3 s
        // allowance, never reversing.
        var t = 100.0
        val stall = (0 until 400).map { sample(t + it * dt, 4.0) }
        run(detector, stall)
        t += 400 * dt

        // NOT idle yet, and that is correct rather than a miss: the phase is
        // abandoned on timeout, but the very next sample is still above the
        // start threshold, so a fresh BACKSWING opens immediately. The wrist IS
        // still moving. Idle only comes once the motion actually stops.
        assertEquals(SwingPhase.BACKSWING, detector.phase)

        // Arm goes quiet — now the abandonment can settle out.
        val quiet = (0 until 400).map { sample(t + it * dt, 0.1) }
        run(detector, quiet)
        t += 400 * dt
        assertEquals("stalled phase should have been dropped", SwingPhase.IDLE, detector.phase)

        // A genuine swing afterwards must be detected from scratch.
        t += 1.0
        val completedAt = run(detector, fullSwing(startT = t))
        assertNotNull("the swing after a stall must still be caught", completedAt)
        assertFalse(detector.isAirSwing)
    }

    @Test
    fun `an impact whose settle never arrives is still recorded`() {
        // The arm kept moving after a real strike — walking off, or straight
        // into a re-tee. The strike was real, so the swing closes rather than
        // being discarded.
        val detector = SwingDetector()
        val out = mutableListOf<MotionSample>()
        var t = 100.0
        repeat(60) { out.add(sample(t, 4.0)); t += dt }
        repeat(10) { out.add(sample(t, -0.5)); t += dt }
        repeat(20) { out.add(sample(t, -12.0)); t += dt }
        repeat(3) { out.add(sample(t, -15.0, 6.0)); t += dt }
        // Never settles: 5 s of continued motion, past impactTimeoutS (4 s).
        repeat(500) { out.add(sample(t, 3.0)); t += dt }

        assertNotNull("a real strike must not be lost to a missing settle", run(detector, out))
    }

    @Test
    fun `a backwards clock re-anchors instead of abandoning a live swing`() {
        // Sensor re-registration can re-base the timestamp. Treating that as an
        // elapsed eternity would drop a swing in progress.
        val detector = SwingDetector()
        detector.advance(sample(100.0, 4.0))
        assertEquals(SwingPhase.BACKSWING, detector.phase)
        detector.advance(sample(5.0, 4.0)) // clock jumped backwards
        assertEquals("should still be mid-swing", SwingPhase.BACKSWING, detector.phase)
    }
}
