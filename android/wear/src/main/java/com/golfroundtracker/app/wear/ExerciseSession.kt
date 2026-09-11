package com.golfroundtracker.app.wear

import android.content.Context
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseState
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.health.services.client.data.SampleDataPoint
import androidx.health.services.client.data.WarmUpConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.guava.await

/**
 * The Wear stand-in for watchOS's `HKWorkoutSession`.
 *
 * WHAT IT IS ACTUALLY FOR. Not heart rate, and not the calorie count — those are
 * a side effect. It is the only sanctioned way to tell Wear OS "this app is
 * mid-activity, do not suspend it", and without one the round screen's GPS stops
 * within seconds of the wrist dropping. That is the exact failure the watchOS
 * app hit and solved the same way: a watchdog is not enough, the platform has to
 * be told what the app is doing.
 *
 * DEGRADES RATHER THAN FAILS. A watch with no Health Services, no GOLF exercise
 * type, or a user who refuses body sensors still gets a working round screen —
 * it just stops updating when the screen does. Refusing to run at all because a
 * heart-rate permission was declined would be the wrong trade for a yardage app.
 */
class ExerciseSession(private val context: Context) {

    private val client = HealthServices.getClient(context).exerciseClient

    private val _state = MutableStateFlow(Status.Idle)
    val state: StateFlow<Status> = _state

    enum class Status { Idle, Warmup, Active, Unavailable }

    /**
     * Heart-rate summary over the session.
     *
     * ACCUMULATED HERE rather than asked for at the end, because Health Services
     * streams samples and keeps no history: whatever is not collected as it
     * arrives is gone. Min and max are exactly why — an average could be derived
     * later from a total, but the extremes cannot be reconstructed from
     * anything.
     *
     * `count == 0` means no readings, which is a real and common state: a watch
     * with the sensor refused, an exercise that never started, or simply a
     * session short enough that none arrived. Callers must distinguish it from
     * zero BPM rather than sending a zero the phone would store as a reading.
     */
    private var hrSum = 0.0
    private var hrCount = 0
    private var hrMin = Double.MAX_VALUE
    private var hrMax = 0.0
    private var calories = 0.0

    data class HealthSummary(
        val avgHeartRate: Int?,
        val minHeartRate: Int?,
        val maxHeartRate: Int?,
        val activeCalories: Int?
    )

    fun summary(): HealthSummary =
        if (hrCount == 0) {
            HealthSummary(null, null, null, calories.takeIf { it > 0 }?.toInt())
        } else {
            HealthSummary(
                avgHeartRate = (hrSum / hrCount).toInt(),
                minHeartRate = hrMin.toInt(),
                maxHeartRate = hrMax.toInt(),
                activeCalories = calories.takeIf { it > 0 }?.toInt()
            )
        }

    private fun resetSummary() {
        hrSum = 0.0; hrCount = 0; hrMin = Double.MAX_VALUE; hrMax = 0.0; calories = 0.0
    }

    /**
     * Start a golf exercise, or report that we cannot.
     *
     * Capabilities are checked rather than assumed: `ExerciseType.GOLF` is
     * widely but not universally supported, and asking for a data type the watch
     * cannot produce fails the whole session rather than dropping that one type.
     * So the requested set is INTERSECTED with what this device says it can do.
     */
    suspend fun start(): Boolean {
        resetSummary()
        return try {
            val capabilities = client.getCapabilitiesAsync().await()
            val golf = capabilities.getExerciseTypeCapabilities(ExerciseType.GOLF)

            val wanted = setOf(DataType.HEART_RATE_BPM, DataType.CALORIES_TOTAL)
            val supported = wanted.intersect(golf.supportedDataTypes)

            client.setUpdateCallback(callback)

            // A warm-up first, when the device offers one: it spins the heart
            // rate sensor up so the exercise does not start against a stream
            // that is not producing yet.
            if (golf.supportedDataTypes.contains(DataType.HEART_RATE_BPM)) {
                client.prepareExerciseAsync(
                    WarmUpConfig(ExerciseType.GOLF, setOf(DataType.HEART_RATE_BPM))
                ).await()
                _state.value = Status.Warmup
            }

            client.startExerciseAsync(
                ExerciseConfig(
                    exerciseType = ExerciseType.GOLF,
                    dataTypes = supported,
                    // The app decides when a round is over, not a step count or
                    // a pause heuristic — a golfer stands still for minutes at a
                    // time and an auto-pause mid-fairway would end the session
                    // under them.
                    isAutoPauseAndResumeEnabled = false,
                    isGpsEnabled = false
                )
            ).await()
            _state.value = Status.Active
            true
        } catch (err: Throwable) {
            // No Health Services, no GOLF support, permission refused: all
            // survivable. See the class comment.
            android.util.Log.w("ExerciseSession", "could not start golf exercise", err)
            _state.value = Status.Unavailable
            false
        }
    }

    suspend fun end() {
        try {
            client.endExerciseAsync().await()
        } catch (err: Throwable) {
            // Ending something that was never running, or that the system ended
            // for us. Nothing to recover.
            android.util.Log.w("ExerciseSession", "could not end exercise", err)
        } finally {
            // ...Async, and its result is ignored: we are tearing down either
            // way, and a failure here means the callback was already gone.
            runCatching { client.clearUpdateCallbackAsync(callback) }
            _state.value = Status.Idle
        }
    }

    private val callback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            collectMetrics(update)
            _state.value = when (update.exerciseStateInfo.state) {
                ExerciseState.ACTIVE -> Status.Active
                ExerciseState.PREPARING -> Status.Warmup
                // ENDED / TERMINATED, whoever ended it. The service watches this
                // so a session the SYSTEM killed — the usual cause being another
                // app claiming the exercise — does not leave the round screen
                // believing it is still protected.
                else -> if (update.exerciseStateInfo.state.isEnded) Status.Idle else Status.Active
            }
        }

        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) = Unit

        /**
         * Fold this update's samples into the running summary.
         *
         * Heart rate arrives as DELTA samples (several per update, each a
         * reading) while calories arrive as an AGGREGATE total, so the two are
         * read differently: samples are folded in, the total simply replaces
         * what we had. Reading calories as a delta and summing them would
         * multiply the number by however many updates the session saw.
         */
        private fun collectMetrics(update: ExerciseUpdate) {
            val samples: List<SampleDataPoint<Double>> =
                update.latestMetrics.getData(DataType.HEART_RATE_BPM)
            for (sample in samples) {
                val bpm = sample.value
                // Health Services reports 0 while the sensor is searching for a
                // reading — folding those in would drag the average down and
                // make the minimum meaningless.
                if (bpm <= 0) continue
                hrSum += bpm
                hrCount++
                if (bpm < hrMin) hrMin = bpm
                if (bpm > hrMax) hrMax = bpm
            }
            update.latestMetrics.getData(DataType.CALORIES_TOTAL)?.let {
                calories = it.total
            }
        }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) = Unit
        override fun onRegistered() = Unit
        override fun onRegistrationFailed(throwable: Throwable) {
            android.util.Log.w("ExerciseSession", "exercise registration failed", throwable)
            _state.value = Status.Unavailable
        }
    }
}
