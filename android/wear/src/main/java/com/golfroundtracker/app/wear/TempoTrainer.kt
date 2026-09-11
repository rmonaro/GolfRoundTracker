package com.golfroundtracker.app.wear

import android.content.Context
import android.os.VibrationEffect
import android.os.VibratorManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Haptic tempo trainer: buzz a 3 : 1 backswing-to-downswing rhythm.
 *
 * No sensors, no permissions, nothing sent to the phone — purely a training aid.
 * A tap at takeaway, a tap at the top, a tap at "impact" one third of the
 * backswing later, then a rest so each rep feels like its own swing.
 *
 * 3 : 1 is the ratio tour players average and the one the phone's tempo score is
 * built around, which is why it is fixed rather than adjustable: a trainer that
 * can be set to any ratio trains nothing in particular. The backswing DURATION
 * is adjustable, because that is the part that differs between players.
 *
 * THE HAPTICS DIFFER FROM watchOS, unavoidably. `WKInterfaceDevice.play(.start /
 * .directionUp / .success)` are named system haptics with no Android equivalent;
 * Wear has raw vibration. The three beats are therefore distinguished by LENGTH
 * — short, short, longer at impact — so they stay tellable apart through a
 * sleeve without looking at the watch.
 */
class TempoTrainer(context: Context) {

    private val vibrator =
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)
            ?.defaultVibrator

    private val _backswingSeconds = MutableStateFlow(0.9)
    val backswingSeconds: StateFlow<Double> = _backswingSeconds

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running

    /** "Back" / "Top" / "Hit" — the current beat, for the screen. */
    private val _beat = MutableStateFlow("")
    val beat: StateFlow<String> = _beat

    private var job: Job? = null

    val downswingSeconds: Double get() = _backswingSeconds.value / 3.0

    /** Clamped: below ~0.4 s the three beats blur into one buzz. */
    fun adjust(delta: Double) {
        _backswingSeconds.value = (_backswingSeconds.value + delta).coerceIn(0.4, 2.0)
    }

    fun toggle(scope: CoroutineScope) {
        if (_running.value) stop() else start(scope)
    }

    private fun start(scope: CoroutineScope) {
        if (_running.value) return
        _running.value = true
        job = scope.launch {
            while (isActive) {
                cycle()
                // Rest between reps.
                delay(1_500)
            }
        }
    }

    fun stop() {
        _running.value = false
        _beat.value = ""
        job?.cancel()
        job = null
    }

    private suspend fun cycle() {
        val backMs = (_backswingSeconds.value.coerceAtLeast(0.3) * 1000).toLong()
        val downMs = (downswingSeconds.coerceAtLeast(0.1) * 1000).toLong()

        _beat.value = "Back"
        buzz(40)
        delay(backMs)
        if (!_running.value) return

        _beat.value = "Top"
        buzz(40)
        delay(downMs)
        if (!_running.value) return

        _beat.value = "Hit"
        // Longer, so impact is unmistakably the beat you swing through.
        buzz(90)
    }

    private fun buzz(ms: Long) {
        vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }
}
