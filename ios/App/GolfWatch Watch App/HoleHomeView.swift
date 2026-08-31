import SwiftUI
import CoreLocation

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
    /// The watch's cached course geometry. Observed (not just read) so the hole
    /// appears the moment a transfer lands, even mid-round.
    @ObservedObject private var courseMap = CourseMapStore.shared
    /// Always On / wrist-down. The map freezes its camera while dimmed rather
    /// than animating a screen nobody is looking at.
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
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
    /// Brief confirmation flash after tapping "Set flag here" (pin sent to phone).
    @State private var flagJustSet = false

    var body: some View {
        let s = session.state
        let geometry = mapGeometry(s)
        let mapOn = s.courseMapEnabled && geometry != nil

        ZStack {
            // The hole, as the BACKGROUND of the screen the golfer already uses.
            // Everything below is layered on top, unchanged.
            //
            // Rendered only when there is real geometry to draw: a course that
            // was never OSM-synced, or one whose map hasn't reached the watch
            // yet, keeps the existing plain background. A blank grey map would
            // be strictly worse than no map — it would cost battery and imply
            // the hole data is broken.
            if mapOn {
                CourseMapBackground(
                    geometry: geometry,
                    player: session.lastLocation?.coordinate,
                    target: mapTarget(s, geometry: geometry),
                    targetIsPin: targetIsRealPin(s, geometry: geometry),
                    shots: displayedHole(s)?.shotPoints ?? [],
                    useSatellite: s.mapSatellite,
                    isDimmed: isLuminanceReduced
                )
                .ignoresSafeArea()
                MapReadabilityScrim()
            }


            Group {
                if s.recordingShot {
                    recordingView(s)
                } else {
                    idleView(s, mapOn: mapOn)
                        .overlay {
                            // Brief, auto-dismissing overview after a GPS auto-record
                            // (Track-off / Add Shot). The phone inferred the result.
                            if let summary = s.lastShotSummary, summary.id != shownSummaryId {
                                shotOverview(summary)
                            }
                        }
                }
            }
        }
        // Give the stack the whole screen, so the map behind the content has a
        // definite size to fill.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The course file can land before the watch app is ever opened, so the
        // snapshot handler isn't the only place that needs to try loading it.
        .onAppear { loadCourseMapIfNeeded(s) }
        .onChange(of: s.courseId) { _, _ in loadCourseMapIfNeeded(s) }
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
    private func idleView(_ s: WatchRoundState, mapOn: Bool) -> some View {
        VStack(spacing: 4) {
            // Header — hole # left, par badge right. Compact so the columns
            // get most of the screen real estate.
            HStack(spacing: 6) {
                Text("Hole \(displayedHoleNumber(s).map(String.init) ?? "—")")
                    .font(.headline)
                Spacer()
                #if DEBUG
                simulatedWalkChip(s)
                #endif
                setFlagButton
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
            .mapLegibleText(when: mapOn)

            HStack(alignment: .top, spacing: 6) {
                leftColumn(s, mapOn: mapOn)
                rightColumn(s)
            }
            .mapLegibleText(when: mapOn)

            greenDepthRow(s)
                .mapLegibleText(when: mapOn)

            Spacer(minLength: 2)

            bottomControls(s)

            if !session.reachable {
                Text("Phone offline — queued")
                    .font(.system(size: 9))
                    .foregroundColor(.orange)
            }
            #if DEBUG
            mapDiagnostic(s, mapOn: mapOn)
            #endif
        }
        .padding(.horizontal, 6)
        // When the phone finally processes our hole-nav (it foregrounds and
        // drains the queued navigateHole messages), its snapshot hole catches
        // up — drop the local override so we're back in lock-step.
        .onChange(of: session.state.holeNumber) { _, newHole in
            if let local = localHoleNumber, newHole == local {
                localHoleNumber = nil
            }
            // New hole from the phone → drop the watch-side manual club pick so
            // the next hole re-derives its club from live distance / the pushed
            // per-hole suggestion instead of staying stuck on the previous hole's
            // club (e.g. the putter after holing out).
            session.clearLocalSelectedClub()
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

    /// "Set flag here" — sends the watch's current GPS as the hole's pin. Handy
    /// on the green (walk to the flag, tap) and still available after hole-out.
    /// Flashes a check for ~1.5s on a successful send.
    @ViewBuilder
    private var setFlagButton: some View {
        Button {
            if session.setPinHere() { flagJustSet = true }
        } label: {
            Image(systemName: flagJustSet ? "checkmark.circle.fill" : "flag.fill")
                .font(.system(size: 13))
                .foregroundColor(flagJustSet ? .green : .yellow)
        }
        .buttonStyle(.plain)
        .task(id: flagJustSet) {
            guard flagJustSet else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            flagJustSet = false
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
        // Advancing holes on the watch clears the manual club pick too, so the
        // new hole starts from its own distance-based suggestion (not the putter
        // carried over from holing out on the previous hole).
        session.clearLocalSelectedClub()
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
        // On the green, default to the putter (mirrors the phone's auto-select)
        // UNLESS the player has manually picked another club on the watch to chip
        // from the fringe. This keeps the club consistent with the putt view gate.
        if isOnGreen(s), session.localSelectedClubId == nil,
           let putter = s.bag.first(where: { $0.isPutter })?.id {
            return putter
        }
        let liveClub = liveSuggestedClubId(s)
        let pushedSuggested = displayedHole(s)?.suggestedClubId ?? s.suggestedClubId
        if isPreviewing(s) {
            return session.localSelectedClubId ?? liveClub ?? pushedSuggested
        }
        return session.localSelectedClubId ?? liveClub ?? s.selectedClubId ?? pushedSuggested
    }

    /// True when the club the watch is set to is the putter — gates the putt view
    /// so picking a wedge/iron on the green (to chip) hides putting, mirroring the
    /// phone. Re-arms when the putter is picked again or the green auto-default
    /// above kicks in.
    private func clubIsPutter(_ s: WatchRoundState) -> Bool {
        s.bag.first(where: { $0.id == effectiveClubId(s) })?.isPutter ?? false
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
    /// Hole is holed out — from the phone snapshot (last shot a made putt) or the
    /// watch's own optimistic "Made" tap. Gates the prev/next hole arrows, which
    /// are hidden during active play so a hole can't be skipped mid-round.
    private func holeCompleted(_ s: WatchRoundState) -> Bool {
        // `s.holeComplete` describes the hole the PHONE is on. While the watch
        // is showing a hole ahead of it — which is the normal state after
        // holing out and tapping Next Hole, since the pocketed phone won't
        // process the nav until it next runs — that flag is about the previous
        // hole, and honouring it here showed the next tee as already finished:
        // hole arrows instead of Track / Add Shot.
        if isPreviewing(s) { return madePuttHole == displayedHoleNumber(s) }
        return s.holeComplete || madePuttHole == displayedHoleNumber(s)
    }

    @ViewBuilder
    private func bottomControls(_ s: WatchRoundState) -> some View {
        if isOnGreen(s) && clubIsPutter(s) {
            // Ball's on the green AND the putter is the active club — swap Track /
            // Add Shot for the putt recorder, mirroring the phone's putting panel.
            // Picking a non-putter (to chip from the fringe) falls through to the
            // normal controls. Uses the watch's OWN on-green test (phone result OR
            // watch GPS-within-radius) so it arms even when the phone is
            // backgrounded. Checked BEFORE the at-course gate: being on the green
            // means you're on the course.
            puttControls(s)
        } else if holeCompleted(s) {
            // Hole is done but not in the putt view (e.g. walked off the green) —
            // NOW show the prev/next arrows so the player can move on. Arrows are
            // intentionally absent during active play.
            navRow(s)
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
            let displayed = puttFeetOverride ?? puttFeetToPin(s)
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    stepButton(system: "minus") {
                        puttFeetOverride = max(0, (puttFeetOverride ?? puttFeetToPin(s) ?? 0) - 1)
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
                        puttFeetOverride = max(0, (puttFeetOverride ?? puttFeetToPin(s) ?? 0) + 1)
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
        // Same source as the number the golfer just read — a putt must never be
        // recorded at a distance different from the one on screen.
        let feet = puttFeetOverride ?? puttFeetToPin(s)
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
    private func leftColumn(_ s: WatchRoundState, mapOn: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(distanceText(s))
                    .font(.system(size: 36, weight: .heavy, design: .rounded))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    // Pure white over imagery. The default label colour is
                    // slightly translucent, which is invisible against a bunker.
                    .foregroundStyle(mapOn ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                Text(distanceUnit(s))
                    .font(.caption2)
                    .foregroundColor(mapOn ? .white.opacity(0.8) : .secondary)
            }
            // What that big number is measured TO. It only ever meant one thing
            // before, but now that front and back sit under it the golfer has to
            // be able to tell which of the three the headline is — and "the
            // middle of the green" and "where the cup is today" are a full club
            // apart. Only shown when there's a live reading to label.
            if let label = primaryDistanceLabel(s) {
                Text(label)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(mapOn ? .white.opacity(0.75) : .secondary)
                    .tracking(0.5)
            }
            suggestedClubButton(s)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Caption for the headline yardage: whether it's measured to a real flag
    /// or to the middle of the green. Nil while previewing another hole (the
    /// number is then the static hole yardage, not a distance to anything from
    /// where the golfer is standing).
    private func primaryDistanceLabel(_ s: WatchRoundState) -> String? {
        guard !isPreviewing(s), liveDistanceToDisplayedPin(s) != nil else { return nil }
        if isOnGreen(s) { return "TO FLAG" }
        let geometry = mapGeometry(s)
        return targetIsRealPin(s, geometry: geometry) ? "TO PIN" : "CENTER"
    }

    /// `F 136        B 162` — the front and back of the green, measured along
    /// the line the golfer is actually playing.
    ///
    /// Derived from the real green polygon (see `HoleMapGeometry.greenDepth`),
    /// so it appears only for courses whose geometry includes one. A course with
    /// nothing but a green centroid shows the centre yardage alone rather than a
    /// made-up depth — a wrong front number is worse than no front number.
    ///
    /// Hidden on the green and while previewing another hole, where "front" and
    /// "back" stop meaning anything and the row would only cost space the putt
    /// controls need.
    @ViewBuilder
    private func greenDepthRow(_ s: WatchRoundState) -> some View {
        if !isPreviewing(s), !isOnGreen(s),
           let player = session.lastLocation?.coordinate,
           let depth = mapGeometry(s)?.greenDepth(from: player) {
            HStack(spacing: 0) {
                depthCell("F", GeoMath.yards(fromMeters: GeoMath.distance(player, depth.front)))
                Spacer(minLength: 4)
                depthCell("B", GeoMath.yards(fromMeters: GeoMath.distance(player, depth.back)))
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func depthCell(_ prefix: String, _ yards: Int) -> some View {
        HStack(spacing: 3) {
            Text(prefix)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.yellow)
            Text("\(yards)")
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .foregroundColor(.white)
        }
        // Spoken as "Front 136" rather than "F 136" — the abbreviation is a
        // space compromise for the screen, not for the reader.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(prefix == "F" ? "Front \(yards) yards" : "Back \(yards) yards")
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
            HStack(spacing: 3) {
                Image(systemName: (club?.isPutter ?? false) ? "circle.dotted" : "figure.golf")
                    .font(.system(size: 9))
                    .foregroundColor(.yellow)
                Text(club?.name ?? "Club")
                    .font(.system(size: 10, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
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

    /// Feet to the pin for the PUTT panel — the number shown, stepped with ±,
    /// and recorded as the putt's distance.
    ///
    /// Prefers the watch's OWN live GPS for exactly the reason `displayDistance`
    /// does: the phone's pushed `distanceFeet` FREEZES while the phone is
    /// backgrounded, which is the normal state during play. The putt panel was
    /// still reading that frozen value, so the same screen could show 30 ft in
    /// the headline (live GPS) and 117 ft here (stale phone push) — and the
    /// stale number was the one recorded against the putt.
    ///
    /// Falls back to the phone's value only when there's no usable fix.
    private func puttFeetToPin(_ s: WatchRoundState) -> Int? {
        if let yards = liveDistanceToDisplayedPin(s) {
            return Int((yards * 3).rounded())
        }
        return s.distanceFeet
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
    /// watch's self-sufficient fallback.
    ///
    /// Was 8 yards (24 ft), which is SHORTER THAN A NORMAL PUTT — a golfer 30 ft
    /// from the pin was left off-green by the watch's own test, so putting mode
    /// only armed when the phone happened to be awake. 15 yards (45 ft) covers
    /// realistic long putts.
    ///
    /// Tunable, and a genuine trade: bigger catches long putts from the fringe,
    /// smaller avoids arming on a chip from just off the green. Erring large is
    /// the cheaper mistake here — a wrongly-armed putt view is visible and
    /// recoverable (the club picker is right there), whereas failing to arm
    /// means the golfer can't record the putt from the watch at all.
    private let onGreenRadiusYards: Double = 15

    /// Distance (yards from the pin) past which the watch's own GPS OVERRULES a
    /// phone snapshot claiming you're on the green.
    ///
    /// `s.onGreen` is computed by the phone, and the phone is in a pocket for
    /// most of a round — so that flag doesn't go false when you walk off the
    /// green, it just STOPS UPDATING, holding whatever it said when the phone
    /// last ran. Trusting it unconditionally is what left the putt view up on
    /// the next tee: it also forces the club to the putter (see
    /// `rawEffectiveClubId`), which satisfies the putt-view gate's other half,
    /// so the two propped each other up until the app was restarted.
    ///
    /// Well clear of the on-green radius so a front-pin green whose centre is
    /// the only mapped point can still read as on-green; but no green is 45
    /// yards from its own flag, so past this we are certainly off it.
    private let definitelyOffGreenYards: Double = 45

    /// Effective on-green for the DISPLAYED hole: the phone's exact result when
    /// it's awake, OR the watch's own GPS-within-radius test so putting mode
    /// still arms when the phone is asleep. Only for the hole you're physically
    /// on (not a previewed hole).
    private func isOnGreen(_ s: WatchRoundState) -> Bool {
        // A hole you're only previewing is a hole you're not standing on.
        // (Checked before the phone flag, which describes the hole the PHONE
        // thinks you're playing — not the one being shown.)
        if isPreviewing(s) { return false }
        if let yards = liveDistanceToDisplayedPin(s) {
            // Our own GPS is live even when the phone's isn't, so it gets the
            // last word in both directions.
            if yards > definitelyOffGreenYards { return false }
            return s.onGreen || yards <= onGreenRadiusYards
        }
        // No usable fix — the phone's last word is all we have.
        return s.onGreen
    }

    // MARK: - Course map

    /// Resolved geometry for the hole currently on screen.
    ///
    /// Keyed on the DISPLAYED hole, not the phone's — stepping ahead with the
    /// watch arrows should show the next hole's map immediately, for the same
    /// reason those arrows show its yardage immediately: the pocketed phone
    /// won't process the navigation until it next runs.
    private func mapGeometry(_ s: WatchRoundState) -> HoleMapGeometry? {
        guard s.courseMapEnabled,
              let courseId = s.courseId,
              let n = displayedHoleNumber(s) else { return nil }
        return courseMap.geometry(forHole: n, courseId: courseId)
    }

    /// Where the golfer is playing to, for the camera and the flag marker.
    ///
    /// Same precedence the yardages already use, so the map and the numbers can
    /// never disagree: the round's pin for this hole (moved on either device
    /// during THIS round) beats the course's stored pin, which beats the green
    /// centroid.
    private func mapTarget(
        _ s: WatchRoundState,
        geometry: HoleMapGeometry?
    ) -> CLLocationCoordinate2D? {
        if let hole = displayedHole(s), let lat = hole.pinLat, let lng = hole.pinLng {
            return CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }
        if !isPreviewing(s), let lat = s.pinLat, let lng = s.pinLng {
            return CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }
        return geometry?.storedPin ?? geometry?.greenCenter
    }

    /// True when the target is a genuine flag position rather than the middle
    /// of the green.
    ///
    /// The phone's pin field already falls back to the green centroid when no
    /// flag has been recorded, so the value alone can't answer this — but the
    /// two are a full club apart for the golfer, so the map draws them
    /// differently and the headline yardage labels itself accordingly. Testing
    /// against the green centroid is what recovers the distinction: within a
    /// couple of metres of the centroid, it IS the centroid.
    private func targetIsRealPin(
        _ s: WatchRoundState,
        geometry: HoleMapGeometry?
    ) -> Bool {
        guard let target = mapTarget(s, geometry: geometry) else { return false }
        guard let center = geometry?.greenCenter else {
            // No green centroid to compare against: a pin we were given is the
            // only position we have, so treat it as real.
            return true
        }
        return GeoMath.distance(target, center) > 2
    }

    /// Ask the store for this course's cached geometry. Idempotent — it
    /// early-returns once the right course is loaded.
    private func loadCourseMapIfNeeded(_ s: WatchRoundState) {
        guard s.courseMapEnabled, let courseId = s.courseId else { return }
        courseMap.ensureLoaded(courseId: courseId)
    }

    #if DEBUG
    /// Why there is no map, said out loud.
    ///
    /// Without this a missing map is a blank — and "the phone never sent it",
    /// "this course has no OSM geometry", "the file is for a different course"
    /// and "the setting is off" all look identical, which is exactly the state
    /// this screen was in when it couldn't be debugged. DEBUG-only: on a real
    /// round the right behaviour is still to say nothing and quietly keep the
    /// plain background.
    @ViewBuilder
    private func mapDiagnostic(_ s: WatchRoundState, mapOn: Bool) -> some View {
        if !mapOn, let reason = mapUnavailableReason(s) {
            Text(reason)
                .font(.system(size: 8))
                .foregroundColor(.orange)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
        }
    }

    private func mapUnavailableReason(_ s: WatchRoundState) -> String? {
        guard s.active else { return nil }
        guard s.courseMapEnabled else { return "map off (phone setting)" }
        guard let courseId = s.courseId else { return "map: round has no courseId" }
        if let err = courseMap.lastError { return "map decode failed: \(err)" }
        guard let loaded = courseMap.course else {
            // The phone's own report is far more useful than "not received":
            // it separates "this course has no geometry" from "the transfer
            // failed" from "it's queued and still in flight".
            switch s.courseMapStatus {
            case .some("noGeometry"): return "map: course has no geometry"
            case .some(let other): return "map: \(other)"
            case nil: return "map: phone hasn't sent it"
            }
        }
        guard loaded.courseId == courseId else { return "map: loaded a different course" }
        guard let n = displayedHoleNumber(s) else { return "map: no hole number" }
        return "map: no geometry for hole \(n) of \(loaded.holes.count)"
    }

    /// DEBUG-only walk simulator. Tap to step tee → fairway → approach → green
    /// → off, injecting a fix at each stop through the same buffer Core Location
    /// writes to, so the yardages, the club suggestion, the on-green test and
    /// the camera all respond exactly as they would on a real course.
    ///
    /// The whole control is inside `#if DEBUG`, so no fake-location affordance
    /// exists in a shipping build.
    @ViewBuilder
    private func simulatedWalkChip(_ s: WatchRoundState) -> some View {
        let sim = SimulatedRoundWalk.shared
        Button {
            let geometry = mapGeometry(s)
            sim.cycle(geometry: geometry, pin: mapTarget(s, geometry: geometry))
        } label: {
            Text(sim.stop.label)
                .font(.system(size: 8, weight: .heavy))
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(sim.isActive ? Color.purple.opacity(0.8) : Color.gray.opacity(0.35))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        // Stepping holes re-places the simulated golfer on the new hole,
        // instead of leaving them standing on the previous fairway.
        .onChange(of: displayedHoleNumber(s)) { _, _ in
            let geometry = mapGeometry(s)
            sim.emit(geometry: geometry, pin: mapTarget(s, geometry: geometry))
        }
    }
    #endif

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
