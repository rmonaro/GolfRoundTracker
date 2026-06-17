import SwiftUI
import CoreLocation

/// Two-step shot recording: pick a club, then pick a result. We capture a
/// GPS "start" fix when the user opens this sheet and an "end" fix at submit.
struct ShotRecordFlow: View {
    @EnvironmentObject var session: WatchSession
    @Binding var isPresented: Bool
    /// Optional pre-selected club id (passed by HoleHomeView so the watch
    /// opens the flow already on the phone's suggested/selected club).
    /// Nil falls back to the legacy two-step flow that starts on the
    /// picker.
    let initialClubId: String?
    /// When true, the GPS start position was already captured before the
    /// modal opened (Track button flow) — don't call `captureShotStart`
    /// a second time in the club picker.
    let startAlreadyCaptured: Bool
    /// When true, the flow runs as a CLUB CHANGER only: picking a club
    /// fires `selectClub` to the phone (so the new selected club flows
    /// back via snapshot) and dismisses the modal — no GPS capture, no
    /// progression to the result picker. Used when the user taps the
    /// home-view's suggested-club pill specifically to swap clubs.
    let clubPickerOnly: Bool

    @State private var step: Step = .pickClub
    @State private var selectedClubId: String?

    enum Step { case pickClub, pickResult }

    init(
        isPresented: Binding<Bool>,
        initialClubId: String? = nil,
        startAlreadyCaptured: Bool = false,
        clubPickerOnly: Bool = false
    ) {
        self._isPresented = isPresented
        self.initialClubId = initialClubId
        self.startAlreadyCaptured = startAlreadyCaptured
        self.clubPickerOnly = clubPickerOnly
        // Seed the state from the prop so .onAppear isn't required.
        self._selectedClubId = State(initialValue: initialClubId)
        self._step = State(initialValue: initialClubId != nil ? .pickResult : .pickClub)
    }

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
                            // Club-changer mode: notify the phone that the
                            // selected club moved, then close the modal —
                            // do NOT capture a GPS start (this isn't part
                            // of a shot record) and do NOT advance to the
                            // result picker. Set the optimistic local
                            // override so the home view reflects the
                            // pick immediately, before the phone has
                            // round-tripped a new snapshot.
                            if clubPickerOnly {
                                session.setLocalSelectedClub(id)
                                session.send(.selectClub(clubId: id))
                                isPresented = false
                                return
                            }
                            // Normal flow — track-button-originated already
                            // grabbed the start. Calling captureShotStart
                            // again would overwrite it with a later (=
                            // closer to the ball) GPS fix and erase the
                            // shot's actual starting position.
                            if !startAlreadyCaptured {
                                session.captureShotStart()
                            }
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

    /// Decide which result picker to show for this shot.
    ///
    ///   • Putter                              → "putt"  (made/missed cross)
    ///   • Green is too far to realistically
    ///     reach this shot                     → "fairway" (left / hit / right)
    ///   • Otherwise (within reach, or distance
    ///     unknown) fall back to the phone's
    ///     shot/par heuristic                  → "fairway" on a par-4/5 tee shot,
    ///                                            else "green" (the cross).
    ///
    /// The distance gate is the important part: standing on a tee 493y out, you
    /// can't hit the green, so the green "hit + arrows" cross is meaningless —
    /// show the fairway left/right picker instead. The green cross only appears
    /// once you're inside a club-length of the green.
    private func targetTypeFor(selectedClubId: String?) -> String {
        let club = selectedClubId.flatMap { id in
            session.state.bag.first(where: { $0.id == id })
        }
        if club?.isPutter == true { return "putt" }

        // Prefer the watch's live GPS distance-to-pin; fall back to the static
        // distance from the phone snapshot. nil → unknown, skip the gate.
        let distanceYards = session.liveDistanceToPinYards().map { Int($0.rounded()) }
            ?? session.state.distanceYards
        if let dist = distanceYards, dist > greenReachableThresholdYards() {
            return "fairway"
        }

        // Within reach (or unknown): mirror the phone's pickTargetType so a
        // par-3 tee shot and approach shots map to the green cross while a
        // par-4/5 tee shot still reads as a fairway shot.
        let shotNumber = (session.state.shotsThisHole ?? 0) + 1
        let holePar = session.state.par ?? 4
        if shotNumber == 1 && holePar != 3 { return "fairway" }
        return "green"
    }

