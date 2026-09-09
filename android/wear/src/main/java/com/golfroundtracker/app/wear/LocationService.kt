package com.golfroundtracker.app.wear

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
/** A fix, with what it takes to judge whether to trust it. */
data class Fix(
    val lat: Double,
    val lng: Double,
    /** Metres of horizontal error the provider claims. */
    val accuracyM: Float,
    /** Device uptime-based epoch millis, for age. */
    val atMillis: Long
) {
    /**
     * Error budget combining what the fix claims with how stale it is.
     *
     * Mirrors `WatchSession.effectiveErrorM` on watchOS (see the GPS invariant
     * in the round-mode notes): a golfer walks about 1.4 m/s, so a ten-second-old
     * fix is fourteen metres of uncertainty on top of whatever the provider
     * admits to. Ranking on accuracy alone put recorded shots on the wrong side
     * of greens.
     */
    fun effectiveErrorM(nowMillis: Long): Double {
        val ageSeconds = ((nowMillis - atMillis).coerceAtLeast(0L)) / 1000.0
        return accuracyM + ageSeconds * WALKING_SPEED_MPS
    }

    companion object {
        private const val WALKING_SPEED_MPS = 1.4
    }
}

/**
 * The watch's own GPS.
 *
 * The watch computes its own distance-to-pin rather than rendering a number the
 * phone pushed — that is the [[watch-source-of-truth]] rule, and it is not an
 * optimisation. A phone in a pocket has its JS suspended, so every pushed value
 * freezes at whatever it was when the screen went off; a golfer walking up the
 * fairway would watch a stale yardage stay put. Only the watch knows where the
 * watch is.
 */
class LocationService(private val context: Context) {

    private val client = LocationServices.getFusedLocationProviderClient(context)

    private var callback: LocationCallback? = null

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Start listening. Idempotent — calling it twice does not double the drain.
     *
     * One second is the same cadence the phone's round watcher uses. It is
     * frequent enough that the yardage moves as the golfer walks, and on a watch
     * it is affordable ONLY while the round screen is actually up, which is why
     * stop() is wired to the composable's lifecycle rather than the process.
     */
    @SuppressLint("MissingPermission")
    fun start() {
        if (callback != null || !hasPermission()) return

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000L)
            // Let the provider batch slightly rather than waking for every
            // single fix; the UI cannot show more than this anyway.
            .setMinUpdateIntervalMillis(1_000L)
            .build()

        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location: Location = result.lastLocation ?: return
                // Published to the shared repository rather than held here:
                // the reader (the round screen) and the owner (RoundService)
                // have different lifetimes and must not depend on each other.
                LocationRepository.publish(
                    Fix(
                        lat = location.latitude,
                        lng = location.longitude,
                        accuracyM = location.accuracy,
                        atMillis = System.currentTimeMillis()
                    )
                )
            }
        }
        callback = cb
        client.requestLocationUpdates(request, cb, Looper.getMainLooper())
    }

    fun stop() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
    }
}
