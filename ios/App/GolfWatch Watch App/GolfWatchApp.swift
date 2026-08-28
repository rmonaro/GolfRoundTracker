import SwiftUI
import WatchKit
import HealthKit

/// Handles the watch app being launched from the iPhone via
/// `HKHealthStore.startWatchApp(with:)`. iOS hands us the workout
/// configuration; we treat that as "the user tapped Start Watch Practice on
/// the phone" and jump straight into a practice session.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        // Launched from the iPhone via startWatchApp. What happens next is
        // driven by the phone's WCSession command (a `startPractice` user-info
        // for practice) or the synced round state (for a round) — NOT started
        // here, so launching for a round never kicks off a practice session.
    }
}

/// Entry point. Activates the WCSession on first appear and hands the
/// shared session into the view tree via `@StateObject`.
@main
struct GolfWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate
    @StateObject private var session = WatchSession.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .onAppear {
                    session.activate()
                    // GPS permission prompt is benign on the watch — the
                    // user can deny and the shot flow still works (just
                    // without lat/lng).
                    if session.locationAuthStatus == .notDetermined {
                        session.requestLocationPermission()
                    }
                }
        }
    }
}

/// Root selector: shows the home view when a round is active, otherwise an
/// idle placeholder. Also drives continuous-GPS lifecycle — keep the
/// location feed open while a round is active so the home view can show
/// live distance-to-pin without waiting on phone snapshots.
struct RootView: View {
    @EnvironmentObject var session: WatchSession
    @ObservedObject private var practice = PracticeController.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if session.state.active {
                // During a live round, practice mode is intentionally out of
                // reach — swing feedback is a separate, non-round flow.
                HoleHomeView()
            } else if practice.isActive {
                // Launched into practice (e.g. from the phone's Start Watch
                // Practice) or started on the watch — show the practice hub.
                NavigationStack {
                    PracticeHomeView()
                }
            } else {
                NavigationStack {
                    IdleView()
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // HealthKit can only present its authorization sheet — and reliably
            // start a workout session — while we're in the foreground. Round
            // detection is started from a background WCSession delivery, so
            // this is the only moment the round can actually ask. Without it
            // the round's heart rate stayed 0 for every shot.
            if phase == .active { RoundShotController.shared.ensureHealthAuthorized() }
        }
        .onChange(of: session.state.active) { _, isActive in
            if isActive {
                session.startContinuousLocation()
                // A round taking over ends any practice session. The two modes
                // are mutually exclusive: leaving practice armed keeps the
                // motion sensors running and floods the shared WCSession
                // channel the round needs for shot recording. endSession()
                // also notifies the phone so its session is finalized.
                PracticeController.shared.endSession()
                // The round just went live while we're on screen — ask for
                // Health access now, while the sheet can actually be shown.
                RoundShotController.shared.ensureHealthAuthorized()
            } else {
                session.stopContinuousLocation()
            }
        }
        .onAppear {
            // Catch the case where the watch app was launched while a
            // round is already active (e.g., user just opened the app
            // after starting on the phone).
            if session.state.active {
                session.startContinuousLocation()
                PracticeController.shared.endSession()
                RoundShotController.shared.ensureHealthAuthorized()
            }
        }
    }
}

struct IdleView: View {
    @EnvironmentObject var session: WatchSession
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "figure.golf")
                .font(.system(size: 32))
                .foregroundColor(.secondary)
            Text("No active round")
                .font(.headline)
            Text(session.reachable ? "Start one on your phone." : "Phone not reachable.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            // Practice mode is available off-round: motion-based swing feedback.
            NavigationLink {
                PracticeHomeView()
            } label: {
                Label("Practice", systemImage: "dot.radiowaves.left.and.right")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