    /// Yardage at/under which the green is considered reachable on this shot —
    /// the longest non-putter club's typical carry, plus a little buffer for
    /// roll/adrenaline. Falls back to 250y when the bag has no distances set.
    private func greenReachableThresholdYards() -> Int {
        let longest = session.state.bag
            .compactMap { $0.isPutter ? nil : $0.typicalYards }
            .max()
        if let longest = longest { return longest + 15 }
        return 250
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

/// Targeted result selector laid out as a spatial diagram so the player
/// taps in the direction the ball actually went:
///
///   • green / putt → cross (Long up, Short down, Left/Right sides) with
///     a center "Hit" (or "Made" for putts).
///   • fairway      → three buttons in a row: Left | Fairway hit | Right.
///                    No short/long — those aren't recorded for fairway
///                    target shots in this app.
struct ResultPickerView: View {
    let targetType: String
    let onCancel: () -> Void
    let onSubmit: (_ targetType: String, _ targetResult: String) -> Void

    private var isFairway: Bool { targetType == "fairway" }
    private var isPutt: Bool { targetType == "putt" }

    private var centerLabel: String {
        if isPutt { return "Made" }
        if isFairway { return "Fairway" }
        return "Hit"
    }
    private var centerValue: String { isPutt ? "made" : "hit" }

    var body: some View {
        Group {
            if isFairway {
                fairwayRow
            } else {
                crossLayout
            }
        }
        .navigationTitle(isPutt ? "Putt" : "Result")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
        }
    }

    // MARK: - Layouts

    /// Three-button horizontal row for fairway shots: Left | Fairway | Right.
    @ViewBuilder
    private var fairwayRow: some View {
        HStack(spacing: 8) {
            arrowButton(system: "arrow.left", value: "left", a11y: "Missed left")
            centerButton(width: 92, height: 92)
            arrowButton(system: "arrow.right", value: "right", a11y: "Missed right")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Cross / "compass" layout for green + putt targets:
    ///   • top    → long
    ///   • bottom → short
    ///   • left   → left miss
    ///   • right  → right miss
    ///   • center → hit (or made, for putts)
    @ViewBuilder
    private var crossLayout: some View {
        VStack(spacing: 6) {
            arrowButton(system: "arrow.up", value: "long", a11y: "Long")
            HStack(spacing: 6) {
                arrowButton(system: "arrow.left", value: "left", a11y: "Left")
                centerButton(width: 78, height: 78)
                arrowButton(system: "arrow.right", value: "right", a11y: "Right")
            }
            arrowButton(system: "arrow.down", value: "short", a11y: "Short")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Buttons

    @ViewBuilder
    private func arrowButton(system: String, value: String, a11y: String) -> some View {
        Button {
            onSubmit(targetType, value)
        } label: {
            Image(systemName: system)
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.orange)
                .frame(width: 42, height: 42)
                .background(Color.orange.opacity(0.18))
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(a11y)
    }

    /// Big center target. Green-tinted to read as the positive outcome.
    @ViewBuilder
    private func centerButton(width: CGFloat, height: CGFloat) -> some View {
        Button {
            onSubmit(targetType, centerValue)
        } label: {
            Text(centerLabel)
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .multilineTextAlignment(.center)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 6)
                .frame(width: width, height: height)
                .background(Color.green.opacity(0.55))
                .clipShape(Circle())
                .foregroundColor(.white)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(centerLabel)
    }
}
