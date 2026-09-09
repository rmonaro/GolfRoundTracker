package com.golfroundtracker.app.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps the round alive when the screen is not.
 *
 * THE PROBLEM THIS SOLVES. Through Phase 2 the GPS was started and stopped by
 * the round screen's composition, so it died with the screen — which on a watch
 * is a few seconds after the wrist drops, i.e. for essentially the whole round.
 * A golfer would look at their watch and see the yardage from wherever they were
 * standing when they last looked.
 *
 * TWO THINGS ARE NEEDED, and neither is sufficient alone:
 *
 *   • A FOREGROUND SERVICE with an ongoing notification, which is what lets the
 *     app hold location while backgrounded on modern Android at all.
 *   • A HEALTH SERVICES EXERCISE, which is what stops Wear OS from suspending
 *     the process regardless of what the service claims. This is the piece with
 *     no phone-Android analogue, and the piece people miss.
 *
 * Its lifetime is the ROUND, not the app. Started when the phone says a round is
 * active, stopped when it says otherwise — so a watch left on a charger with the
 * app open costs nothing.
 */
class RoundService : Service() {

    private val exercise by lazy { ExerciseSession(this) }
    private val location by lazy { LocationService(this) }
    private val swings by lazy { SwingTracker(this) }
    private var scope: CoroutineScope? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        // Must come first and within a few seconds of start, or the system kills
        // the service with a ForegroundServiceDidNotStartInTimeException.
        startForeground(NOTIFICATION_ID, buildNotification())

        if (scope == null) {
            val newScope = CoroutineScope(SupervisorJob())
            scope = newScope
            location.start()
            newScope.launch { exercise.start() }

            // Shot detection lives with the round, not the screen — a swing
            // happens with the wrist down and the display off, which is the
            // whole reason the exercise session above exists. The club and fix
            // are read lazily AT THE STRIKE so the impact carries what the
            // player actually had in hand, not what was selected when the
            // round began.
            if (RoundStateStore.state.value.shotDetection) {
                swings.start(
                    scope = newScope,
                    clubId = { RoundStateStore.state.value.selectedClubId },
                    fix = { LocationRepository.fix.value }
                )
            }
        }

        // START_STICKY: if the system does reclaim us mid-round, come back. The
        // round state itself is on the phone, so a restarted service rebuilds
        // everything it needs from the next snapshot — there is nothing to lose
        // by trying again.
        return START_STICKY
    }

    override fun onDestroy() {
        location.stop()
        swings.stop()
        scope?.cancel()
        scope = null

        // Ended on a scope that OUTLIVES the service, deliberately.
        //
        // `endExerciseAsync` is a round trip to Health Services, and cancelling
        // it half way leaves a session the system still believes is running —
        // which then refuses to let the NEXT round start one, so the failure
        // shows up an hour later on a different hole. The work is small and
        // bounded, so letting it finish unattended is the right trade.
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            exercise.end()
        }
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Round in progress",
                // LOW: an ongoing round is a status, not an alert. IMPORTANCE_MIN
                // would hide it, and a foreground service notification the user
                // cannot see is one they cannot dismiss or understand.
                NotificationManager.IMPORTANCE_LOW
            )
        )

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Round in progress")
            .setContentText("Tracking distances")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "grt_round"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_STOP = "com.golfroundtracker.app.wear.STOP_ROUND"

        /**
         * Idempotent. Called every time a snapshot says a round is active, which
         * is often — `startForegroundService` on an already-running service just
         * re-delivers to `onStartCommand`, which no-ops.
         */
        fun start(context: Context) {
            context.startForegroundService(Intent(context, RoundService::class.java))
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, RoundService::class.java).setAction(ACTION_STOP)
            )
        }
    }
}
