import Foundation
import simd

/// Turns a completed `SwingWindow` into compact `SwingMetrics`. All outputs
/// are relative/estimated — timings in ms plus 0-100 scores. Nothing here is
/// an absolute physical measurement of the club or ball.
struct SwingMetricsCalculator {
    func compute(_ w: SwingWindow) -> SwingMetrics {
        let backswingMs = (w.tTop - w.tStart) * 1000
        let downswingMs = (w.tImpact - w.tTop) * 1000
        let tempo = downswingMs > 1 ? backswingMs / downswingMs : 0

        let peakOmega = w.samples.map(\.angularSpeed).max() ?? 0
        let backswingRotation = integratedRotation(w, from: w.tStart, to: w.tTop)

        return SwingMetrics(
            backswingTimeMs: Int(backswingMs.rounded()),
            downswingTimeMs: Int(downswingMs.rounded()),
            tempoRatio: round2(tempo),
            transitionScore: transitionScore(w),
            estimatedHandSpeed: handSpeedScore(w),
            wristRotationScore: wristRotationScore(w),
            finishStabilityScore: finishStabilityScore(w),
            planeAxis: meanRotationAxis(w, from: w.tTop, to: w.tImpact),
            swingType: classifySwing(w, peakOmega: peakOmega, backswingRotation: backswingRotation),
            isAirSwing: w.isAirSwing,
            backswingRotation: round2(backswingRotation),
            releaseTimingScore: releaseTimingScore(w),
            decelerationScore: decelerationScore(w),
            transitionDirectionScore: transitionDirectionScore(w),
            addressGravity: addressGravity(w),
            peakImpactG: w.peakImpactG
        )
    }

    // MARK: - Phase 1 derived signals

    /// Estimated swing classification from motion magnitude + duration +
    /// whether contact occurred. Thresholds are rough — labeled "estimated".
    private func classifySwing(_ w: SwingWindow, peakOmega: Double, backswingRotation: Double) -> String {
        if w.isAirSwing { return "air" }
        let totalMs = (w.tFinish - w.tStart) * 1000
        // Putts: very low wrist speed and a short, quiet stroke.
        if peakOmega < 5 && backswingRotation < 1.2 { return "putt" }
        // Chips: low speed, short backswing.
        if peakOmega < 9 || backswingRotation < 1.6 { return "chip" }
        // Pitches: moderate speed / partial backswing or a shorter total.
        if peakOmega < 16 || backswingRotation < 2.4 || totalMs < 900 { return "pitch" }
        return "full"
    }

    /// Integrate |angular velocity| over a sub-window → total wrist rotation
    /// (radians). A motion amount; the UI shows it as relative short/normal/long.
    private func integratedRotation(_ w: SwingWindow, from: TimeInterval, to: TimeInterval) -> Double {
        let seg = w.samples.filter { $0.t >= from && $0.t <= to }
        guard seg.count > 1 else { return 0 }
        var total = 0.0
        for i in 1..<seg.count {
            let dt = seg[i].t - seg[i - 1].t
            total += seg[i].angularSpeed * dt
        }
        return total
    }

    /// 0-100: how late in the downswing the wrist's peak speed occurs. A later
    /// peak (closer to impact) reads as more retained speed / lag.
    private func releaseTimingScore(_ w: SwingWindow) -> Int {
        let down = w.samples.filter { $0.t >= w.tTop && $0.t <= w.tImpact }
        guard down.count > 1, w.tImpact > w.tTop else { return 50 }
        let peak = down.max(by: { $0.angularSpeed < $1.angularSpeed })
        guard let tPeak = peak?.t else { return 50 }
        let frac = (tPeak - w.tTop) / (w.tImpact - w.tTop)
        return clampScore(frac * 100)
    }

    /// 0-100: accelerating through impact (high) vs quitting on it (low).
    /// Compares wrist speed in the last ~50ms before impact to the ~50ms before
    /// that.
    private func decelerationScore(_ w: SwingWindow) -> Int {
        let late = w.samples.filter { $0.t >= w.tImpact - 0.05 && $0.t <= w.tImpact }
        let early = w.samples.filter { $0.t >= w.tImpact - 0.10 && $0.t < w.tImpact - 0.05 }
        guard !late.isEmpty, !early.isEmpty else { return 50 }
        let lateAvg = mean(late.map(\.angularSpeed))
        let earlyAvg = mean(early.map(\.angularSpeed))
        guard earlyAvg > 1e-3 else { return 50 }
        // Still speeding up → >50; slowing down → <50.
        let ratio = (lateAvg - earlyAvg) / earlyAvg
        return clampScore(50 + ratio * 100)
    }

