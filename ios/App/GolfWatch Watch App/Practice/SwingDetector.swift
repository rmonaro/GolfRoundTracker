import Foundation
import simd

/// Phases of a golf swing, detected from wrist motion only.
enum SwingPhase {
    case idle
    case backswing
    case topOfBackswing
    case downswing
    case impact
    case finished
}

/// State machine that walks wrist-motion samples through the swing phases and
/// reports when a full swing has completed. Thresholds are empirical and will
/// need on-watch tuning — they're surfaced here (not buried) for exactly that
/// reason.
///
/// Detection is intentionally simple (no ML): it keys off angular-speed onset,
/// a dominant-axis sign reversal at the top, the acceleration spike near
/// impact, and a settle window for the finish.
final class SwingDetector {
    private(set) var phase: SwingPhase = .idle
    private(set) var tStart: TimeInterval?
    private(set) var tTop: TimeInterval?
    private(set) var tImpact: TimeInterval?
    private(set) var tFinish: TimeInterval?
    /// True when the downswing decayed with no impact spike — a rehearsal /
    /// air swing. The calculator labels these and the phone keeps them out of
    /// the real-swing stats.
    private(set) var isAirSwing = false
    /// Peak linear-accel magnitude (g) seen from the downswing through impact.
    /// A real ball strike spikes far harder than a turf brush / rehearsal, so
    /// round-mode uses this to reject practice swings that graze the ground.
    private(set) var peakImpactG = 0.0

    // --- tunable thresholds ---
    /// Below this angular speed (rad/s) the wrist is considered quiet.
    private let quietOmega = 0.6
    /// Angular speed (rad/s) that marks the start of an intentional move.
    private let startOmega = 2.5
    /// Linear-accel spike (g) that marks the impact window.
    private let impactAccel = 2.5
    /// How long (s) motion must stay quiet after impact to call the finish.
    private let finishSettleS = 0.4
    /// If no impact spike lands within this long after the downswing starts,
    /// treat the swing as an air swing (impact ≈ the peak-speed moment).
    private let airSwingTimeoutS = 0.8

    private var dominantAxis = 0
    private var lastSignAtDominant: Double = 0
    private var quietSince: TimeInterval?
    private var downswingStart: TimeInterval?
    private var peakOmega = 0.0
    private var peakOmegaTime: TimeInterval?

    /// Feed one sample. Returns `.finished` exactly once, on the sample that
    /// completes a swing; otherwise nil.
    func advance(with s: MotionSample) -> SwingPhase? {
        switch phase {
        case .idle:
            if s.angularSpeed > startOmega {
                phase = .backswing
                tStart = s.t
                dominantAxis = indexOfMaxAbs(s.rotationRate)
                lastSignAtDominant = signOf(s.rotationRate[dominantAxis])
            }

        case .backswing:
            let sg = signOf(s.rotationRate[dominantAxis])
            // The dominant rotation axis reverses direction at a low-speed
            // pivot = top of the backswing.
            if sg != 0 && sg != lastSignAtDominant && s.angularSpeed < startOmega {
                phase = .topOfBackswing
                tTop = s.t
            }
            if sg != 0 { lastSignAtDominant = sg }

        case .topOfBackswing:
            if s.angularSpeed > startOmega {
                phase = .downswing
                downswingStart = s.t
                peakOmega = s.angularSpeed
                peakOmegaTime = s.t
            }

        case .downswing:
            if s.angularSpeed > peakOmega {
                peakOmega = s.angularSpeed
                peakOmegaTime = s.t
            }
            if s.linearAccelMag > peakImpactG { peakImpactG = s.linearAccelMag }
            if s.linearAccelMag >= impactAccel {
                // Real strike.
                phase = .impact
                tImpact = s.t
                quietSince = nil
            } else if let ds = downswingStart, s.t - ds > airSwingTimeoutS {
                // No contact within the window → rehearsal / air swing. Use the
                // peak-speed moment as the impact reference so the timing
                // metrics still work.
                phase = .impact
                isAirSwing = true
                tImpact = peakOmegaTime ?? s.t
                quietSince = nil
            }

        case .impact:
            if s.linearAccelMag > peakImpactG { peakImpactG = s.linearAccelMag }
            if s.angularSpeed < quietOmega {
                if let since = quietSince {
                    if s.t - since > finishSettleS {
                        phase = .finished
                        tFinish = s.t
                        return .finished
                    }
                } else {
                    quietSince = s.t
                }
            } else {
                quietSince = nil
            }

        case .finished:
            break
        }
        return nil
    }

    /// Slice the completed swing out of the rolling buffer.
    func takeCompletedWindow(from buffer: [MotionSample]) -> SwingWindow? {
        guard let a = tStart, let top = tTop, let imp = tImpact, let f = tFinish else { return nil }
        let samples = buffer.filter { $0.t >= a && $0.t <= f }
        guard samples.count > 3 else { return nil }
        return SwingWindow(
            samples: samples, tStart: a, tTop: top, tImpact: imp, tFinish: f,
            isAirSwing: isAirSwing, peakImpactG: peakImpactG
        )
    }

    func reset() {
        phase = .idle
        tStart = nil; tTop = nil; tImpact = nil; tFinish = nil
        isAirSwing = false
        peakImpactG = 0
        quietSince = nil
        dominantAxis = 0
        lastSignAtDominant = 0
        downswingStart = nil
        peakOmega = 0
        peakOmegaTime = nil
    }

    // --- helpers ---
    private func signOf(_ v: Double) -> Double {
        if v > 0 { return 1 }
        if v < 0 { return -1 }
        return 0
    }

    private func indexOfMaxAbs(_ v: simd_double3) -> Int {
        let ax = abs(v.x), ay = abs(v.y), az = abs(v.z)
        if ax >= ay && ax >= az { return 0 }
        if ay >= ax && ay >= az { return 1 }
        return 2
    }
}
