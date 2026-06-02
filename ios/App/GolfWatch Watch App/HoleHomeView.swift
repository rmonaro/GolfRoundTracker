import SwiftUI

/// Main read view shown when a round is active. Two modes:
///   • Idle (default): two-column layout — yards-to-pin + suggested club on
///     the left, score / shots / putts on the right, small chevron arrows
///     bottom for hole navigation. Tap the suggested club to open the
///     full club picker; tap the "+" between chevrons to open the record-
///     shot flow locally on the watch.
///   • Recording (phone has its record-shot sheet or pending-landing bar
///     up): the watch swaps to a focused view showing just the phone's
///     selected club. Tap to change.
struct HoleHomeView: View {
    @EnvironmentObject var session: WatchSession
    @State private var showingShotFlow = false
    @State private var shotFlowStartingClubId: String?
    /// True while the user has tapped Track but not yet ended the shot.
    /// Drives the bottom-controls swap to "tracking" UI + the next-tap
    /// behavior (end → open shot record flow with start preserved).
    @State private var isTrackingShot = false

    var body: some View {
        let s = session.state

        if s.recordingShot {
            recordingView(s)
                .sheet(isPresented: $showingShotFlow) {
                    ShotRecordFlow(
                        isPresented: $showingShotFlow,
                        initialClubId: shotFlowStartingClubId,
                        startAlreadyCaptured: isTrackingShot
                    )
                        .environmentObject(session)
                        .onDisappear {
                            // Notify the phone that the watch is no
                            // longer tracking. After a successful submit
                            // the phone already got a recordShot — this
                            // is then redundant-but-harmless. After a
                            // cancel it's the only end signal.
                            if isTrackingShot {
                                session.send(.trackingShot(active: false, start: nil))
                            }
                            isTrackingShot = false
                        }
                }
        } else {
            idleView(s)
                .sheet(isPresented: $showingShotFlow) {
                    ShotRecordFlow(
                        isPresented: $showingShotFlow,
                        initialClubId: shotFlowStartingClubId,
                        startAlreadyCaptured: isTrackingShot
                    )
                        .environmentObject(session)
                        .onDisappear {
                            // Notify the phone that the watch is no
                            // longer tracking. After a successful submit
                            // the phone already got a recordShot — this
                            // is then redundant-but-harmless. After a
                            // cancel it's the only end signal.
                            if isTrackingShot {
                                session.send(.trackingShot(active: false, start: nil))
                            }
                            isTrackingShot = false
                        }
                }
        }
    }

    // MARK: - Idle layout

