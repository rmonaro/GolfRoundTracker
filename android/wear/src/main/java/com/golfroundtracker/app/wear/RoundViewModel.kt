package com.golfroundtracker.app.wear

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * What the round screen shows and what its buttons do.
 *
 * The distance on screen is computed HERE, from the watch's own fix against the
 * pin the phone supplied — not read from the phone's `distanceYards`. That is
 * the source-of-truth rule the watchOS app already follows: a phone in a pocket
 * has suspended JS, so every value it pushed freezes, and a golfer walking up
 * the fairway would watch a stale number sit still. The phone's figure is kept
 * only as the fallback for when the watch has no fix or the course has no pin.
 */
class RoundViewModel(app: Application) : AndroidViewModel(app) {

    /**
     * Only for the permission check and the manual start below. The FIXES come
     * from LocationRepository, published by RoundService — the UI stopped owning
     * location in Phase 3 so it could keep flowing with the screen off.
     */
    private val location = LocationService(app)

    /** True once the user has been asked and said yes; drives the prompt. */
    private val _hasLocationPermission = MutableStateFlow(location.hasPermission())
    val hasLocationPermission: StateFlow<Boolean> = _hasLocationPermission

    /** Set while a shot is being tracked from a captured start position. */
    private val _tracking = MutableStateFlow(false)
    val tracking: StateFlow<Boolean> = _tracking

    val screen: StateFlow<RoundScreenModel> =
        combine(
            RoundStateStore.state,
            RoundStateStore.heardFromPhone,
            LocationRepository.fix
        ) { state, heard, fix ->
            RoundScreenModel(
                state = state,
                heardFromPhone = heard,
                fix = fix,
                distance = distanceFor(state, fix)
            )
        }.stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            RoundScreenModel(RoundState.NONE, false, null, Distance.Unknown)
        )

    fun onPermissionResult(granted: Boolean) {
        _hasLocationPermission.value = granted
        // The service is what normally runs location. This covers the gap
        // before the first snapshot arrives, so the screen has a fix to show
        // while the user is still looking at it.
        if (granted) location.start()
    }

    fun startLocation() {
        if (location.hasPermission()) location.start()
    }

    /**
     * Stops only the UI's own stopgap request. RoundService's updates are
     * untouched — stopping THOSE when the screen closed is precisely the Phase 2
     * behaviour this phase exists to remove.
     */
    fun stopLocation() = location.stop()

    /**
     * Distance to the pin, preferring the watch's own reading.
     *
     * A fix worse than 40 m of effective error is DISCARDED rather than shown:
     * at that point the phone's last known figure — stale as it may be — is the
     * better answer, and a confidently wrong yardage is what makes a golfer pick
     * the wrong club. Same threshold the watchOS side uses for captured
     * positions.
     */
    private fun distanceFor(state: RoundState, fix: Fix?): Distance {
        val pinLat = state.pinLat
        val pinLng = state.pinLng
        if (fix != null && pinLat != null && pinLng != null &&
            fix.effectiveErrorM(System.currentTimeMillis()) <= MAX_TRUSTED_ERROR_M
        ) {
            val metres = Geo.metresBetween(fix.lat, fix.lng, pinLat, pinLng)
            return if (state.onGreen) {
                Distance.Feet(Geo.metresToFeet(metres), fromWatch = true)
            } else {
                Distance.Yards(Geo.metresToYards(metres), fromWatch = true)
            }
        }
        // Fall back to whatever the phone last calculated.
        return when {
            state.onGreen && state.distanceFeet != null ->
                Distance.Feet(state.distanceFeet, fromWatch = false)
            state.distanceYards != null ->
                Distance.Yards(state.distanceYards, fromWatch = false)
            else -> Distance.Unknown
        }
    }

    // --- Actions -------------------------------------------------------------

    fun toggleTracking(fix: Fix?) {
        val next = !_tracking.value
        _tracking.value = next
        PhoneLink.trackingShot(getApplication(), next, fix)
    }

    fun recordShotHere(fix: Fix?, clubId: String?) {
        PhoneLink.autoShot(getApplication(), clubId, fix)
        // Recording ends the tracked shot it belongs to.
        if (_tracking.value) {
            _tracking.value = false
            PhoneLink.trackingShot(getApplication(), false, null)
        }
    }

    fun navigate(next: Boolean) = PhoneLink.navigateHole(getApplication(), next)

    fun setPin(fix: Fix) = PhoneLink.setPin(getApplication(), fix)

    fun selectClub(clubId: String) = PhoneLink.selectClub(getApplication(), clubId)

    fun setAutoTrack(active: Boolean) = PhoneLink.setAutoTrack(getApplication(), active)

    /** Feeds the phone's map dot while a shot is being tracked. */
    fun publishPosition(fix: Fix) {
        if (!_tracking.value) return
        viewModelScope.launch { PhoneLink.trackingPosition(getApplication(), fix) }
    }

    override fun onCleared() {
        location.stop()
        super.onCleared()
    }

    companion object {
        private const val MAX_TRUSTED_ERROR_M = 40.0
    }
}

data class RoundScreenModel(
    val state: RoundState,
    val heardFromPhone: Boolean,
    val fix: Fix?,
    val distance: Distance
)

/** Distance plus WHERE it came from, because the UI says so. */
sealed interface Distance {
    data class Yards(val value: Int, val fromWatch: Boolean) : Distance
    data class Feet(val value: Int, val fromWatch: Boolean) : Distance
    data object Unknown : Distance
}
