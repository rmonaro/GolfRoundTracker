import Foundation
import Combine

/// Last-swing summary the active practice view renders.
struct SwingResult: Equatable {
    let tempoRatio: Double
    let headlineFeedback: String
    let transitionScore: Int
    let finishStabilityScore: Int
}

/// Drives the watch-side practice session: owns the motion service, walks the
/// swing count, and ships each detected swing to the phone via the existing
/// `WatchSession.send()` (live `sendMessage` → queued `transferUserInfo`
/// fallback). Practice is a SEPARATE mode from round play — it never runs
/// during a live round, so it can't interfere with shot tracking.
@MainActor
final class PracticeController: ObservableObject {
    static let shared = PracticeController()

    @Published private(set) var isActive = false
    @Published private(set) var isArmed = false
    @Published private(set) var swingCount = 0
    @Published private(set) var lastSwing: SwingResult?
    /// Practice-local club selection (independent of round state).
    @Published private(set) var selectedClubId: String?

    private let motion = SwingMotionService()
    private var sessionId = ""

    private init() {
        motion.onSwing = { [weak self] metrics in
            self?.handleSwing(metrics)
        }
    }

    var swingCountLabel: String {
        swingCount == 0 ? "No swings yet" : "Swing \(swingCount)"
    }

    func clubName(in bag: [WatchClub]) -> String? {
        guard let id = selectedClubId else { return nil }
        return bag.first(where: { $0.id == id })?.name
    }

    // MARK: - Session lifecycle

    func startSession(club: String?) {
        sessionId = UUID().uuidString
        selectedClubId = club
        swingCount = 0
        lastSwing = nil
        isActive = true
        WatchSession.shared.send(.practiceStarted(sessionId: sessionId, clubId: club))
        armDetection()
    }

    func endSession() {
        if isActive {
            WatchSession.shared.send(.practiceEnded(sessionId: sessionId, swingCount: swingCount))
        }
        disarmDetection()
        isActive = false
    }

    /// Start listening for swings. Idempotent. Called when the active view
    /// appears so motion only streams while the user is practising.
    func armDetection() {
        guard isActive, !isArmed else { return }
        motion.start()
        isArmed = true
    }

    /// Stop the motion stream (e.g. the active view disappeared). Keeps the
    /// session logically active so the user can resume.
    func disarmDetection() {
        guard isArmed else { return }
        motion.stop()
        isArmed = false
    }

    func selectClub(_ clubId: String) {
        selectedClubId = clubId
        if isActive {
            WatchSession.shared.send(.practiceClubSelected(sessionId: sessionId, clubId: clubId))
        }
    }

    // MARK: - Swing handling

    private func handleSwing(_ metrics: SwingMetrics) {
        let index = swingCount
        swingCount += 1
        WatchSession.shared.send(
            .swingDetected(sessionId: sessionId, swingIndex: index, metrics: metrics, clubId: selectedClubId)
        )
        lastSwing = SwingResult(
            tempoRatio: metrics.tempoRatio,
            headlineFeedback: headline(for: metrics),
            transitionScore: metrics.transitionScore,
            finishStabilityScore: metrics.finishStabilityScore
        )
    }

    /// Tiny on-watch headline so the user gets instant feedback without the
    /// phone round-trip. The phone runs the full rules engine.
    private func headline(for m: SwingMetrics) -> String {
        if m.transitionScore < 40 { return "Transition too aggressive" }
        if m.finishStabilityScore < 40 { return "Unstable finish" }
        if abs(m.tempoRatio - 3.0) <= 0.5 { return "Great tempo" }
        if m.tempoRatio > 0 && m.tempoRatio < 2.2 { return "Backswing rushed" }
        return "Logged"
    }
}
