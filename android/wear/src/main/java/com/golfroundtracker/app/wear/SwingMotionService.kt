package com.golfroundtracker.app.wear

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The Android sensor pipeline, producing samples in CoreMotion's shape.
 *
 * THIS is the part of swing detection that is genuinely different, and the part
 * that took the work. iOS hands you `CMDeviceMotion`: one fused object, at a
 * guaranteed rate, with gravity already separated and the gyro bias already
 * removed. Android hands you three independent sensor streams that tick at
 * their own times, in SI units, and expects you to do the rest.
 *
 * THREE CONSEQUENCES, all of which are handled here:
 *
 *  1. FUSION. Linear acceleration, gyroscope and gravity arrive as separate
 *     events with separate timestamps. A sample is emitted on the GYROSCOPE
 *     tick — it is the signal the detector keys almost everything off — paired
 *     with the most recent reading from the other two. Waiting for all three to
 *     align would drop most of the rate for no gain.
 *
 *  2. UNITS. Android reports acceleration in m/s²; the detector's thresholds
 *     (`impactAccel = 2.5`) are in **g**, because they came from CoreMotion. The
 *     division below is not cosmetic — skip it and a brisk walk registers as a
 *     ball strike.
 *
 *  3. RATE IS NOT GUARANTEED. `SENSOR_DELAY_FASTEST` is a hint; what arrives
 *     depends on the hardware and on what else is listening. Impact is a
 *     millisecond-scale spike, so a watch delivering 50 Hz will MISS strikes
 *     that a 100 Hz watch catches — the detector will simply see fewer swings
 *     rather than report an error. The measured rate is published so that this
 *     is diagnosable on a real device instead of being guessed at.
 */
class SwingMotionService(context: Context) : SensorEventListener {

    private val sensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private val linearAccel = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val gyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val gravity = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)

    /** Latest of each stream, held until a gyro tick assembles a sample. */
    private var lastAccel = DoubleArray(3)
    private var lastGravity = DoubleArray(3)

    private val _samples = MutableStateFlow<MotionSample?>(null)
    val samples: StateFlow<MotionSample?> = _samples

    /** Measured sample rate, for diagnosing a watch that misses strikes. */
    private val _measuredHz = MutableStateFlow(0.0)
    val measuredHz: StateFlow<Double> = _measuredHz

    private var sampleCount = 0
    private var rateWindowStart = 0.0

    /** True when this watch has the sensors at all. */
    val isSupported: Boolean get() = linearAccel != null && gyroscope != null

    fun start(): Boolean {
        if (!isSupported) return false
        // 10 ms = 100 Hz requested, matching CoreMotion's default rate so the
        // ported thresholds see a comparable stream. The system may deliver
        // less; see measuredHz.
        val periodUs = 10_000
        sensorManager.registerListener(this, linearAccel, periodUs)
        sensorManager.registerListener(this, gyroscope, periodUs)
        gravity?.let { sensorManager.registerListener(this, it, periodUs) }
        return true
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        sampleCount = 0
        rateWindowStart = 0.0
    }

    override fun onSensorChanged(event: SensorEvent) {
        // Nanoseconds since boot → seconds, the unit the detector's timeouts
        // are written in.
        val t = event.timestamp / 1_000_000_000.0

        when (event.sensor.type) {
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                lastAccel[0] = event.values[0] / GRAVITY_MS2
                lastAccel[1] = event.values[1] / GRAVITY_MS2
                lastAccel[2] = event.values[2] / GRAVITY_MS2
            }

            Sensor.TYPE_GRAVITY -> {
                lastGravity[0] = event.values[0] / GRAVITY_MS2
                lastGravity[1] = event.values[1] / GRAVITY_MS2
                lastGravity[2] = event.values[2] / GRAVITY_MS2
            }

            Sensor.TYPE_GYROSCOPE -> {
                // The assembling tick — see note 1 in the class comment.
                _samples.value = MotionSample(
                    t = t,
                    ax = lastAccel[0], ay = lastAccel[1], az = lastAccel[2],
                    gx = event.values[0].toDouble(),
                    gy = event.values[1].toDouble(),
                    gz = event.values[2].toDouble(),
                    gravX = lastGravity[0], gravY = lastGravity[1], gravZ = lastGravity[2]
                )
                trackRate(t)
            }
        }
    }

    private fun trackRate(t: Double) {
        if (rateWindowStart == 0.0) {
            rateWindowStart = t
            sampleCount = 0
            return
        }
        sampleCount++
        val elapsed = t - rateWindowStart
        if (elapsed >= RATE_WINDOW_S) {
            _measuredHz.value = sampleCount / elapsed
            rateWindowStart = t
            sampleCount = 0
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    companion object {
        /** The same constant CoreMotion divides by to report in g. */
        private const val GRAVITY_MS2 = 9.80665
        private const val RATE_WINDOW_S = 5.0
    }
}
