package com.golfroundtracker.app.wear

import kotlin.math.abs

enum class SwingPhase { IDLE, BACKSWING, TOP_OF_BACKSWING, DOWNSWING, IMPACT, FINISHED }

/**
 * State machine walking wrist motion through the swing phases.
 *
 * A FAITHFUL PORT of `ios/App/GolfWatch Watch App/Practice/SwingDetector.swift`
 * — same phases, same thresholds, same stall handling — because that logic was
 * tuned against real swings on real wrists and re-deriving it from first
 * principles on a second platform would throw that away. Keep the two in step;
 * where they must diverge, say so here rather than quietly drifting.
 *
 * Detection is deliberately not ML: angular-speed onset, a dominant-axis sign
 * reversal at the top, an acceleration spike at impact, and a settle window for
 * the finish.
 *
 * THE ONE THING THAT MAY NEED RE-TUNING IS `impactAccel`. Impact is a very short
 * spike, and whether it is caught at all depends on the sample rate the watch
 * actually delivers — CoreMotion guarantees 100 Hz (200 on newer hardware),
 * Android guarantees nothing. `SwingMotionService` measures the real rate for
 * exactly this reason.
 */
class SwingDetector {

    var phase: SwingPhase = SwingPhase.IDLE
        private set

    var tStart: Double? = null; private set
    var tTop: Double? = null; private set
    var tImpact: Double? = null; private set
    var tFinish: Double? = null; private set

    /** Downswing decayed with no impact spike — a rehearsal. */
    var isAirSwing = false; private set

    /** Peak linear-accel (g) from the downswing through impact. A ball strike
     *  spikes far harder than a turf brush, which is how round mode rejects
     *  practice swings. */
    var peakImpactG = 0.0; private set

    // --- tunable thresholds (values from the Swift original) ---
    private val quietOmega = 0.6          // rad/s below which the wrist is quiet
    private val startOmega = 2.5          // rad/s marking an intentional move
    private val impactAccel = 2.5         // g spike marking the impact window
    private val finishSettleS = 0.4       // s of quiet before calling the finish
    private val airSwingTimeoutS = 0.8    // s after downswing with no contact

    // --- stuck-phase timeouts ---
    //
    // Without these there is no route back to IDLE except completing a swing,
    // and that LOSES REAL SHOTS. Every non-idle phase is entered on motion that
    // only might be a swing — pulling a club from the bag, a waggle, an arm
    // swinging while walking. If that motion does not go on to satisfy the next
    // transition the phase persists, and the golfer's next real swing is read as
    // a continuation of the stale one: its backswing is consumed as a downswing,
    // the window is wrong, and the shot is mis-measured or dropped as air.
    //
    // Generous next to a real swing (takeaway to finish is 1.5-2.5 s), so a slow
    // backswing or a pause at the top is never cut short.
    private val backswingTimeoutS = 3.0
    private val topOfBackswingTimeoutS = 3.0
    /** A settle that never arrives — the arm kept moving after a real strike.
     *  CLOSES the swing rather than discarding it. */
    private val impactTimeoutS = 4.0

    private var phaseSince: Double? = null
    private var dominantAxis = 0
    private var lastSignAtDominant = 0.0
    private var quietSince: Double? = null
    private var downswingStart: Double? = null
    private var peakOmega = 0.0
    private var peakOmegaTime: Double? = null

