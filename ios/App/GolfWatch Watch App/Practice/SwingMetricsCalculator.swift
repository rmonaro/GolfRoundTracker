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

        return SwingMetrics(
            backswingTimeMs: Int(backswingMs.rounded()),
            downswingTimeMs: Int(downswingMs.rounded()),
            tempoRatio: round2(tempo),
            transitionScore: transitionScore(w),
            estimatedHandSpeed: handSpeedScore(w),
            wristRotationScore: wristRotationScore(w),
            finishStabilityScore: finishStabilityScore(w),
            planeAxis: meanRotationAxis(w)
        )
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

    /// Mean angular-velocity direction through the downswing, normalised. Used
    /// only to compare swing-motion-pattern consistency across swings — it is
    /// NOT an absolute swing-plane angle.
    private func meanRotationAxis(_ w: SwingWindow) -> [Double] {
        let down = w.samples.filter { $0.t >= w.tTop && $0.t <= w.tImpact }
        var acc = simd_double3(0, 0, 0)
        for s in down { acc += s.rotationRate }
        let n = simd_length(acc)
        let unit = n > 1e-6 ? acc / n : simd_double3(0, 0, 0)
        return [unit.x, unit.y, unit.z]
    }

    // --- helpers ---
    private func mean(_ xs: [Double]) -> Double {
        xs.isEmpty ? 0 : xs.reduce(0, +) / Double(xs.count)
    }
    private func clampScore(_ v: Double) -> Int { max(0, min(100, Int(v.rounded()))) }
    private func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
}
