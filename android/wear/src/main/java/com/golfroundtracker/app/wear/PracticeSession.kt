package com.golfroundtracker.app.wear

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Process-wide handle on the practice session.
 *
 * Needed because the session is started and stopped from three places that
 * cannot see each other: the watch UI, the phone (an `endPractice` command
 * arrives at a WearableListenerService with no Activity alive), and the app
 * going away. Holding the controller here — on the APPLICATION context, never
 * an Activity — is what lets the phone end a session the user started on the
 * watch.
 */
object PracticeSession {
    private var controller: PracticeController? = null

    /** Mirrors the controller's flow so the UI can observe before one exists. */
    private val _active = MutableStateFlow(false)
    val active: StateFlow<Boolean> = _active

    private fun controller(context: Context): PracticeController =
        controller ?: PracticeController(context.applicationContext).also { controller = it }

    fun start(context: Context, scope: CoroutineScope, clubId: String?) {
        // The SAME foreground service a round uses. Practice has exactly the
        // problem Phase 3 solved for rounds — a swing happens with the wrist
        // down and the screen off — and it is also where the exercise session
        // that collects heart rate lives.
        RoundService.start(context)
        val c = controller(context)
        c.start(scope, clubId)
        _active.value = true
    }

    fun end(context: Context) {
        controller?.end()
        _active.value = false
        // Leave the service running if a ROUND is still live; it belongs to
        // whichever session is still going. Stopping it here would kill a
        // round's GPS because the golfer finished a practice session.
        if (!RoundStateStore.state.value.active) RoundService.stop(context)
    }

    fun selectClub(context: Context, clubId: String) {
        controller(context).selectClub(clubId)
    }

    fun swingCount(context: Context): StateFlow<Int> = controller(context).swingCount
    fun lastSwing(context: Context): StateFlow<SwingMetrics?> = controller(context).lastSwing
}
