import SwiftUI

/// Main read view shown when a round is active. Two modes:
///   • Idle (default): two-column layout — yards-to-pin + suggested club on
///     the left, score / shots / putts on the right, and a 2×2 control grid
///     (Track + Add Shot over prev/next arrows). Track toggles round-wide
///     auto-tracking (synced with the phone); Add Shot logs a shot at the
///     current GPS. Both auto-record — the club picker only opens from the
///     club pill. Off-course the action buttons are hidden.
///   • Recording (phone has its record-shot sheet or pending-landing bar
///     up): the watch swaps to a focused view showing just the phone's
///     selected club. Tap to change.
struct HoleHomeView: View {
    @EnvironmentObject var session: WatchSession
    @State private var showingShotFlow = false
    @State private var shotFlowStartingClubId: String?
    /// True while the modal is open in "club picker only" mode (user
    /// tapped the suggested-club pill specifically to swap clubs, not
    /// to record a shot). Resets via onDisappear.
    @State private var isClubPickerOnly = false
    /// Id of the last shot summary we've shown the overview for, so each
    /// GPS auto-recorded shot flashes its overview exactly once.
    @State private var shownSummaryId = 0

    var body: some View {
        let s = session.state

        Group {
            if s.recordingShot {
                recordingView(s)
            } else {
                idleView(s)
                    .overlay {
                        // Brief, auto-dismissing overview after a GPS auto-record
                        // (Track-off / Add Shot). The phone inferred the result.
                        if let summary = s.lastShotSummary, summary.id != shownSummaryId {
                            shotOverview(summary)
                        }
                    }
            }
        }
        // The shot flow is now ONLY the club picker, reached from the club pill.
        // Track / Add Shot never open it — they auto-record via GPS.
        .sheet(isPresented: $showingShotFlow) {
            ShotRecordFlow(
                isPresented: $showingShotFlow,
                initialClubId: shotFlowStartingClubId,
                startAlreadyCaptured: false,
                clubPickerOnly: isClubPickerOnly
            )
                .environmentObject(session)
                .onDisappear { isClubPickerOnly = false }
        }
    }

    /// Full-screen-ish overview card shown for a couple seconds after a shot is
    /// auto-recorded from GPS. Read-only — no buttons, auto-dismisses.
    @ViewBuilder
    private func shotOverview(_ summary: WatchShotSummary) -> some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 26))
                .foregroundColor(.green)
            Text(summary.clubName)
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(summary.result)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.yellow)
            Text(summary.distanceText)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.85))
        .onTapGesture { shownSummaryId = summary.id }
        .task(id: summary.id) {
            // Show for ~2.5s, then mark this id shown so the overlay hides.
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            shownSummaryId = summary.id
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
        // Same optimistic-local-override resolution as the home pill —
        // the recording card's title should reflect any just-picked
        // club without waiting for the phone snapshot.
        let club = s.bag.first(where: { $0.id == effectiveClubId(s) })

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
    /// body as one expression. Tapping intentionally opens the shot
    /// flow at the CLUB PICKER (not result) so the player can swap
    /// clubs mid-tracking — "tap to change" reads as a club change,
    /// not as "record this club's shot now."
    @ViewBuilder
    private func recordingClubButton(club: WatchClub?) -> some View {
        Button {
            shotFlowStartingClubId = nil
            isClubPickerOnly = true
            _ = club
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

    /// The club id currently shown to the user. An optimistic local pick (made
    /// on the watch, not yet confirmed by the phone) wins, then the phone's
    /// selected club, then the suggested club. The add-shot buttons act on this
    /// so they always use exactly the club that's displayed.
    private func effectiveClubId(_ s: WatchRoundState) -> String? {
        session.localSelectedClubId ?? s.selectedClubId ?? s.suggestedClubId
    }

    /// Bottom controls — a 2×2 grid:
    ///   Row 1:  Track (auto-track toggle)  |  Add Shot (GPS auto-record)
    ///   Row 2:  ◀ prev hole                |  next hole ▶
    ///
    /// "Track" toggles round-wide auto-tracking, kept in sync with the phone.
    /// Turning it OFF at the ball records the shot there (then resumes on the
    /// next tap). "Add Shot" logs a shot at the current GPS without changing the
    /// auto-track state. Both auto-record via GPS — the phone infers the result
    /// and a brief overview flashes; neither opens the club picker.
    ///
    /// Off-course the action buttons are hidden (mirroring the phone, which
    /// won't start tracking out of range); only a "not in range" note + the
    /// hole arrows remain.
    @ViewBuilder
    private func bottomControls(_ s: WatchRoundState) -> some View {
        if s.atCourse == false {
            VStack(spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "location.slash")
                        .font(.system(size: 12))
                        .foregroundColor(.orange)
                    Text("Not in range of \(s.courseName ?? "the course")")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                }
                navRow()
            }
        } else {
            let tracking = s.autoTracking
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    bigButton(
                        title: tracking ? "Stop" : "Track",
                        system: tracking ? "stop.fill" : "location.fill",
                        tint: tracking ? .red : .yellow
                    ) {
                        if tracking {
                            // At the ball: record the shot here, then pause
                            // auto-tracking until the next tap re-arms it.
                            session.recordAutoShot(clubId: effectiveClubId(s))
                            session.setAutoTrack(false)
                        } else {
                            session.setAutoTrack(true)
                        }
                    }
                    bigButton(title: "Add Shot", system: "plus", tint: .green) {
                        // Log a shot at the current GPS now. Auto-track (if on)
                        // keeps running — this is an extra manual log.
                        session.recordAutoShot(clubId: effectiveClubId(s))
                    }
                }
                navRow()
            }
        }
    }

    /// Prev / next hole arrows — the second row, under Track & Add Shot.
    @ViewBuilder
    private func navRow() -> some View {
        HStack(spacing: 6) {
            bigButton(title: nil, system: "chevron.left", tint: .gray) {
                session.send(.navigateHole(direction: "prev"))
            }
            bigButton(title: nil, system: "chevron.right", tint: .gray) {
                session.send(.navigateHole(direction: "next"))
            }
        }
    }

    /// A large tappable control used in the 2×2 grid — icon + optional title,
    /// full-width within its column.
    @ViewBuilder
    private func bigButton(
        title: String?,
        system: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: system)
                    .font(.system(size: 16, weight: .bold))
                if let title = title {
                    Text(title)
                        .font(.system(size: 13, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 36)
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
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
    /// shot-record flow at the CLUB PICKER step (not result), so the
    /// player can change clubs from the home view. The "+" record FAB
    /// stays the quick-record path that skips straight to result with
    /// the suggested club pre-selected.
    @ViewBuilder
    private func suggestedClubButton(_ s: WatchRoundState) -> some View {
        // Optimistic local override wins over the snapshot's selectedClubId
        // so a freshly-picked club on the watch shows up immediately —
        // before the phone roundtrip has finished. Falls back to the
        // snapshot when no override is set.
        let club = s.bag.first(where: { $0.id == effectiveClubId(s) })
        Button {
            // Club-changer mode: open the picker, exit on pick (no
            // shot record, no GPS capture). The new selection rides
            // back to the phone via the `selectClub` message and the
            // phone re-sends a snapshot so the home view updates.
            shotFlowStartingClubId = nil
            isClubPickerOnly = true
            _ = club
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
