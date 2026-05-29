import SwiftUI
import CoreLocation

/// Two-step shot recording: pick a club, then pick a result. We capture a
/// GPS "start" fix when the user opens this sheet and an "end" fix at submit.
struct ShotRecordFlow: View {
    @EnvironmentObject var session: WatchSession
    @Binding var isPresented: Bool

    @State private var step: Step = .pickClub
    @State private var selectedClubId: String?

    enum Step { case pickClub, pickResult }

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .pickClub:
                    ClubPickerView(
                        selectedClubId: $selectedClubId,
                        onCancel: dismiss,
                        onPick: { id in
                            selectedClubId = id
                            session.captureShotStart()
                            step = .pickResult
                        }
                    )
                case .pickResult:
                    ResultPickerView(
                        targetType: targetTypeFor(selectedClubId: selectedClubId),
                        onCancel: dismiss,
                        onSubmit: { targetType, targetResult in
                            session.captureEndAndSend(
                                clubId: selectedClubId,
                                targetType: targetType,
                                targetResult: targetResult
                            )
                            dismiss()
                        }
                    )
                }
            }
        }
    }

    private func dismiss() {
        session.cancelShotCapture()
        isPresented = false
    }

    /// Mirror the phone-side `pickTargetType` logic in a watch-friendly form.
    /// Putter → putt. Everything else → green (the watch doesn't try to
    /// distinguish tee/fairway shots; the user can override on the phone if
    /// the auto-mapped target was wrong).
    private func targetTypeFor(selectedClubId: String?) -> String {
        guard let id = selectedClubId,
              let club = session.state.bag.first(where: { $0.id == id }) else {
            return "green"
        }
        return club.isPutter ? "putt" : "green"
    }
}

// MARK: - Club picker

struct ClubPickerView: View {
    @EnvironmentObject var session: WatchSession
    @Binding var selectedClubId: String?
    let onCancel: () -> Void
    let onPick: (String) -> Void

    var body: some View {
        List {
            ForEach(session.state.bag) { club in
                Button {
                    onPick(club.id)
                } label: {
                    HStack {
                        Image(systemName: club.isPutter ? "circle.dotted" : "figure.golf")
                            .foregroundColor(.yellow)
                            .frame(width: 18)
                        Text(club.name)
                            .lineLimit(1)
                        Spacer()
                        if let y = club.typicalYards {
                            Text("\(y)y")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Club")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
        }
    }
}

// MARK: - Result picker

/// Vocabulary on the watch is intentionally small — we only need 4 cardinal
/// "miss" directions, "hit"/"made", and an optional "Missed" for putts.
struct ResultPickerView: View {
    let targetType: String
    let onCancel: () -> Void
    let onSubmit: (_ targetType: String, _ targetResult: String) -> Void

    var body: some View {
        let options: [(label: String, value: String, tint: Color, system: String)] =
            targetType == "putt"
                ? [
                    (label: "Made", value: "made", tint: .green, system: "checkmark.circle.fill"),
                    (label: "Short", value: "short", tint: .orange, system: "arrow.down"),
                    (label: "Long", value: "long", tint: .orange, system: "arrow.up"),
                    (label: "Left", value: "left", tint: .orange, system: "arrow.left"),
                    (label: "Right", value: "right", tint: .orange, system: "arrow.right")
                ]
                : [
                    (label: "Hit", value: "hit", tint: .green, system: "checkmark.circle.fill"),
                    (label: "Short", value: "short", tint: .orange, system: "arrow.down"),
                    (label: "Long", value: "long", tint: .orange, system: "arrow.up"),
                    (label: "Left", value: "left", tint: .orange, system: "arrow.left"),
                    (label: "Right", value: "right", tint: .orange, system: "arrow.right")
                ]

        List {
            ForEach(options, id: \.value) { opt in
                Button {
                    onSubmit(targetType, opt.value)
                } label: {
                    HStack {
                        Image(systemName: opt.system)
                            .foregroundColor(opt.tint)
                            .frame(width: 18)
                        Text(opt.label)
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
            }
        }
        .navigationTitle(targetType == "putt" ? "Putt" : "Result")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
        }
    }
}
