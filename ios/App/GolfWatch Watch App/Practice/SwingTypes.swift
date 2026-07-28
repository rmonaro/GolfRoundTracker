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
    let isAirSwing: Bool
    /// Peak linear-accel (g) through impact — how hard the strike was.
    let peakImpactG: Double
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

    // --- Derived motion signals (Phase 1) ---
    let swingType: String           // "full" | "pitch" | "chip" | "putt" | "air"
    let isAirSwing: Bool            // no impact spike detected (a rehearsal)
    let backswingRotation: Double   // integrated wrist rotation over backswing (rad)
    let releaseTimingScore: Int     // 0-100 how late peak speed occurs (lag-like)
    let decelerationScore: Int      // 0-100 accelerating-through-impact vs quitting
    let transitionDirectionScore: Int // 0-100 axis consistency (over-the-top proxy)
    let addressGravity: [Double]    // gravity dir [x,y,z] at takeaway (setup compare)
    /// Peak linear-accel (g) through impact. Round-mode gates on this to reject
    /// practice swings / turf brushes that spike far softer than a ball strike.
    let peakImpactG: Double
}
