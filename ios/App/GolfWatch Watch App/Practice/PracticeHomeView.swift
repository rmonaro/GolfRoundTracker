import SwiftUI

/// Practice-mode entry screen on the watch. Separate from round play — this
/// is the "Start Practice / Select Club / End Session" hub. Motion-based
/// swing feedback only; not a launch monitor.
struct PracticeHomeView: View {
    @EnvironmentObject var session: WatchSession
    @ObservedObject private var practice = PracticeController.shared

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("Practice")
                    .font(.headline)
                Text("Motion-based swing feedback")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if practice.isActive {
                    NavigationLink {
                        PracticeActiveView()
                    } label: {
                        Label("Open Session", systemImage: "figure.golf")
                    }
                    .buttonStyle(.borderedProminent)

                    Button(role: .destructive) {
                        practice.endSession()
                    } label: {
                        Label("End Session", systemImage: "stop.fill")
                    }
                } else {
                    Button {
                        practice.startSession(club: practice.selectedClubId ?? session.state.selectedClubId)
                    } label: {
                        Label("Start Practice", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    // Apple Watch double-tap gesture starts practice hands-free.
                    .handGestureShortcut(.primaryAction)
                }

                NavigationLink {
                    PracticeClubPickerView()
                } label: {
                    Label(practice.clubName(in: session.state.bag) ?? "Select Club",
                          systemImage: "bag")
                        .lineLimit(1)
                }

                NavigationLink {
                    TempoTrainerView()
                } label: {
                    Label("Tempo Trainer", systemImage: "metronome")
                }
            }
            .padding()
        }
    }
}

/// Simple club picker for practice. Reuses the bag synced from the phone and
/// drives the practice-local club selection (sends `practiceClubSelected`).
struct PracticeClubPickerView: View {
    @EnvironmentObject var session: WatchSession
    @ObservedObject private var practice = PracticeController.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if session.state.bag.isEmpty {
                Text("No clubs synced from phone yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(session.state.bag) { club in
                Button {
                    practice.selectClub(club.id)
                    dismiss()
                } label: {
                    HStack {
                        Image(systemName: club.isPutter ? "circle.dotted" : "figure.golf")
                            .foregroundColor(.yellow)
                            .frame(width: 18)
                        Text(club.name).lineLimit(1)
                        Spacer()
                        if practice.selectedClubId == club.id {
                            Image(systemName: "checkmark").foregroundColor(.green)
                        }
                    }
                }
            }
        }
        .navigationTitle("Club")
    }
}
