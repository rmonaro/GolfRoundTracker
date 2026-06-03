import Foundation
import simd

/// One high-rate motion sample from CoreMotion device-motion. Gravity is
/// already separated out by the framework, so `userAccel` is linear
/// acceleration in g and `rotationRate` is angular velocity in rad/s.
struct MotionSample {
    let t: TimeInterval
    let userAccel: simd_double3      // linear acceleration (g), gravity removed
    let rotationRate: simd_double3   // angular velocity (rad/s)
    let gravity: simd_double3        // gravity direction (g)

    var angularSpeed: Double { simd_length(rotationRate) }
    var linearAccelMag: Double { simd_length(userAccel) }
}

/// A completed swing's sample window plus the phase timestamps the detector
/// found. Consumed by `SwingMetricsCalculator`.
struct SwingWindow {
    let samples: [MotionSample]
    let tStart: TimeInterval
    let tTop: TimeInterval
    let tImpact: TimeInterval
    let tFinish: TimeInterval
}

/// Reduced, compact per-swing output. Every field is a MOTION-BASED ESTIMATE
/// or RELATIVE 0-100 score — never an absolute ball/club measurement. This is
/// the only thing shipped over WatchConnectivity per swing.
struct SwingMetrics {
    let backswingTimeMs: Int
    let downswingTimeMs: Int
    let tempoRatio: Double
    let transitionScore: Int        // 0-100 smoothness
    let estimatedHandSpeed: Int     // 0-100 relative effort (NOT mph)
    let wristRotationScore: Int     // 0-100 pattern smoothness
    let finishStabilityScore: Int   // 0-100
    let planeAxis: [Double]         // unit rotation-axis vector for pattern compare
}