    /// Two-column read view used during normal play.
    @ViewBuilder
    private func idleView(_ s: WatchRoundState) -> some View {
        VStack(spacing: 4) {
            // Header — hole # left, par badge right. Compact so the columns
            // get most of the screen real estate.
            HStack(spacing: 6) {
                Text("Hole \(s.holeNumber.map(String.init) ?? "—")")
                    .font(.headline)
                Spacer()
                if let par = s.par {
                    Text("Par \(par)")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.yellow.opacity(0.25))
                        .clipShape(Capsule())
                }
            }

            HStack(alignment: .top, spacing: 6) {
                leftColumn(s)
                rightColumn(s)
            }

            Spacer(minLength: 2)

            bottomControls(s)

            if !session.reachable {
                Text("Phone offline — queued")
                    .font(.system(size: 9))
                    .foregroundColor(.orange)
            }
        }
        .padding(.horizontal, 6)
    }

    // MARK: - Recording layout

    /// Focused view when the phone is in record-shot mode. Big selected
    /// club name, tap to change.
    @ViewBuilder
    private func recordingView(_ s: WatchRoundState) -> some View {
        let club = s.bag.first(where: { $0.id == s.selectedClubId })
            ?? s.bag.first(where: { $0.id == s.suggestedClubId })

        VStack(spacing: 8) {
            Text("Recording shot")
                .font(.caption2)
                .foregroundColor(.secondary)
                .textCase(.uppercase)

            recordingClubButton(club: club)

            if !session.reachable {
                Text("Phone offline — queued")
                    .font(.system(size: 9))
                    .foregroundColor(.orange)
            }
        }
        .padding(.horizontal, 6)
    }

    /// Big tap-to-change club button used in the recording view. Extracted
    /// out so SwiftUI's type-checker doesn't choke on the whole recording
    /// body as one expression.
    @ViewBuilder
    private func recordingClubButton(club: WatchClub?) -> some View {
        Button {
            shotFlowStartingClubId = club?.id
            showingShotFlow = true
        } label: {
            VStack(spacing: 4) {
                Image(systemName: (club?.isPutter ?? false) ? "circle.dotted" : "figure.golf")
                    .font(.system(size: 28))
                    .foregroundColor(.yellow)
                Text(club?.name ?? "Select club")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                if let y = club?.typicalYards {
                    Text("\(y) yds typical")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Text("Tap to change")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(Color.green.opacity(0.18))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Pieces

    /// Bottom controls row. Two modes:
    ///   • Idle      — prev / Track / Record (+) / next
    ///   • Tracking  — "Walking…" indicator + End Shot button
    ///
    /// "Track" captures GPS start immediately and flips the local
    /// isTrackingShot flag. The user walks to the ball and taps "End
    /// Shot," which opens the shot record flow with the start
    /// preserved (so the modal's club picker doesn't overwrite it).
    /// "Record (+)" remains for the legacy at-ball workflow where the
    /// user captures start when they pick a club.
    @ViewBuilder
    private func bottomControls(_ s: WatchRoundState) -> some View {
        if isTrackingShot {
            HStack(spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "figure.walk")
                        .font(.system(size: 11))
                        .foregroundColor(.yellow)
                    Text("Walking…")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                }
                Spacer()
                Button {
                    shotFlowStartingClubId = s.selectedClubId ?? s.suggestedClubId
                    showingShotFlow = true
                } label: {
                    Text("End Shot")
                        .font(.system(size: 11, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.mini)
                .tint(.red)
            }
        } else {
            HStack(spacing: 4) {
                Button {
                    session.send(.navigateHole(direction: "prev"))
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 12, weight: .semibold))
                }
                .controlSize(.mini)
                .buttonStyle(.bordered)

                Button {
                    // Start GPS shot tracking. The user will walk to the
                    // ball; "End Shot" then opens the record flow.
                    session.captureShotStart()
                    isTrackingShot = true
                    // Tell the phone the watch is now tracking so it can
                    // show a banner + stage the start position on the map.
                    session.send(.trackingShot(
                        active: true,
                        start: session.pendingShotStart
                    ))
                } label: {
                    Image(systemName: "location.fill")
                        .font(.system(size: 12, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.mini)
                .tint(.yellow)

                Button {
                    shotFlowStartingClubId = s.selectedClubId ?? s.suggestedClubId
                    showingShotFlow = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .bold))
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.mini)
                .tint(.green)

                Button {
                    session.send(.navigateHole(direction: "next"))
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                }
                .controlSize(.mini)
                .buttonStyle(.bordered)
            }
        }
    }

    /// LEFT column: big yards-to-pin readout above a small suggested-club button.
    @ViewBuilder
    private func leftColumn(_ s: WatchRoundState) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(distanceText(s))
                    .font(.system(size: 36, weight: .heavy, design: .rounded))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text(distanceUnit(s))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            suggestedClubButton(s)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// RIGHT column: score pill at top, then shots and putts rows beneath.
    @ViewBuilder
    private func rightColumn(_ s: WatchRoundState) -> some View {
        VStack(alignment: .trailing, spacing: 3) {
            if let diff = s.scoreVsPar {
                Text(diff)
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 1)
                    .background(scorePillColor(diff).opacity(0.6))
                    .clipShape(Capsule())
                    .lineLimit(1)
            }
            rightRow(label: "Shots", value: s.shotsThisHole ?? 0)
            rightRow(label: "Putts", value: s.puttsThisHole ?? 0)
        }
    }

    /// Highlighted button showing the suggested club. Tapping opens the
    /// shot-record flow pre-selected to this club (the watch user can
    /// still change it mid-flow if they want a different one).
    @ViewBuilder
    private func suggestedClubButton(_ s: WatchRoundState) -> some View {
        let club = s.bag.first(where: { $0.id == (s.selectedClubId ?? s.suggestedClubId) })
        Button {
            shotFlowStartingClubId = club?.id
            showingShotFlow = true
        } label: {
            HStack(spacing: 4) {
                Image(systemName: (club?.isPutter ?? false) ? "circle.dotted" : "figure.golf")
                    .font(.system(size: 11))
                    .foregroundColor(.yellow)
                Text(club?.name ?? "Club")
                    .font(.system(size: 13, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.green.opacity(0.55))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func rightRow(label: String, value: Int) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.secondary)
            Text("\(value)")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
        }
    }

    private func scorePillColor(_ diff: String) -> Color {
        // "--" → neutral (no holes complete yet), "+N" → orange (over par),
        // "E" / "-N" → green (par or under).
        if diff == "--" { return .gray }
        if diff.hasPrefix("+") { return .orange }
        return .green
    }

    /// Live GPS-derived yards-to-pin when available (watch has its own
    /// fix + the snapshot includes pin coords), otherwise the static
    /// distanceYards/distanceFeet pushed by the phone. Live wins so the
    /// number updates as the user walks.
    private func distanceText(_ s: WatchRoundState) -> String {
        if let live = session.liveDistanceToPinYards() {
            return "\(Int(live.rounded()))"
        }
        if let ft = s.distanceFeet { return "\(ft)" }
        if let yd = s.distanceYards { return "\(yd)" }
        return "—"
    }

    private func distanceUnit(_ s: WatchRoundState) -> String {
        // Live distance is always reported in yards. Only use 'ft' when
        // the phone explicitly pushed a feet reading (on the green).
        if session.liveDistanceToPinYards() != nil { return "yds" }
        if s.distanceFeet != nil { return "ft" }
        return "yds"
    }
}
