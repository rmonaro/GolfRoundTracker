package com.golfroundtracker.app.wear

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import java.util.UUID

/**
 * A practice session: every swing measured, none of them a shot.
 *
 * The difference from round mode is what gets sent, not what gets detected.
 * Round mode forwards a bare `roundImpact` and DISCARDS rehearsals, because its
 * job is to tell the phone a ball was struck. Practice forwards the full metric
 * bundle for EVERY swing including air swings — a rehearsal is still a swing
 * worth feedback on, and `isAirSwing` travels with it so the phone can keep it
 * out of the real-swing statistics itself.
 *
 * The session id is minted on the watch. Practice has to work with the phone in
 * a bag across the range, so the watch cannot wait for the phone to name the
 * session before recording swings into it.
 */
class PracticeController(private val context: Context) {

    private val motion = SwingMotionService(context)
    private val detector = SwingDetector()
    private val calculator = SwingMetricsCalculator()
    private val buffer = ArrayDeque<MotionSample>()

    private val _active = MutableStateFlow(false)
    val active: StateFlow<Boolean> = _active

    private val _swingCount = MutableStateFlow(0)
    val swingCount: StateFlow<Int> = _swingCount

    /** The most recent swing, for the on-watch readout. */
    private val _lastSwing = MutableStateFlow<SwingMetrics?>(null)
    val lastSwing: StateFlow<SwingMetrics?> = _lastSwing

    private var sessionId: String? = null
    private var clubId: String? = null
    private var startedAtMillis = 0L

    fun start(scope: CoroutineScope, clubId: String?) {
        if (_active.value) return
        if (!motion.start()) {
            android.util.Log.w("Practice", "motion sensors unavailable — cannot run practice")
            return
        }
        val id = UUID.randomUUID().toString()
        sessionId = id
        this.clubId = clubId
        startedAtMillis = System.currentTimeMillis()
        _swingCount.value = 0
        _lastSwing.value = null
        _active.value = true

        PhoneLink.practiceStarted(context, id, clubId)

        motion.samples
            .filterNotNull()
            .onEach(::ingest)
            .launchIn(scope)
    }

    fun selectClub(clubId: String) {
        this.clubId = clubId
        sessionId?.let { PhoneLink.practiceClubSelected(context, it, clubId) }
    }

    fun end() {
        val id = sessionId ?: return
        val seconds = ((System.currentTimeMillis() - startedAtMillis) / 1000).toInt()
        motion.stop()
        detector.reset()
        buffer.clear()
        _active.value = false
        sessionId = null
        PhoneLink.practiceEnded(
            context,
            id,
            _swingCount.value,
            seconds,
            RoundService.currentHealthSummary()
        )
    }

    private fun ingest(sample: MotionSample) {
        val id = sessionId ?: return
        buffer.addLast(sample)
        while (buffer.size > MAX_BUFFER) buffer.removeFirst()

        if (detector.advance(sample) != SwingPhase.FINISHED) return

        val window = detector.takeCompletedWindow(buffer.toList())
        detector.reset()
        if (window == null) return

        val metrics = calculator.compute(window)
        _lastSwing.value = metrics
        // Air swings COUNT here — see the class comment. The phone decides what
        // to do with them; the watch's job is to report what happened.
        _swingCount.value = _swingCount.value + 1
        PhoneLink.swingDetected(context, id, _swingCount.value, clubId, metrics)
    }

    private companion object {
        const val MAX_BUFFER = 600 // ~6 s at 100 Hz, as in SwingTracker
    }
}
