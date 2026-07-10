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
    /// Manual ± correction of the on-green putt distance (feet). Null tracks the
    /// phone's reading; cleared after each putt and when the hole changes.
    @State private var puttFeetOverride: Int?
    /// Locally-navigated hole (prev/next on the watch). Lets the watch show the
    /// next hole's yardage + club IMMEDIATELY from the per-hole snapshot data,
    /// without waiting on the phone (whose JS is suspended while backgrounded).
    /// Cleared once the phone's snapshot catches up to this hole.
    @State private var localHoleNumber: Int?
    /// True for a short window right after a putt tap — disables Missed/Made so a
    /// rapid double-tap can't send two putts (the phone save isn't idempotent and
    /// the confirming snapshot can lag when the phone is backgrounded). Reset by a
    /// timer in `recordPutt`.
    @State private var puttSending = false
    /// The hole number a "Made" putt was recorded on. While the displayed hole
    /// matches, the putt controls are LOCKED (show "Holed out") so no number of
    /// extra taps can add another made putt — the reported multi-putt bug.
    @State private var madePuttHole: Int?

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
                Text("Hole \(displayedHoleNumber(s).map(String.init) ?? "—")")
                    .font(.headline)
                Spacer()
                if let par = displayedHole(s)?.par ?? s.par {
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
        // When the phone finally processes our hole-nav (it foregrounds and
        // drains the queued navigateHole messages), its snapshot hole catches
        // up — drop the local override so we're back in lock-step.
        .onChange(of: session.state.holeNumber) { _, newHole in
            if let local = localHoleNumber, newHole == local {
                localHoleNumber = nil
            }
        }
        // Remember the last real club we resolved so effectiveClubId never has to
        // blank out when the phone momentarily provides no selection.
        .onChange(of: rawEffectiveClubId(s)) { _, newId in
            if let newId { session.noteResolvedClub(newId) }
        }
        .onAppear {
            if let id = rawEffectiveClubId(s) { session.noteResolvedClub(id) }
        }
    }

    // MARK: - Local hole navigation

    /// The hole the watch is currently SHOWING — the local override if the user
    /// navigated ahead/back on the watch, else the phone's current hole.
    private func displayedHoleNumber(_ s: WatchRoundState) -> Int? {
        localHoleNumber ?? s.holeNumber
    }

    /// The per-hole snapshot entry for the displayed hole.
    private func displayedHole(_ s: WatchRoundState) -> WatchHole? {
        guard let n = displayedHoleNumber(s) else { return nil }
        return s.holes.first(where: { $0.holeNumber == n })
    }

    /// True when the watch is showing a hole the phone hasn't moved to yet.
    private func isPreviewing(_ s: WatchRoundState) -> Bool {
        guard let local = localHoleNumber else { return false }
        return local != s.holeNumber
    }

    /// Advance the displayed hole locally AND tell the phone (so it catches up
    /// when it next runs). Clamped to the round's hole range.
    private func navigateHoleLocally(_ delta: Int, _ s: WatchRoundState) {
        let current = displayedHoleNumber(s) ?? 1
        let numbers = s.holes.map { $0.holeNumber }
        let lo = numbers.min() ?? 1
        let hi = numbers.max() ?? (s.holesPlayed ?? 18)
        let next = min(hi, max(lo, current + delta))
        guard next != current else { return }
        // No override needed once we're back on the phone's own hole.
        localHoleNumber = next == s.holeNumber ? nil : next
        session.send(.navigateHole(direction: delta > 0 ? "next" : "prev"))
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
    /// on the watch, not yet confirmed by the phone) wins, then — for the hole
    /// being shown — the phone's selected club, then the displayed hole's
    /// suggested club. When previewing a hole the phone hasn't moved to yet, the
    /// phone's selectedClubId is for a different hole, so we skip it and use the
    /// previewed hole's suggestion.
    private func effectiveClubId(_ s: WatchRoundState) -> String? {
        // Never blank out the club. When the raw resolution is nil — no GPS fix
        // for a live suggestion, the phone reset selectedClubId to null after the
        // last shot, and no suggestion is pushed — fall back to the last club we
        // actually showed, then to the first non-putter in the bag. This is what
        // stops the pill / recording view flashing "Club" / "Select club".
        rawEffectiveClubId(s)
            ?? session.lastResolvedClubId
            ?? s.bag.first(where: { !$0.isPutter })?.id
    }

    /// Raw club resolution WITHOUT the never-blank fallback — may be nil. Split
    /// out so `.onChange` in idleView can remember the last real value.
    ///
    /// The watch's own live-distance recommendation is preferred over the phone's
    /// pushed selection/suggestion (which can be stale when the phone is
    /// backgrounded), so the club auto-follows as you walk up to the ball. A
    /// manual pick ON THE WATCH (localSelectedClubId) still wins.
    private func rawEffectiveClubId(_ s: WatchRoundState) -> String? {
        let liveClub = liveSuggestedClubId(s)
        let pushedSuggested = displayedHole(s)?.suggestedClubId ?? s.suggestedClubId
        if isPreviewing(s) {
            return session.localSelectedClubId ?? liveClub ?? pushedSuggested
        }
        return session.localSelectedClubId ?? liveClub ?? s.selectedClubId ?? pushedSuggested
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
        if isOnGreen(s) {
            // Ball's on the green — swap Track / Add Shot for the putt recorder,
            // mirroring the phone's putting panel. Uses the watch's OWN on-green
            // test (phone result OR watch GPS-within-radius) so it arms even when
            // the phone is backgrounded. Checked BEFORE the at-course gate: being
            // on the green means you're on the course, and it lets the putt view
            // be exercised even when the at-course heuristic reads false.
            puttControls(s)
        } else if s.atCourse == false {
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
                navRow(s)
            }
        } else {
            // Optimistic local override wins so the button flips the instant
            // it's tapped, before the phone roundtrip confirms.
            let tracking = session.localAutoTracking ?? s.autoTracking
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
                            recordManualShot(s)
                            session.setAutoTrack(false)
                        } else {
                            session.setAutoTrack(true)
                        }
                    }
                    bigButton(title: "Add Shot", system: "plus", tint: .green) {
                        // Log a shot at the current GPS now. Auto-track (if on)
                        // keeps running — this is an extra manual log.
                        recordManualShot(s)
                    }
                }
                navRow(s)
            }
        }
    }

    /// Record a shot at the current GPS (Track-off "at the ball" or Add Shot),
    /// then optimistically bump the hole's Shots count. The bump is skipped when
    /// the watch is auto-detecting strikes: there the strike itself already
    /// counted the shot and this tap merely closes it, so bumping would
    /// double-count. When strike detection is off, this tap IS the new shot.
    private func recordManualShot(_ s: WatchRoundState) {
        session.recordAutoShot(clubId: effectiveClubId(s))
        if !RoundShotController.shared.isRunning, let hole = displayedHoleNumber(s) {
            session.bumpPendingShotCount(hole: hole, to: shownShots(s) + 1)
        }
    }

    /// On-green putt controls — replaces Track / Add Shot once the ball is on
    /// the green, mirroring the phone's putting panel: the feet-to-flag with a
    /// ± nudge on top, then "Missed" / "Made". "Made" holes out. The prev/next
    /// arrows are intentionally hidden here so the player can't skip ahead
    /// mid-hole; once the putt is made the locked panel shows a single "Next
    /// Hole" button so the player can advance without pulling out the phone.
    @ViewBuilder
    private func puttControls(_ s: WatchRoundState) -> some View {
        // Once "Made" holes out this hole, lock the panel so no amount of extra
        // taps can add another putt — regardless of whether the phone's
        // hole-out snapshot has arrived yet.
        if madePuttHole == displayedHoleNumber(s) {
            VStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundColor(.green)
                    Text("Holed out")
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundColor(.white)
                }
                // Advance to the next hole right from the watch. Previously the
                // player had to open the phone: the hole arrows are hidden on the
                // green, so after holing out there was no way forward. Navigates
                // locally (instant, reads the next hole from the snapshot) and
                // tells the phone; moving off this hole drops the "holed out"
                // lock so the next hole shows normal controls.
                bigButton(title: "Next Hole", system: "arrow.right", tint: .blue) {
                    navigateHoleLocally(1, s)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        } else {
            let displayed = puttFeetOverride ?? s.distanceFeet
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    stepButton(system: "minus") {
                        puttFeetOverride = max(0, (puttFeetOverride ?? s.distanceFeet ?? 0) - 1)
                    }
                    VStack(spacing: 0) {
                        Text(displayed.map { "\($0) ft" } ?? "—")
                            .font(.system(size: 34, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                        Text("TO FLAG")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    stepButton(system: "plus") {
                        puttFeetOverride = max(0, (puttFeetOverride ?? s.distanceFeet ?? 0) + 1)
                    }
                }
                // Bigger, well-separated targets so a fat-finger on "Missed"
                // can't land on "Made" (which holes out).
                HStack(spacing: 12) {
                    puttButton(title: "Missed", system: "xmark.circle", tint: .gray) {
                        recordPutt(made: false, s)
                    }
                    puttButton(title: "Made", system: "flag.fill", tint: .green) {
                        recordPutt(made: true, s)
                    }
                }
            }
            // Forget any ± correction when moving to a different hole.
            .onChange(of: displayedHoleNumber(s)) { _, _ in puttFeetOverride = nil }
        }
    }

    /// Missed / Made button. Taller (44pt) for reliable taps on a small screen,
    /// and disabled briefly after a tap (`puttSending`) so a rapid double-tap
    /// can't fire two putts.
    @ViewBuilder
    private func puttButton(
        title: String,
        system: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: system)
                    .font(.system(size: 14, weight: .bold))
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
        .disabled(puttSending)
        .opacity(puttSending ? 0.5 : 1)
    }

    /// Small circular ± button used to nudge the putt distance.
    @ViewBuilder
    private func stepButton(system: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.yellow)
                .frame(width: 34, height: 34)
                .background(Color.yellow.opacity(0.15))
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
    }

    /// Record a putt from the watch. Uses the bag's putter (falling back to the
    /// shown club) and sends the shown feet-to-flag (± corrected) as the putt
    /// distance. `made` holes out, which clears onGreen on the next snapshot and
    /// restores the normal Track / Add Shot controls for the next hole.
    private func recordPutt(made: Bool, _ s: WatchRoundState) {
        // Ignore taps while a putt is in flight, or after this hole was already
        // holed out — this is what stops "tapped Made 4× → 4 putts".
        guard !puttSending, madePuttHole != displayedHoleNumber(s) else { return }
        let putterId = s.bag.first(where: { $0.isPutter })?.id ?? effectiveClubId(s)
        let feet = puttFeetOverride ?? s.distanceFeet
        session.recordPutt(clubId: putterId, made: made, distanceFeet: feet)
        puttFeetOverride = nil
        // A made putt locks the panel immediately (optimistic hole-out), so we
        // don't depend on the phone's confirming snapshot to disable the button.
        if made { madePuttHole = displayedHoleNumber(s) }
        // Debounce both buttons briefly; enough for a normal roundtrip while
        // blocking accidental repeats.
        puttSending = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            puttSending = false
        }
    }

    /// Prev / next hole arrows — the second row, under Track & Add Shot. These
    /// advance the watch's displayed hole LOCALLY (instant) and notify the phone.
    @ViewBuilder
    private func navRow(_ s: WatchRoundState) -> some View {
        HStack(spacing: 6) {
            bigButton(title: nil, system: "chevron.left", tint: .gray) {
                navigateHoleLocally(-1, s)
            }
            bigButton(title: nil, system: "chevron.right", tint: .gray) {
                navigateHoleLocally(1, s)
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
            // Per-hole counts come from the displayed hole's snapshot entry so a
            // previewed hole shows ITS shots/putts, not the phone's current hole.
            // Shots also fold in the watch's optimistic count (see shownShots) so
            // a just-hit shot appears before the backgrounded phone confirms it.
            rightRow(label: "Shots", value: shownShots(s))
            rightRow(label: "Putts", value: displayedHole(s)?.putts ?? s.puttsThisHole ?? 0)
        }
    }

    /// Shots to show for the displayed hole: the phone's snapshot count OR the
    /// watch's optimistic count (shots recorded/detected on the watch that the
    /// backgrounded phone hasn't confirmed yet), whichever is higher.
    private func shownShots(_ s: WatchRoundState) -> Int {
        let snap = displayedHole(s)?.shots ?? s.shotsThisHole ?? 0
        guard let hole = displayedHoleNumber(s) else { return snap }
        return max(snap, session.pendingShotCounts[hole] ?? 0)
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

    private func distanceText(_ s: WatchRoundState) -> String {
        displayDistance(s).map { "\($0.value)" } ?? "—"
    }

    private func distanceUnit(_ s: WatchRoundState) -> String {
        displayDistance(s)?.unit ?? "yds"
    }

    /// Resolved distance-to-pin number + unit. On the displayed hole we use the
    /// live GPS distance; near the pin (on the green, or within ~12 yds) it's
    /// shown in FEET, otherwise yards. When previewing a hole the user isn't
    /// physically at, GPS-to-that-pin is meaningless → static hole yardage.
    private func displayDistance(_ s: WatchRoundState) -> (value: Int, unit: String)? {
        if !isPreviewing(s) {
            let onGreen = isOnGreen(s)
            // Prefer the watch's OWN live GPS distance for the feet-to-flag on the
            // green. The phone's pushed distanceFeet was previously chosen here,
            // but it FREEZES when the phone is backgrounded — the cause of the
            // "238 ft while standing on the green" reading. Own GPS self-corrects;
            // fall back to the phone value only when there's no usable fix.
            if let liveYards = liveDistanceToDisplayedPin(s) {
                if onGreen || liveYards <= 12 {
                    return (Int((liveYards * 3).rounded()), "ft")
                }
                return (Int(liveYards.rounded()), "yds")
            }
            if onGreen, let ft = s.distanceFeet {
                return (ft, "ft")
            }
        }
        if let yd = displayedHole(s)?.yardage { return (yd, "yds") }
        if let ft = s.distanceFeet { return (ft, "ft") }
        if let yd = s.distanceYards { return (yd, "yds") }
        return nil
    }

    /// Live yards to the displayed hole's pin (uses that hole's pin coords; falls
    /// back to the snapshot's current-hole pin when the per-hole array is empty).
    private func liveDistanceToDisplayedPin(_ s: WatchRoundState) -> Double? {
        if let hole = displayedHole(s), let plat = hole.pinLat, let plng = hole.pinLng {
            return session.liveDistanceToPin(lat: plat, lng: plng)
        }
        return session.liveDistanceToPinYards()
    }

    /// Within this many yards of the pin, the watch treats you as ON THE GREEN by
    /// its OWN GPS — independent of the phone. The phone computes an exact
    /// green-polygon test, but that value FREEZES when the phone is backgrounded
    /// (pocketed during play), so the Putt view never armed. This radius is the
    /// watch's self-sufficient fallback. Tunable: bigger catches long putts from
    /// the fringe, smaller avoids arming on a chip from just off the green.
    private let onGreenRadiusYards: Double = 15

    /// Effective on-green for the DISPLAYED hole: the phone's exact result when
    /// it's awake, OR the watch's own GPS-within-radius test so putting mode
    /// still arms when the phone is asleep. Only for the hole you're physically
    /// on (not a previewed hole).
    private func isOnGreen(_ s: WatchRoundState) -> Bool {
        if s.onGreen { return true }
        if isPreviewing(s) { return false }
        if let yards = liveDistanceToDisplayedPin(s) { return yards <= onGreenRadiusYards }
        return false
    }

    /// Club recommendation computed ON THE WATCH from its own live distance to
    /// the pin and the bag (both already in the snapshot) — so the suggested club
    /// tracks you as you walk up to the ball, instead of freezing on the phone's
    /// last push. Picks the non-putter club whose typical yardage is closest to
    /// the live distance. Nil while previewing, on the green, or without a fix.
    private func liveSuggestedClubId(_ s: WatchRoundState) -> String? {
        guard !isPreviewing(s), !isOnGreen(s),
              let yards = liveDistanceToDisplayedPin(s) else { return nil }
        let target = Int(yards.rounded())
        let candidates = s.bag.filter { !$0.isPutter && $0.typicalYards != nil }
        guard !candidates.isEmpty else { return nil }
        return candidates.min(by: {
            abs(($0.typicalYards ?? 0) - target) < abs(($1.typicalYards ?? 0) - target)
        })?.id
    }
}
