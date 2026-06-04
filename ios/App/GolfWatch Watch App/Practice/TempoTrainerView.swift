import SwiftUI
import WatchKit
import Combine

/// Haptic tempo trainer. Buzzes a target 3 : 1 backswing-to-downswing rhythm so
/// the user can groove their tempo: a tap at takeaway, a tap at the top, then a
/// tap at "impact" one-third of the backswing time later. No sensors, no
/// permissions — purely a training aid.
@MainActor
final class TempoTrainer: ObservableObject {
    /// Backswing duration in seconds; downswing is always 1/3 of it (3:1).
    @Published var backswingSeconds: Double = 0.9
    @Published private(set) var isRunning = false
    @Published private(set) var beat: String = ""

    private var task: Task<Void, Never>?

    var downswingSeconds: Double { backswingSeconds / 3.0 }

    func toggle() { isRunning ? stop() : start() }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        task = Task { [weak self] in
            while !Task.isCancelled {
                await self?.cycle()
                // Rest between reps so each rep feels like its own swing.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
            }
        }
    }

    func stop() {
        isRunning = false
        beat = ""
        task?.cancel()
        task = nil
    }

    private func cycle() async {
        let backNs = UInt64(max(0.3, backswingSeconds) * 1_000_000_000)
        let downNs = UInt64(max(0.1, downswingSeconds) * 1_000_000_000)

        // Takeaway.
        WKInterfaceDevice.current().play(.start)
        beat = "Back"
        try? await Task.sleep(nanoseconds: backNs)
        if Task.isCancelled { return }

        // Top of the backswing.
        WKInterfaceDevice.current().play(.directionUp)
        beat = "Top"
        try? await Task.sleep(nanoseconds: downNs)
        if Task.isCancelled { return }

        // Impact.
        WKInterfaceDevice.current().play(.success)
        beat = "Hit"
    }
}

struct TempoTrainerView: View {
    @StateObject private var trainer = TempoTrainer()

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("Tempo Trainer")
                    .font(.headline)
                Text("3 : 1")
                    .font(.system(size: 32, weight: .bold))
                Text(trainer.beat.isEmpty ? "backswing : downswing" : trainer.beat)
                    .font(.caption)
                    .foregroundStyle(trainer.beat.isEmpty ? Color.secondary : Color.blue)

                HStack(spacing: 10) {
                    Button {
                        trainer.backswingSeconds = max(0.6, trainer.backswingSeconds - 0.1)
                    } label: {
                        Image(systemName: "minus")
                    }
                    .buttonStyle(.bordered)

                    Text(String(format: "%.1fs back", trainer.backswingSeconds))
                        .font(.caption)
                        .frame(minWidth: 60)

                    Button {
                        trainer.backswingSeconds = min(1.4, trainer.backswingSeconds + 0.1)
                    } label: {
                        Image(systemName: "plus")
                    }
                    .buttonStyle(.bordered)
                }

                Button(trainer.isRunning ? "Stop" : "Start") {
                    trainer.toggle()
                }
                .buttonStyle(.borderedProminent)
                .tint(trainer.isRunning ? .red : .green)

                Text("Feel the rhythm, then match it. A training aid — not a measurement.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
        .navigationTitle("Tempo")
        .onDisappear { trainer.stop() }
    }
}
