package com.golfroundtracker.app.wear

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Turns wrist motion into `roundImpact` messages for the phone.
 *
 * WHAT THE PHONE DOES WITH THESE, and therefore what matters: its auto-track
 * only treats a "walked, then stopped" pattern as a shot when a confirmed
 * strike arrived since the ball was last anchored. That is what kills the false
 * positives — a cart ride, a walk to the next tee. So the CONTRACT-CRITICAL
 * fields are `impactId` and `capturedAt`; `swingType` and `handSpeed` are
 * advisory, and the richer metric bundle is explicitly optional ("older watch
 * builds omit them"). This sends the first two properly and the advisory pair
 * honestly, and leaves the rest to a later phase rather than inventing numbers
 * that look like measurements.
 *
 * AIR SWINGS ARE NOT SENT. A rehearsal, a waggle, a turf brush on a practice
 * swing — the detector already distinguishes those (`isAirSwing`), and
 * forwarding them would defeat the very filtering the phone is relying on.
 */
class SwingTracker(private val context: Context) {

    private val motion = SwingMotionService(context)
    private val detector = SwingDetector()

    /**
     * Rolling window of recent samples, for slicing a completed swing out of.
     *
     * Six seconds at the requested 100 Hz. A swing is 1.5-2.5 s from takeaway to
     * finish, and the IMPACT stall timeout can stretch a window to four, so this
     * has to hold comfortably more than the longest swing the detector will
     * close — a buffer that wraps mid-swing yields a truncated window and a
     * mis-measured shot.
     */
    private val buffer = ArrayDeque<MotionSample>()

    /** Monotonic within a watch round session, as the phone's contract says. */
    private var impactId = 0

    private var running = false

    val measuredHz get() = motion.measuredHz

    fun start(scope: CoroutineScope, clubId: () -> String?, fix: () -> Fix?) {
        if (running) return
        if (!motion.start()) {
            // No gyroscope, or no linear-acceleration sensor. Everything else
            // about the round keeps working; only detection is off.
            android.util.Log.w("SwingTracker", "motion sensors unavailable — detection off")
            return
        }
        running = true

        motion.samples
            .filterNotNull()
            .onEach { sample -> ingest(sample, clubId(), fix()) }
            .launchIn(scope)
    }

    fun stop() {
        motion.stop()
        detector.reset()
        buffer.clear()
        running = false
    }

    private fun ingest(sample: MotionSample, clubId: String?, fix: Fix?) {
        buffer.addLast(sample)
        while (buffer.size > MAX_BUFFER) buffer.removeFirst()

        if (detector.advance(sample) != SwingPhase.FINISHED) return

        val window = detector.takeCompletedWindow(buffer.toList())
        detector.reset()
        if (window == null || window.isAirSwing) return

        impactId += 1
        PhoneLink.roundImpact(
            context = context,
            impactId = impactId,
            capturedAtMillis = System.currentTimeMillis(),
            swingType = classify(window),
            handSpeed = handSpeed(window),
            clubId = clubId,
            fix = fix
        )
    }

    /**
     * A coarse label from the swing's own shape — NOT a club inference.
     *
     * Backswing duration is the one signal available without the full metrics
     * calculator, and it separates the obvious cases: a putt barely rotates, a
     * full swing takes the better part of a second to reach the top. The phone
     * treats this as advisory, which is the only reason a heuristic this rough
     * is acceptable.
     */
    private fun classify(window: SwingWindow): String {
        val backswingS = window.tTop - window.tStart
        return when {
            backswingS < 0.25 -> "putt"
            backswingS < 0.45 -> "chip"
            backswingS < 0.65 -> "pitch"
            else -> "full"
        }
    }

    /**
     * 0-100 RELATIVE EFFORT, explicitly not mph.
     *
     * Peak angular speed scaled against a fast amateur swing. The watchOS field
     * is documented the same way, and it matters: presenting a wrist-derived
     * number as club-head speed would be a measurement the hardware cannot make.
     */
    private fun handSpeed(window: SwingWindow): Int {
        val peak = window.samples.maxOfOrNull { it.angularSpeed } ?: return 0
        return (min(1.0, peak / FAST_SWING_OMEGA) * 100).roundToInt()
    }

    private companion object {
        const val MAX_BUFFER = 600 // ~6 s at 100 Hz
        /** rad/s at the wrist for a hard full swing — the 100 mark. */
        const val FAST_SWING_OMEGA = 25.0
    }
}
