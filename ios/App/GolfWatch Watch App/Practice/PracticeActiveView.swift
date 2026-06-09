import SwiftUI

/// Live practice screen. Shows the most recent swing's estimated tempo and a
/// one-line headline. Motion detection is armed while this view is visible and
/// disarmed when it disappears, so the sensors only run during practice.
struct PracticeActiveView: View {
    @ObservedObject private var practice = PracticeController.shared

    var body: some View {
        VStack(spacing: 8) {
            Text(practice.swingCountLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            if let last = practice.lastSwing {
                Text(String(format: "%.1f : 1", last.tempoRatio))
                    .font(.system(size: 34, weight: .bold))
                Text(last.headlineFeedback)
                    .font(.caption)
                    .foregroundStyle(headlineColor(last.headlineFeedback))
                    .multilineTextAlignment(.center)
                Text("Estimated · motion-based")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Image(systemName: "figure.golf")
                    .font(.system(size: 30))
                    .foregroundStyle(.secondary)
                Text("Take a swing…")
                    .foregroundStyle(.secondary)
            }

            if practice.isArmed {
                Label("Listening", systemImage: "dot.radiowaves.left.and.right")
                    .font(.caption2)
                    .foregroundStyle(.blue)
            }
        }
        .padding()
        .navigationTitle("Practice")
        .onAppear { practice.armDetection() }
        .onDisappear { practice.disarmDetection() }
    }

    private func headlineColor(_ headline: String) -> Color {
        if headline.contains("Great") { return .green }
        if headline.contains("rushed") || headline.contains("aggressive") || headline.contains("Unstable") {
            return .orange
        }
        return .secondary
    }
}
