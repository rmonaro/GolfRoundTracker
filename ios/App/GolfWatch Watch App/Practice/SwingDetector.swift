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

    // --- stuck-phase timeouts ---
    //
    // Without these the machine has NO route back to idle except completing a
    // swing, and that loses real shots on the course. Every non-idle phase is
    // entered on motion that only MIGHT be a swing: pulling a club from the
    // bag, a waggle, an arm swinging while walking. If that motion doesn't go
    // on to satisfy the next transition, the phase simply persists — and the
    // golfer's next real swing is then read as the CONTINUATION of the stale
    // one rather than a new swing from idle. Its backswing gets consumed as a
    // downswing, the window is wrong, and the shot is either mis-measured or
    // dropped as an air swing.
    //
    // Generous next to a real swing (takeaway to finish is ~1.5-2.5s), so a
    // slow deliberate backswing or a pause at the top is never cut short. These
    // only fire on motion that was never a swing to begin with.
    private let backswingTimeoutS = 3.0
    private let topOfBackswingTimeoutS = 3.0
    /// A settle that never arrives — the arm kept moving after a strike (walking
    /// off, or straight into a re-tee). The strike itself was real, so this
    /// CLOSES the swing rather than discarding it.
    private let impactTimeoutS = 4.0

    /// When the current phase was entered. Drives the timeouts above.
    private var phaseSince: TimeInterval?

    private var dominantAxis = 0
    private var lastSignAtDominant: Double = 0
    private var quietSince: TimeInterval?
    private var downswingStart: TimeInterval?
    private var peakOmega = 0.0
    private var peakOmegaTime: TimeInterval?

    /// Feed one sample. Returns `.finished` exactly once, on the sample that
    /// completes a swing; otherwise nil.
    func advance(with s: MotionSample) -> SwingPhase? {
        // Deal with a phase that is going nowhere BEFORE the transitions below,
        // so a stale phase never gets to consume this sample as if it were part
        // of its own swing.
        if phase != .idle {
            switch resolveStalledPhase(at: s.t) {
            case .none: break
            case .abandoned: return nil
            case .completed: return .finished
            }
        }

        switch phase {
        case .idle:
            if s.angularSpeed > startOmega {
                enter(.backswing, at: s.t)
                tStart = s.t
                dominantAxis = indexOfMaxAbs(s.rotationRate)
                lastSignAtDominant = signOf(s.rotationRate[dominantAxis])
            }

        case .backswing:
            let sg = signOf(s.rotationRate[dominantAxis])
            // The dominant rotation axis reverses direction at a low-speed
            // pivot = top of the backswing.
            if sg != 0 && sg != lastSignAtDominant && s.angularSpeed < startOmega {
                enter(.topOfBackswing, at: s.t)
                tTop = s.t
            }
            if sg != 0 { lastSignAtDominant = sg }

        case .topOfBackswing:
            if s.angularSpeed > startOmega {
                enter(.downswing, at: s.t)
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
                enter(.impact, at: s.t)
                tImpact = s.t
                quietSince = nil
            } else if let ds = downswingStart, s.t - ds > airSwingTimeoutS {
                // No contact within the window → rehearsal / air swing. Use the
                // peak-speed moment as the impact reference so the timing
                // metrics still work.
                enter(.impact, at: s.t)
                isAirSwing = true
                tImpact = peakOmegaTime ?? s.t
                quietSince = nil
            }

        case .impact:
            if s.linearAccelMag > peakImpactG { peakImpactG = s.linearAccelMag }
            if s.angularSpeed < quietOmega {
                if let since = quietSince {
                    if s.t - since > finishSettleS {
                        enter(.finished, at: s.t)
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

    /// Move to `next`, remembering when — the timeouts are measured from here.
    private func enter(_ next: SwingPhase, at t: TimeInterval) {
        phase = next
        phaseSince = t
    }

    private enum StallOutcome {
        /// Still within its allowance — carry on.
        case none
        /// Nothing had been struck yet, so the phase was simply dropped.
        case abandoned
        /// A real strike was already detected; the swing was closed out.
        case completed
    }

    /// Handle a phase that has outstayed its allowance.
    ///
    /// Only HARD timeouts, deliberately. An earlier version also abandoned a
    /// phase whose motion had gone quiet, which reads as the obvious signal —
    /// but at the top of the backswing the wrist IS quiet, so it fired during
    /// real swings. Resetting there is worse than the stall it cured: the
    /// downswing then re-enters `.backswing` from idle and the impact spike
    /// arrives in a phase that cannot recognise it, losing the shot outright.
    ///
    /// The allowances below are long next to a real swing, so they only ever
    /// fire on motion that was never a swing. Recovering in three seconds
    /// instead of never is what matters here — shots are minutes apart.
    private func resolveStalledPhase(at t: TimeInterval) -> StallOutcome {
        guard let since = phaseSince else {
            // No entry stamp — adopt this sample so the timeout has an origin.
            phaseSince = t
            return .none
        }
        // Clock went backwards (CoreMotion re-bases timestamps across a
        // restart). Re-anchor rather than treating every sample as an eternity.
        if t < since {
            phaseSince = t
            return .none
        }

        switch phase {
        case .backswing where t - since > backswingTimeoutS,
             .topOfBackswing where t - since > topOfBackswingTimeoutS:
            // Nothing was struck, so there is nothing to lose by dropping it.
            reset()
            return .abandoned

        case .impact where t - since > impactTimeoutS:
            // A real impact spike WAS seen; only the settle never came. Closing
            // the swing here records the shot instead of throwing it away.
            tFinish = t
            phase = .finished
            return .completed

        default:
            // `.downswing` has its own escape (airSwingTimeoutS) and `.finished`
            // is consumed by the caller on the next line.
            return .none
        }
    }

    func reset() {
        phase = .idle
        phaseSince = nil
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