    /** Feed one sample. Returns FINISHED exactly once, on the completing sample. */
    fun advance(s: MotionSample): SwingPhase? {
        // Resolve a phase that is going nowhere BEFORE the transitions below, so
        // a stale phase never consumes this sample as part of its own swing.
        if (phase != SwingPhase.IDLE) {
            when (resolveStalledPhase(s.t)) {
                StallOutcome.NONE -> Unit
                StallOutcome.ABANDONED -> return null
                StallOutcome.COMPLETED -> return SwingPhase.FINISHED
            }
        }

        when (phase) {
            SwingPhase.IDLE -> {
                if (s.angularSpeed > startOmega) {
                    enter(SwingPhase.BACKSWING, s.t)
                    tStart = s.t
                    dominantAxis = indexOfMaxAbs(s)
                    lastSignAtDominant = signOf(s.rotationAt(dominantAxis))
                }
            }

            SwingPhase.BACKSWING -> {
                val sg = signOf(s.rotationAt(dominantAxis))
                // The dominant rotation axis reverses at a low-speed pivot —
                // that is the top of the backswing.
                if (sg != 0.0 && sg != lastSignAtDominant && s.angularSpeed < startOmega) {
                    enter(SwingPhase.TOP_OF_BACKSWING, s.t)
                    tTop = s.t
                }
                if (sg != 0.0) lastSignAtDominant = sg
            }

            SwingPhase.TOP_OF_BACKSWING -> {
                if (s.angularSpeed > startOmega) {
                    enter(SwingPhase.DOWNSWING, s.t)
                    downswingStart = s.t
                    peakOmega = s.angularSpeed
                    peakOmegaTime = s.t
                }
            }

            SwingPhase.DOWNSWING -> {
                if (s.angularSpeed > peakOmega) {
                    peakOmega = s.angularSpeed
                    peakOmegaTime = s.t
                }
                if (s.linearAccelMag > peakImpactG) peakImpactG = s.linearAccelMag
                val ds = downswingStart
                if (s.linearAccelMag >= impactAccel) {
                    enter(SwingPhase.IMPACT, s.t)
                    tImpact = s.t
                    quietSince = null
                } else if (ds != null && s.t - ds > airSwingTimeoutS) {
                    // No contact in the window → rehearsal. Use the peak-speed
                    // moment as the impact reference so timing metrics still work.
                    enter(SwingPhase.IMPACT, s.t)
                    isAirSwing = true
                    tImpact = peakOmegaTime ?: s.t
                    quietSince = null
                }
            }

            SwingPhase.IMPACT -> {
                if (s.linearAccelMag > peakImpactG) peakImpactG = s.linearAccelMag
                if (s.angularSpeed < quietOmega) {
                    val since = quietSince
                    if (since == null) {
                        quietSince = s.t
                    } else if (s.t - since > finishSettleS) {
                        enter(SwingPhase.FINISHED, s.t)
                        tFinish = s.t
                        return SwingPhase.FINISHED
                    }
                } else {
                    quietSince = null
                }
            }

            SwingPhase.FINISHED -> Unit
        }
        return null
    }

    /** Slice the completed swing out of the rolling buffer. */
    fun takeCompletedWindow(buffer: List<MotionSample>): SwingWindow? {
        val a = tStart ?: return null
        val top = tTop ?: return null
        val imp = tImpact ?: return null
        val f = tFinish ?: return null
        val samples = buffer.filter { it.t in a..f }
        if (samples.size <= 3) return null
        return SwingWindow(samples, a, top, imp, f, isAirSwing, peakImpactG)
    }

    private fun enter(next: SwingPhase, t: Double) {
        phase = next
        phaseSince = t
    }

    private enum class StallOutcome { NONE, ABANDONED, COMPLETED }

    /**
     * Handle a phase that has outstayed its allowance.
     *
     * ONLY HARD TIMEOUTS, deliberately. An earlier iOS version also abandoned a
     * phase whose motion had gone quiet — the obvious signal — but at the top of
     * the backswing the wrist IS quiet, so it fired during real swings. The cure
     * was worse than the stall: the downswing then re-entered BACKSWING from
     * idle and the impact spike arrived in a phase that could not recognise it,
     * losing the shot outright.
     */
    private fun resolveStalledPhase(t: Double): StallOutcome {
        val since = phaseSince
        if (since == null) {
            phaseSince = t
            return StallOutcome.NONE
        }
        // Clock went backwards. On Android this is rarer than on iOS (the sensor
        // clock is monotonic since boot) but a re-registration can still re-base
        // it, and treating that as an eternity would abandon a live swing.
        if (t < since) {
            phaseSince = t
            return StallOutcome.NONE
        }

        return when {
            phase == SwingPhase.BACKSWING && t - since > backswingTimeoutS ||
                phase == SwingPhase.TOP_OF_BACKSWING && t - since > topOfBackswingTimeoutS -> {
                // Nothing struck, so nothing to lose by dropping it.
                reset()
                StallOutcome.ABANDONED
            }

            phase == SwingPhase.IMPACT && t - since > impactTimeoutS -> {
                // A real spike WAS seen; only the settle never came. Closing the
                // swing here records the shot instead of throwing it away.
                tFinish = t
                phase = SwingPhase.FINISHED
                StallOutcome.COMPLETED
            }

            // DOWNSWING has its own escape (airSwingTimeoutS); FINISHED is
            // consumed by the caller.
            else -> StallOutcome.NONE
        }
    }

    fun reset() {
        phase = SwingPhase.IDLE
        phaseSince = null
        tStart = null; tTop = null; tImpact = null; tFinish = null
        isAirSwing = false
        peakImpactG = 0.0
        quietSince = null
        dominantAxis = 0
        lastSignAtDominant = 0.0
        downswingStart = null
        peakOmega = 0.0
        peakOmegaTime = null
    }

    private fun signOf(v: Double): Double = when {
        v > 0 -> 1.0
        v < 0 -> -1.0
        else -> 0.0
    }

    private fun indexOfMaxAbs(s: MotionSample): Int {
        val ax = abs(s.gx); val ay = abs(s.gy); val az = abs(s.gz)
        return when {
            ax >= ay && ax >= az -> 0
            ay >= ax && ay >= az -> 1
            else -> 2
        }
    }
}
