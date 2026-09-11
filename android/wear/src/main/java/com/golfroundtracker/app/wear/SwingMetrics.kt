package com.golfroundtracker.app.wear

/**
 * A swing's compact motion summary.
 *
 * EVERY FIELD IS A RELATIVE ESTIMATE OR A 0-100 SCORE — never an absolute
 * measurement of club or ball. That is not modesty, it is what a wrist-mounted
 * gyroscope can honestly claim: it sees the watch move, and nothing else. The
 * naming keeps that visible (`estimatedHandSpeed`, not `clubSpeed`) because the
 * moment one of these is presented as mph, it is a lie the hardware can't back.
 */
data class SwingMetrics(
    val backswingTimeMs: Int,
    val downswingTimeMs: Int,
    val tempoRatio: Double,
    val transitionScore: Int,
    val estimatedHandSpeed: Int,
    val wristRotationScore: Int,
    val finishStabilityScore: Int,
    /** Unit rotation-axis vector, for comparing swing PATTERNS across swings.
     *  Not an absolute swing-plane angle. */
    val planeAxis: List<Double>,
    val swingType: String,
    val isAirSwing: Boolean,
    /** Integrated wrist rotation over the backswing, radians. */
    val backswingRotation: Double,
    val releaseTimingScore: Int,
    val decelerationScore: Int,
    val transitionDirectionScore: Int,
    /** Gravity direction at takeaway — a setup-repeatability proxy. */
    val addressGravity: List<Double>,
    val peakImpactG: Double
)