    /// 0-100: how consistent the rotation axis stays from backswing to
    /// downswing. A large shift reads as an "over-the-top"-style direction
    /// change. A motion tendency — NOT a measured club path.
    private func transitionDirectionScore(_ w: SwingWindow) -> Int {
        let backAxis = meanRotationAxis(w, from: w.tStart, to: w.tTop)
        let downAxis = meanRotationAxis(w, from: w.tTop, to: w.tImpact)
        let sim = dot(backAxis, downAxis) // -1..1, 1 = same direction
        return clampScore((sim + 1) / 2 * 100)
    }

    /// Gravity direction at takeaway — a proxy for setup/address orientation,
    /// compared across swings on the phone for setup repeatability.
    private func addressGravity(_ w: SwingWindow) -> [Double] {
        guard let first = w.samples.first else { return [0, 0, 0] }
        let g = first.gravity
        return [g.x, g.y, g.z]
    }

    /// Smoothness of the velocity reversal at the top: lower jerk (rate of
    /// change of acceleration) through a window around the top = smoother.
    private func transitionScore(_ w: SwingWindow, windowS: Double = 0.12) -> Int {
        let lo = w.tTop - windowS, hi = w.tTop + windowS
        let seg = w.samples.filter { $0.t >= lo && $0.t <= hi }
        guard seg.count > 2 else { return 50 }
        var jerk = 0.0
        for i in 1..<seg.count {
            let dt = max(seg[i].t - seg[i - 1].t, 1e-3)
            jerk += simd_length(seg[i].userAccel - seg[i - 1].userAccel) / dt
        }
        let avgJerk = jerk / Double(seg.count - 1)
        // 60 g/s ≈ an aggressive transition; clamp to a 0-100 smoothness score.
        return clampScore((1 - min(avgJerk / 60.0, 1)) * 100)
    }

    /// Peak angular speed near impact mapped to a RELATIVE 0-100 effort scale.
    /// Deliberately not converted to mph or club-head speed.
    private func handSpeedScore(_ w: SwingWindow) -> Int {
        let peak = w.samples.map(\.angularSpeed).max() ?? 0
        return clampScore(peak / 35.0 * 100) // 35 rad/s ≈ a fast wrist
    }

    /// Consistency/smoothness of forearm roll through the downswing.
    private func wristRotationScore(_ w: SwingWindow) -> Int {
        let down = w.samples.filter { $0.t >= w.tTop && $0.t <= w.tImpact }
        guard !down.isEmpty else { return 50 }
        let rolls = down.map { abs($0.rotationRate.z) } // z ≈ crown/forearm axis
        let m = mean(rolls)
        let varc = mean(rolls.map { ($0 - m) * ($0 - m) })
        return clampScore((1 - min(varc / (m * m + 1e-3), 1)) * 100)
    }

    /// Inverse of acceleration variance in the ~600ms after impact: steadier
    /// = more stable finish.
    private func finishStabilityScore(_ w: SwingWindow) -> Int {
        let lo = w.tImpact, hi = w.tImpact + 0.6
        let seg = w.samples.filter { $0.t >= lo && $0.t <= hi }
        guard !seg.isEmpty else { return 50 }
        let mags = seg.map(\.linearAccelMag)
        let m = mean(mags)
        let varc = mean(mags.map { ($0 - m) * ($0 - m) })
        return clampScore((1 - min(varc / 1.5, 1)) * 100)
    }

    /// Mean angular-velocity direction over a sub-window, normalised. Used only
    /// to compare swing-motion-pattern consistency across swings — it is NOT an
    /// absolute swing-plane angle.
    private func meanRotationAxis(_ w: SwingWindow, from: TimeInterval, to: TimeInterval) -> [Double] {
        let seg = w.samples.filter { $0.t >= from && $0.t <= to }
        var acc = simd_double3(0, 0, 0)
        for s in seg { acc += s.rotationRate }
        let n = simd_length(acc)
        let unit = n > 1e-6 ? acc / n : simd_double3(0, 0, 0)
        return [unit.x, unit.y, unit.z]
    }

    // --- helpers ---
    private func mean(_ xs: [Double]) -> Double {
        xs.isEmpty ? 0 : xs.reduce(0, +) / Double(xs.count)
    }
    private func dot(_ a: [Double], _ b: [Double]) -> Double {
        var s = 0.0
        for i in 0..<min(a.count, b.count) { s += a[i] * b[i] }
        return s
    }
    private func clampScore(_ v: Double) -> Int { max(0, min(100, Int(v.rounded()))) }
    private func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
}
