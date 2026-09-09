package com.golfroundtracker.app.wear

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The watch's current position, wherever it was produced.
 *
 * A process-wide singleton because ownership MOVED in Phase 3. Location used to
 * be started and stopped by the round screen, which meant it died the moment
 * the screen did — fine for reading a yardage, useless for a round. It now
 * belongs to {@link RoundService}, a foreground service that outlives the UI,
 * and the UI became a reader.
 *
 * Keeping the flow here rather than on the service is what lets the two be
 * independent: the screen can compose before the service is up, and the service
 * keeps publishing after the screen is gone, with neither holding a reference
 * to the other.
 */
object LocationRepository {
    private val _fix = MutableStateFlow<Fix?>(null)
    val fix: StateFlow<Fix?> = _fix

    fun publish(fix: Fix) {
        _fix.value = fix
    }
}
