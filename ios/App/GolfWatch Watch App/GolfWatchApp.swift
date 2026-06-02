import SwiftUI

/// Entry point. Activates the WCSession on first appear and hands the
/// shared session into the view tree via `@StateObject`.
@main
struct GolfWatchApp: App {
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

    var body: some View {
        Group {
            if session.state.active {
                HoleHomeView()
            } else {
                IdleView()
            }
        }
        .onChange(of: session.state.active) { _, isActive in
            if isActive {
                session.startContinuousLocation()
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
            }
        }
    }
}

struct IdleView: View {
    @EnvironmentObject var session: WatchSession
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "figure.golf")
                .font(.system(size: 32))
                .foregroundColor(.secondary)
            Text("No active round")
                .font(.headline)
            Text(session.reachable ? "Start one on your phone." : "Phone not reachable.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}
