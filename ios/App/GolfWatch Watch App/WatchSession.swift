import Foundation
import WatchConnectivity
import CoreLocation
import Combine

/// Round-state snapshot received from the phone. Mirrors the JS-side
/// `WatchRoundState` interface in `src/services/watchBridge.ts` — keep the
/// two in sync.
/// Brief summary of the most-recent GPS auto-recorded shot, shown as the
/// watch's post-save overview. Mirrors the JS `lastShotSummary` field.
struct WatchShotSummary: Equatable {
    let id: Int
    let clubName: String
    let result: String
    let distanceText: String

    init?(dict: [String: Any]) {
        guard let id = dict["id"] as? Int,
              let clubName = dict["clubName"] as? String,
              let result = dict["result"] as? String,
              let distanceText = dict["distanceText"] as? String else { return nil }
        self.id = id
        self.clubName = clubName
        self.result = result
        self.distanceText = distanceText
    }
}

/// One hole's headline data, so the watch can navigate holes locally and show
/// the tee yardage + suggested club without a phone roundtrip. Mirrors an entry
/// of the JS `holes` array.
struct WatchHole: Equatable, Identifiable {
    let holeNumber: Int
    let par: Int?
    let yardage: Int?
    let suggestedClubId: String?
    let shots: Int?
    let putts: Int?
    let pinLat: Double?
    let pinLng: Double?
    var id: Int { holeNumber }

    init?(dict: [String: Any]) {
        guard let holeNumber = dict["holeNumber"] as? Int else { return nil }
        self.holeNumber = holeNumber
        self.par = dict["par"] as? Int
        self.yardage = dict["yardage"] as? Int
        self.suggestedClubId = dict["suggestedClubId"] as? String
        self.shots = dict["shots"] as? Int
        self.putts = dict["putts"] as? Int
        self.pinLat = dict["pinLat"] as? Double
        self.pinLng = dict["pinLng"] as? Double
    }
}

struct WatchRoundState: Equatable {
    let active: Bool
    let courseName: String?
    let holeNumber: Int?
    let holesPlayed: Int?
    let par: Int?
    let distanceYards: Int?
    let distanceFeet: Int?
    let scoreVsPar: String?
    let shotsThisHole: Int?
    let puttsThisHole: Int?
    let suggestedClubId: String?
    let selectedClubId: String?
    let recordingShot: Bool
    /// User's Apple Watch shot-detection setting, mirrored from the phone.
    /// Gates whether `RoundShotController` runs during a round. Defaults true
    /// when the phone doesn't send it (older build / missing key).
    let shotDetection: Bool
    /// On/around the green (current hole) → show live distance in feet, not yards.
    let onGreen: Bool
    /// Hole holed out (last shot a made putt). The prev/next hole arrows show
    /// ONLY when this is true — hidden during active play.
    let holeComplete: Bool
    /// Whether the user is within range of the course (phone's 2km gate).
    /// nil → unknown; the watch treats nil as at-course so a missing fix
    /// never blocks play. false → watch hides Track / Add Shot.
    let atCourse: Bool?
    /// Current phone auto-track state, so the watch Track button is a synced
    /// toggle that reflects reality even if the at-course gate refused to start.
    let autoTracking: Bool
    /// Transient summary of the most-recent GPS auto-recorded shot (id bumps
    /// per shot so the overview shows once).
    let lastShotSummary: WatchShotSummary?
    /// Every hole's headline data, for local hole navigation on the watch.
    let holes: [WatchHole]
    let pinLat: Double?
    let pinLng: Double?
    let bag: [WatchClub]

    static let empty = WatchRoundState(
        active: false,
        courseName: nil, holeNumber: nil, holesPlayed: nil, par: nil,
        distanceYards: nil, distanceFeet: nil, scoreVsPar: nil,
        shotsThisHole: nil, puttsThisHole: nil,
        suggestedClubId: nil, selectedClubId: nil,
        recordingShot: false, shotDetection: true, onGreen: false,
        holeComplete: false,
        atCourse: nil, autoTracking: false, lastShotSummary: nil,
        holes: [], pinLat: nil, pinLng: nil, bag: []
    )

    init(
        active: Bool,
        courseName: String? = nil,
        holeNumber: Int? = nil,
        holesPlayed: Int? = nil,
        par: Int? = nil,
        distanceYards: Int? = nil,
        distanceFeet: Int? = nil,
        scoreVsPar: String? = nil,
        shotsThisHole: Int? = nil,
        puttsThisHole: Int? = nil,
        suggestedClubId: String? = nil,
        selectedClubId: String? = nil,
        recordingShot: Bool = false,
        shotDetection: Bool = true,
        onGreen: Bool = false,
        holeComplete: Bool = false,
        atCourse: Bool? = nil,
        autoTracking: Bool = false,
        lastShotSummary: WatchShotSummary? = nil,
        holes: [WatchHole] = [],
        pinLat: Double? = nil,
        pinLng: Double? = nil,
        bag: [WatchClub] = []
    ) {
        self.active = active
        self.courseName = courseName
        self.holeNumber = holeNumber
        self.holesPlayed = holesPlayed
        self.par = par
        self.distanceYards = distanceYards
        self.distanceFeet = distanceFeet
        self.scoreVsPar = scoreVsPar
        self.shotsThisHole = shotsThisHole
        self.puttsThisHole = puttsThisHole
        self.suggestedClubId = suggestedClubId
        self.selectedClubId = selectedClubId
        self.recordingShot = recordingShot
        self.shotDetection = shotDetection
        self.onGreen = onGreen
        self.holeComplete = holeComplete
        self.atCourse = atCourse
        self.autoTracking = autoTracking
        self.lastShotSummary = lastShotSummary
        self.holes = holes
        self.pinLat = pinLat
        self.pinLng = pinLng
        self.bag = bag
    }

    /// Decode from the dictionary that `updateApplicationContext` ships over.
    init?(dict: [String: Any]) {
        guard let active = dict["active"] as? Bool else { return nil }
        self.active = active
        self.courseName = dict["courseName"] as? String
        self.holeNumber = dict["holeNumber"] as? Int
        self.holesPlayed = dict["holesPlayed"] as? Int
        self.par = dict["par"] as? Int
        self.distanceYards = dict["distanceYards"] as? Int
        self.distanceFeet = dict["distanceFeet"] as? Int
        self.scoreVsPar = dict["scoreVsPar"] as? String
        self.shotsThisHole = dict["shotsThisHole"] as? Int
        self.puttsThisHole = dict["puttsThisHole"] as? Int
        self.suggestedClubId = dict["suggestedClubId"] as? String
        self.selectedClubId = dict["selectedClubId"] as? String
        self.recordingShot = (dict["recordingShot"] as? Bool) ?? false
        self.shotDetection = (dict["shotDetection"] as? Bool) ?? true
        self.onGreen = (dict["onGreen"] as? Bool) ?? false
        self.holeComplete = (dict["holeComplete"] as? Bool) ?? false
        self.atCourse = dict["atCourse"] as? Bool
        self.autoTracking = (dict["autoTracking"] as? Bool) ?? false
        if let rawSummary = dict["lastShotSummary"] as? [String: Any] {
            self.lastShotSummary = WatchShotSummary(dict: rawSummary)
        } else {
            self.lastShotSummary = nil
        }
        if let rawHoles = dict["holes"] as? [[String: Any]] {
            self.holes = rawHoles.compactMap { WatchHole(dict: $0) }
        } else {
            self.holes = []
        }
        self.pinLat = dict["pinLat"] as? Double
        self.pinLng = dict["pinLng"] as? Double
        if let rawBag = dict["bag"] as? [[String: Any]] {
            self.bag = rawBag.compactMap { WatchClub(dict: $0) }
        } else {
            self.bag = []
        }
    }
}

struct WatchClub: Equatable, Identifiable {
    let id: String
    let name: String
    let isPutter: Bool
    let typicalYards: Int?

    init(clubId: String, name: String, isPutter: Bool, typicalYards: Int?) {
        self.id = clubId
        self.name = name
        self.isPutter = isPutter
        self.typicalYards = typicalYards
    }

    init?(dict: [String: Any]) {
        guard let id = dict["clubId"] as? String,
              let name = dict["name"] as? String,
              let isPutter = dict["isPutter"] as? Bool else { return nil }
        self.id = id
        self.name = name
        self.isPutter = isPutter
        if let yds = dict["typicalYards"] as? Int {
            self.typicalYards = yds
        } else if let yds = dict["typicalYards"] as? Double {
            self.typicalYards = Int(yds.rounded())
        } else {
            self.typicalYards = nil
        }
    }
}

/// Discriminated union of message types the watch sends back. The phone-side
/// JS parses `type` and routes accordingly — see `WatchInboundMessage` in
/// `src/services/watchBridge.ts`.
enum WatchOutboundMessage {
    case recordShot(clubId: String?, targetType: String, targetResult: String,
                    start: CLLocation?, end: CLLocation?, distanceFeet: Int? = nil)
    case navigateHole(direction: String) // "prev" | "next"
    /// Watch user toggled the Track-shot button. `active=true` when the
    /// user starts tracking (after captureShotStart), false when they
    /// end or cancel. The phone uses this to render a "Watch tracking
    /// shot…" indicator and to stage the start position on the map.
    /// `current` is also sent on periodic updates so the phone can
    /// render a live "you are here" dot for the watch user.
    case trackingShot(active: Bool, start: CLLocation?, current: CLLocation? = nil)
    /// Watch user picked a club via the home-view club pill (NOT as
    /// part of a shot record). Phone should update its `selectedClubId`
    /// so the next suggestion / shot default reflects the change.
    case selectClub(clubId: String)
    /// Watch toggled round-wide auto-tracking. The phone enables/disables its
    /// own auto-track (respecting the at-course gate) and echoes the result
    /// back via the snapshot's `autoTracking`.
    case setAutoTrack(active: Bool)
    /// Watch wants to log a shot at the user's current GPS position — Track-off
    /// "I'm at my ball" or the Add Shot button. The phone fills the start from
    /// the hole's prior ball position, infers fairway/left/right from `end`,
    /// auto-saves, and returns a summary via the snapshot. No pickers involved.
    case autoShot(clubId: String?, start: CLLocation?, end: CLLocation?)

    // --- Practice-mode swing feedback (motion-based) ---
    /// Practice session started on the watch. Carries the watch-minted
    /// session id so the phone can correlate the swings that follow.
    case practiceStarted(sessionId: String, clubId: String?)
    /// One detected swing's motion metrics. All values are relative /
    /// estimated — NOT launch-monitor measurements. `heartRate` is the live
    /// bpm at swing time (0 when HealthKit isn't available).
    case swingDetected(sessionId: String, swingIndex: Int, metrics: SwingMetrics, clubId: String?, heartRate: Int)
    /// User changed the practice club mid-session.
    case practiceClubSelected(sessionId: String, clubId: String)
    /// Practice session ended on the watch, with an optional health summary.
    case practiceEnded(sessionId: String, swingCount: Int, health: WorkoutSummary?)

    // --- Round-mode strike detection (Phase 1 auto-track gating) ---
    /// A confirmed ball-strike during a live round (real impact spike, NOT an
    /// air/practice swing). The phone's auto-track uses this to gate GPS shot
    /// detection. `capturedAt` is the watch clock (epoch ms); the phone trusts
    /// arrival time, not this, for recency. `location` is the watch's best
    /// recent fix at impact, if any.
    /// Carries the FULL motion metrics (same bundle as `.swingDetected`) so the
    /// phone can store swing tempo/quality on the recorded round shot and use
    /// `swingType` to classify it (migration 031). `handSpeed` on the wire is
    /// `metrics.estimatedHandSpeed`.
    case swingImpact(impactId: Int, capturedAt: Double, metrics: SwingMetrics,
                     location: CLLocation?, clubId: String?)

    var payload: [String: Any] {
        switch self {
        case .recordShot(let clubId, let targetType, let targetResult, let start, let end, let distanceFeet):
            var d: [String: Any] = [
                "type": "recordShot",
                "clubId": clubId ?? NSNull(),
                "targetType": targetType,
                "targetResult": targetResult
            ]
            if let s = start {
                d["startLat"] = s.coordinate.latitude
                d["startLng"] = s.coordinate.longitude
            }
            if let e = end {
                d["endLat"] = e.coordinate.latitude
                d["endLng"] = e.coordinate.longitude
            }
            // For putts the watch sends the (player-adjusted) feet-to-flag
            // directly — GPS can't measure a putt, so this is the source of
            // truth the phone saves.
            if let ft = distanceFeet {
                d["distanceFeet"] = ft
            }
            return d
        case .navigateHole(let direction):
            return ["type": "navigateHole", "direction": direction]
        case .trackingShot(let active, let start, let current):
            var d: [String: Any] = [
                "type": "trackingShot",
                "active": active
            ]
            if let s = start {
                d["startLat"] = s.coordinate.latitude
                d["startLng"] = s.coordinate.longitude
            }
            if let c = current {
                d["currentLat"] = c.coordinate.latitude
                d["currentLng"] = c.coordinate.longitude
            }
            return d
        case .selectClub(let clubId):
            return ["type": "selectClub", "clubId": clubId]
        case .setAutoTrack(let active):
            return ["type": "setAutoTrack", "active": active]
        case .autoShot(let clubId, let start, let end):
            var d: [String: Any] = [
                "type": "autoShot",
                "clubId": clubId ?? NSNull()
            ]
            if let s = start {
                d["startLat"] = s.coordinate.latitude
                d["startLng"] = s.coordinate.longitude
            }
            if let e = end {
                d["endLat"] = e.coordinate.latitude
                d["endLng"] = e.coordinate.longitude
            }
            return d
        case .practiceStarted(let sessionId, let clubId):
            return [
                "type": "practiceStarted",
                "sessionId": sessionId,
                "clubId": clubId ?? NSNull()
            ]
        case .swingDetected(let sessionId, let swingIndex, let m, let clubId, let heartRate):
            var d: [String: Any] = [
                "type": "swingDetected",
                "sessionId": sessionId,
                "swingIndex": swingIndex,
                "clubId": clubId ?? NSNull(),
                "capturedAt": Date().timeIntervalSince1970,
                "backswingTimeMs": m.backswingTimeMs,
                "downswingTimeMs": m.downswingTimeMs,
                "tempoRatio": m.tempoRatio,
                "transitionScore": m.transitionScore,
                "estimatedHandSpeed": m.estimatedHandSpeed,
                "wristRotationScore": m.wristRotationScore,
                "finishStabilityScore": m.finishStabilityScore,
                "planeAxis": m.planeAxis,
                "swingType": m.swingType,
                "isAirSwing": m.isAirSwing,
                "backswingRotation": m.backswingRotation,
                "releaseTimingScore": m.releaseTimingScore,
                "decelerationScore": m.decelerationScore,
                "transitionDirectionScore": m.transitionDirectionScore,
                "addressGravity": m.addressGravity
            ]
            if heartRate > 0 { d["heartRate"] = heartRate }
            return d
        case .practiceClubSelected(let sessionId, let clubId):
            return [
                "type": "practiceClubSelected",
                "sessionId": sessionId,
                "clubId": clubId
            ]
        case .practiceEnded(let sessionId, let swingCount, let health):
            var d: [String: Any] = [
                "type": "practiceEnded",
                "sessionId": sessionId,
                "swingCount": swingCount
            ]
            if let h = health, h.hasData {
                d["avgHeartRate"] = Int(h.avgHeartRate.rounded())
                d["maxHeartRate"] = Int(h.maxHeartRate.rounded())
                d["minHeartRate"] = Int(h.minHeartRate.rounded())
                d["hrvSdnn"] = h.hrvSdnn
                d["activeCalories"] = h.activeCalories
                d["durationSeconds"] = h.durationSeconds
            }
            return d
        case .swingImpact(let impactId, let capturedAt, let m, let location, let clubId):
            var d: [String: Any] = [
                "type": "roundImpact",
                "impactId": impactId,
                "capturedAt": capturedAt,
                "swingType": m.swingType,
                "handSpeed": m.estimatedHandSpeed,
                // Full motion bundle (migration 031) — mirrors swingDetected so
                // the round shot carries practice-grade swing tempo/quality.
                "backswingTimeMs": m.backswingTimeMs,
                "downswingTimeMs": m.downswingTimeMs,
                "tempoRatio": m.tempoRatio,
                "transitionScore": m.transitionScore,
                "wristRotationScore": m.wristRotationScore,
                "finishStabilityScore": m.finishStabilityScore,
                "planeAxis": m.planeAxis,
                "backswingRotation": m.backswingRotation,
                "releaseTimingScore": m.releaseTimingScore,
                "decelerationScore": m.decelerationScore,
                "transitionDirectionScore": m.transitionDirectionScore,
                "addressGravity": m.addressGravity,
                "clubId": clubId ?? NSNull()
            ]
            if let l = location {
                d["startLat"] = l.coordinate.latitude
                d["startLng"] = l.coordinate.longitude
            }
            return d
        }
    }
}

/// One-stop ObservableObject the SwiftUI views observe. Manages:
///   • WCSession activation + delegate
///   • Round-state mirror (`state`) updated when the phone pushes context
///   • Reachability flag (`reachable`)
///   • Shot-record / hole-navigate outbound messages
///   • Single-fix CLLocationManager for GPS pin drops
@MainActor
final class WatchSession: NSObject, ObservableObject {
    static let shared = WatchSession()

    @Published private(set) var state: WatchRoundState = .empty
    @Published private(set) var reachable: Bool = false
    @Published private(set) var lastLocation: CLLocation?
    @Published private(set) var locationAuthStatus: CLAuthorizationStatus = .notDetermined
    /// Optimistic local override of the selected club. Set when the
    /// watch user picks a new club via the home-view picker — the
    /// home view reads this immediately so the UI updates without
    /// waiting for the phone roundtrip (selectClub message → phone
    /// state update → snapshot back). Cleared on the next snapshot
    /// arrival, since by then the phone has confirmed the pick.
    @Published private(set) var localSelectedClubId: String?
    /// Optimistic local override of the auto-track on/off state. Set the instant
    /// the user taps Track so the button flips immediately instead of waiting on
    /// the phone roundtrip (setAutoTrack → phone applyAutoTrack → snapshot back),
    /// which can take seconds — or stall entirely when the phone is backgrounded
    /// — and made the button feel like it needed several taps. Cleared when the
    /// phone's snapshot confirms the new state, or by a safety timeout if the
    /// phone never does (e.g. the at-course gate refused to start tracking).
    @Published private(set) var localAutoTracking: Bool?
    /// Pending auto-clear for `localAutoTracking` so a refused/lost toggle falls
    /// back to the phone's real state instead of sticking optimistically.
    private var autoTrackOverrideTask: Task<Void, Never>?

    /// Optimistic per-hole shot counts for shots the watch recorded or detected
    /// but the phone hasn't yet confirmed via a fresh snapshot — the phone is
    /// usually pocketed/backgrounded mid-round, so its snapshot (and every count
    /// it computes) freezes. Keyed by hole number; the Shots readout shows
    /// max(snapshot count, this) so a swing shows up immediately. Reconciled away
    /// in `didReceiveApplicationContext` once the phone catches up or moves on.
    @Published private(set) var pendingShotCounts: [Int: Int] = [:]

    /// The last non-nil club the home view resolved for display. Two jobs: the
    /// club pill never blanks to "Club" when the phone momentarily supplies no
    /// selection (it nulls `selectedClubId` after each shot), and an
    /// auto-detected strike can report which club was in hand to the phone.
    @Published private(set) var lastResolvedClubId: String?

    private let locationManager = CLLocationManager()
    /// Latched start-position for the current "in-progress" shot. Captured
    /// when the user taps "Start Shot" on the recording flow; the end
    /// position is captured at submit time.
    private(set) var pendingShotStart: CLLocation?

    /// True while we're keeping the GPS feed open between shots for live
    /// distance-to-pin. Separate from `pendingShotStart`-driven updates
    /// so a stop-shot doesn't kill the live distance display.
    private var continuousLocationActive: Bool = false

    /// True while the watch user is in shot-tracking mode (between Track
    /// tap and End Shot / cancel). Set by HoleHomeView via the helpers
    /// below. While true, `didUpdateLocations` forwards each accepted
    /// fix to the phone so it can render a live "you are here" dot for
    /// the watch user — same way the phone-side Track does for its own
    /// GPS. Rate-limited to ~1 update per second so we don't spam
    /// transferUserInfo / sendMessage.
    private var trackingShotActive: Bool = false
    private var lastTrackingUpdateSent: Date = .distantPast
    private static let TRACKING_UPDATE_INTERVAL_S: TimeInterval = 1.0

    /// Rolling buffer of recent acceptable GPS fixes. Used to pick the
    /// most accurate one at capture time instead of trusting whatever
    /// happened to land in `lastLocation` at the exact moment the user
    /// tapped — a single noisy fix arriving on tap can throw the
    /// recorded shot position by 100m+.
    private var recentFixes: [CLLocation] = []

    /// Hard accuracy floor for accepting a fix into `lastLocation` /
    /// `recentFixes`. Anything worse than this on a watch GPS is no
    /// better than guessing — drop the fix entirely. Negative values
    /// (Core Location's "invalid fix" signal) are also dropped.
    private static let MAX_ACCURACY_M: CLLocationAccuracy = 30
    /// How far back to look when picking the best fix at capture. Older
    /// fixes are dropped from the buffer so a stale "good" fix from
    /// 30 seconds ago can't outvote a fresh one.
    private static let FIX_WINDOW_S: TimeInterval = 5

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        // Get every fix the OS produces so the buffer can pick the
        // most accurate one. Default `distanceFilter` would drop
        // fixes that haven't moved enough — at golf walking speed
        // that's most of them.
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationAuthStatus = locationManager.authorizationStatus
    }

    /// Pick the best fix from the rolling buffer (lowest horizontal
    /// accuracy in the recent window). Falls back to `lastLocation`
    /// when the buffer is empty, then to nil. This is what gets
    /// recorded as the shot's start / end position.
    @MainActor
    private func bestRecentFix() -> CLLocation? {
        pruneRecentFixes()
        if let best = recentFixes.min(by: { $0.horizontalAccuracy < $1.horizontalAccuracy }) {
            return best
        }
        return lastLocation
    }

    /// Trim fixes older than FIX_WINDOW_S from the buffer.
    @MainActor
    private func pruneRecentFixes() {
        let cutoff = Date().addingTimeInterval(-Self.FIX_WINDOW_S)
        recentFixes.removeAll { $0.timestamp < cutoff }
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated {
            session.activate()
        }
        reachable = session.isReachable
    }

    // MARK: - Continuous GPS (for live distance-to-pin)

    /// Start keeping the GPS feed open. Idempotent. Caller should pair
    /// with `stopContinuousLocation()` when the round ends or the user
    /// backgrounds the app — leaving CLLocationManager running burns
    /// the watch battery fast.
    func startContinuousLocation() {
        guard !continuousLocationActive else { return }
        continuousLocationActive = true
        locationManager.startUpdatingLocation()
    }

    func stopContinuousLocation() {
        guard continuousLocationActive else { return }
        continuousLocationActive = false
        // Only call stop if no pending shot capture is also using it.
        if pendingShotStart == nil {
            locationManager.stopUpdatingLocation()
        }
    }

    /// Live distance from the watch's current GPS fix to the pin, in
    /// yards. Returns nil when GPS or pin isn't available — caller
    /// falls back to the static distance from the phone snapshot.
    func liveDistanceToPinYards() -> Double? {
        guard let plat = state.pinLat, let plng = state.pinLng else { return nil }
        return liveDistanceToPin(lat: plat, lng: plng)
    }

    /// Live yards from the watch's current GPS fix to an arbitrary pin. Returns
    /// nil when GPS is missing/stale/inaccurate so the caller can fall back to a
    /// static yardage.
    func liveDistanceToPin(lat: Double, lng: Double) -> Double? {
        guard let loc = lastLocation else { return nil }
        // Reject ancient fixes (>30s) — phone went out of sight, sat in
        // a bag, etc. A stale fix would lie about your distance.
        if loc.timestamp.timeIntervalSinceNow < -30 { return nil }
        // Reject very inaccurate fixes (>50m). At golf yardages this is
        // worse than just showing the phone-snapshot number.
        if loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > 50 { return nil }
        let pin = CLLocation(latitude: lat, longitude: lng)
        let meters = loc.distance(from: pin)
        return meters * 1.0936133
    }

    // MARK: - Outbound

    /// Send a message back to the phone. Tries the real-time
    /// `sendMessage` path first when both apps are reachable so
    /// interactive events (selectClub, trackingShot) land in <100ms
    /// instead of waiting on `transferUserInfo`'s queue. Falls back
    /// to `transferUserInfo` (guaranteed, FIFO) when not reachable
    /// OR if the live send errors out — that path still applies for
    /// `recordShot` which must never be dropped.
    func send(_ message: WatchOutboundMessage) {
        guard WCSession.default.activationState == .activated else { return }
        let payload = message.payload
        let session = WCSession.default
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { _ in
                // Live send failed — queue for delivery instead so the
                // event still lands eventually. The phone listener
                // treats both delivery paths the same way.
                WCSession.default.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }

    // MARK: - GPS

    func requestLocationPermission() {
        locationManager.requestWhenInUseAuthorization()
    }

    /// Capture a single high-accuracy GPS fix and stash it as the pending
    /// shot start. Pulls the most accurate recent fix rather than just
    /// whatever happened to be in `lastLocation` at the exact moment of
    /// tap — that pattern was causing wild start/end positions when a
    /// noisy fix arrived on the click.
    func captureShotStart() {
        pendingShotStart = bestRecentFix()
        locationManager.startUpdatingLocation()
    }

    /// Stop GPS updates and emit a `recordShot` with the best recent
    /// fix as the end position. Clears the pending start so the next
    /// shot starts fresh.
    func captureEndAndSend(clubId: String?, targetType: String, targetResult: String) {
        let end = bestRecentFix()
        // Don't stop continuous updates if a separate caller (live
        // distance-to-pin) is still using them. The continuous-tracking
        // toggle handles its own teardown.
        if !continuousLocationActive {
            locationManager.stopUpdatingLocation()
        }
        let start = pendingShotStart
        pendingShotStart = nil
        send(.recordShot(
            clubId: clubId, targetType: targetType, targetResult: targetResult,
            start: start, end: end
        ))
    }

    /// Record a putt from the watch's on-green panel. The distance is the
    /// feet-to-flag the player sees (and may have nudged with ± ), sent as the
    /// authoritative value since GPS can't measure a putt. `made` holes out.
    func recordPutt(clubId: String?, made: Bool, distanceFeet: Int?) {
        send(.recordShot(
            clubId: clubId,
            targetType: "putt",
            targetResult: made ? "made" : "missed",
            start: nil,
            end: bestRecentFix(),
            distanceFeet: distanceFeet
        ))
    }

    /// Cancel an in-progress shot capture without sending.
    func cancelShotCapture() {
        locationManager.stopUpdatingLocation()
        pendingShotStart = nil
    }

    /// Set the optimistic local club override. Called when the watch
    /// user picks a club via the home-view picker so the home view
    /// shows the new club immediately. The next snapshot from the
    /// phone clears the override.
    func setLocalSelectedClub(_ clubId: String) {
        localSelectedClubId = clubId
    }

    /// Clear the optimistic local club override — called on hole change so a
    /// manual pick (e.g. the putter after holing out) doesn't leak into the next
    /// hole, letting it re-derive the club from live distance / the pushed
    /// per-hole suggestion.
    func clearLocalSelectedClub() {
        localSelectedClubId = nil
    }

    /// Bump the optimistic shot count for `hole` up to at least `newCount`.
    func bumpPendingShotCount(hole: Int, to newCount: Int) {
        if newCount > (pendingShotCounts[hole] ?? 0) {
            pendingShotCounts[hole] = newCount
        }
    }

    /// The watch's motion detector confirmed a ball strike during a round —
    /// count it against the current hole so the Shots readout reflects the swing
    /// immediately (the backgrounded phone's snapshot won't). Skipped on the
    /// green so a putt stroke doesn't inflate the through-the-green shot count.
    func registerDetectedStrikeShotCount() {
        guard let hole = state.holeNumber, !state.onGreen else { return }
        let base = max(state.shotsThisHole ?? 0, pendingShotCounts[hole] ?? 0)
        bumpPendingShotCount(hole: hole, to: base + 1)
    }

    /// Remember the last real resolved club (see `lastResolvedClubId`).
    func noteResolvedClub(_ clubId: String?) {
        if let clubId, clubId != lastResolvedClubId {
            lastResolvedClubId = clubId
        }
    }

    /// Mark a shot-tracking session as active. While active, each new
    /// accepted GPS fix gets forwarded to the phone (rate-limited) so
    /// the phone map can render a live "you are here" dot for the
    /// watch user — same as the phone-side Track flow shows for its
    /// own GPS.
    func beginShotTrackingSession() {
        trackingShotActive = true
        lastTrackingUpdateSent = .distantPast
    }

    /// End the tracking session. Stops the live position forwarding.
    func endShotTrackingSession() {
        trackingShotActive = false
    }

    /// Request the phone enable/disable round-wide auto-tracking. Flips the
    /// optimistic local state immediately (so the button responds on the first
    /// tap) and arms a safety timeout to drop the override if the phone never
    /// confirms. The authoritative state still comes back via the snapshot's
    /// `autoTracking`, which clears the override on match.
    func setAutoTrack(_ active: Bool) {
        localAutoTracking = active
        autoTrackOverrideTask?.cancel()
        autoTrackOverrideTask = Task { [weak self] in
            // ~4s is long enough for a normal roundtrip to confirm (which clears
            // the override sooner) but short enough that a refusal self-heals.
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            self?.localAutoTracking = nil
        }
        send(.setAutoTrack(active: active))
    }

    /// Log a shot at the user's CURRENT position. Captures the best recent GPS
    /// fix as the end; the phone fills the start from the hole's prior ball
    /// position and infers fairway/left/right. Used by the watch's Track-off
    /// ("I'm at my ball") and Add Shot flows — no club/result picker.
    func recordAutoShot(clubId: String?) {
        let end = bestRecentFix()
        send(.autoShot(clubId: clubId, start: nil, end: end))
    }
}

// MARK: - WCSessionDelegate

extension WatchSession: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            self.reachable = session.isReachable
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.reachable = session.isReachable
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        guard let snapshot = WatchRoundState(dict: applicationContext) else { return }
        Task { @MainActor in
            self.state = snapshot
            // Reconcile round-mode strike detection against the desired state:
            // run only during a live round AND when the user's shot-detection
            // setting is on. Comparing against `isRunning` (not just an
            // active-edge) means a mid-round settings toggle starts/stops it
            // too. The controller itself no-ops while practice owns motion.
            let shouldDetect = snapshot.active && snapshot.shotDetection
            if shouldDetect && !RoundShotController.shared.isRunning {
                RoundShotController.shared.start()
            } else if !shouldDetect && RoundShotController.shared.isRunning {
                RoundShotController.shared.stop()
            }
            // Phone has confirmed an updated state — drop any optimistic
            // local override now that the snapshot reflects reality. If
            // the snapshot still doesn't match (slow round-trip), the
            // override stays — but the next snapshot will clear it.
            if let local = self.localSelectedClubId,
               snapshot.selectedClubId == local {
                self.localSelectedClubId = nil
            }
            // Same for the optimistic Track toggle: once the phone's snapshot
            // reflects the state we tapped, drop the override and cancel its
            // safety timeout so the button is fully back in lock-step.
            if let localTrack = self.localAutoTracking,
               snapshot.autoTracking == localTrack {
                self.localAutoTracking = nil
                self.autoTrackOverrideTask?.cancel()
            }
            // Drop optimistic shot counts the phone has now caught up to — or
            // passed. Once the snapshot's count for a hole meets our optimistic
            // value, or the phone has advanced to a later hole (so this hole's
            // count is final), trust the phone's number.
            if !self.pendingShotCounts.isEmpty {
                var resolvedHoles: [Int] = []
                for (hole, pending) in self.pendingShotCounts {
                    let snapCount = snapshot.holes.first(where: { $0.holeNumber == hole })?.shots
                        ?? (snapshot.holeNumber == hole ? snapshot.shotsThisHole : nil)
                    if let sc = snapCount, sc >= pending {
                        resolvedHoles.append(hole)
                    } else if let current = snapshot.holeNumber, current > hole {
                        resolvedHoles.append(hole)
                    }
                }
                for hole in resolvedHoles {
                    self.pendingShotCounts.removeValue(forKey: hole)
                }
            }
        }
    }

    /// Phone → watch commands (guaranteed FIFO). Currently just `startPractice`,
    /// sent when the user taps "Start Watch Practice" on the phone so the watch
    /// opens straight into a practice session. Round launches send no command.
    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        guard let command = userInfo["watchCommand"] as? String else { return }
        Task { @MainActor in
            switch command {
            case "startPractice":
                if !self.state.active && !PracticeController.shared.isActive {
                    PracticeController.shared.startSession(club: self.state.selectedClubId)
                }
            case "endPractice":
                // Phone ended the range/practice session — stop the watch
                // session too. endSession() ships `practiceEnded` back, which
                // the phone treats as idempotent.
                if PracticeController.shared.isActive {
                    PracticeController.shared.endSession()
                }
            default:
                break
            }
        }
    }
}

// MARK: - CLLocationManagerDelegate

extension WatchSession: CLLocationManagerDelegate {
    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let fix = locations.last else { return }
        // Drop fixes that Core Location couldn't trust: negative
        // accuracy = "no valid fix", and anything worse than
        // MAX_ACCURACY_M is too noisy to use as a shot position at
        // golf yardages. This is the line that stops a single bad
        // fix from overwriting `lastLocation` right when the user
        // taps Track / End Shot.
        if fix.horizontalAccuracy < 0 { return }
        if fix.horizontalAccuracy > WatchSession.MAX_ACCURACY_M { return }
        // Also drop ancient fixes the OS might be replaying (e.g.,
        // after a long background pause).
        if fix.timestamp.timeIntervalSinceNow < -10 { return }
        Task { @MainActor in
            self.lastLocation = fix
            self.recentFixes.append(fix)
            // Cap the buffer so it can't grow unbounded if the OS
            // floods updates faster than we prune.
            if self.recentFixes.count > 30 {
                self.recentFixes.removeFirst(self.recentFixes.count - 30)
            }
            self.pruneRecentFixes()
            // Forward the live position to the phone while a watch
            // tracking session is active. Rate-limited so we don't
            // saturate the WCSession channel.
            if self.trackingShotActive {
                let now = Date()
                if now.timeIntervalSince(self.lastTrackingUpdateSent)
                    >= WatchSession.TRACKING_UPDATE_INTERVAL_S {
                    self.lastTrackingUpdateSent = now
                    self.send(.trackingShot(active: true, start: nil, current: fix))
                }
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.locationAuthStatus = status
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didFailWithError error: Error
    ) {
        // Silent — UI surfaces "no GPS fix" via lastLocation == nil rather
        // than nagging the user. Drop a console line for debug builds.
        #if DEBUG
        print("[watch] location error: \(error)")
        #endif
    }
}

// MARK: - Round-mode strike detection (Phase 1 auto-track gating)

/// Round-mode strike detector. Reuses the SAME CoreMotion swing detection as
/// practice (`SwingMotionService` → `SwingDetector`), but forwards ONLY
/// confirmed ball strikes — a real impact spike, never an air/practice swing —
/// to the phone as `roundImpact` events. The phone's `useAutoTrack` uses these
/// to gate GPS shot detection: a "walked then stopped" pattern only counts as
/// a shot when a real strike preceded it, which kills false positives like
/// cart rides and walking to a partner's ball.
///
/// Lifecycle is driven by round-active transitions in
/// `didReceiveApplicationContext`. An `HKWorkoutSession` (via `WorkoutManager`)
/// keeps motion streaming with the wrist down. Mutually exclusive with
/// `PracticeController` — practice owns the motion stream when it's active, so
/// this no-ops then.
@MainActor
final class RoundShotController: ObservableObject {
    static let shared = RoundShotController()

    @Published private(set) var isRunning = false

    private let motion = SwingMotionService()
    private let workout = WorkoutManager()

    /// Monotonic within a round session so the phone can order / de-dupe.
    private var nextImpactId = 1
    /// Refractory window — ignore a second strike within this of the last so a
    /// waggle / re-grip that crosses the impact threshold can't double-count.
    private var lastImpactAt: Date = .distantPast
    private static let refractoryS: TimeInterval = 1.5
    /// Minimum peak impact (g) for a swing to count as a real shot in a ROUND.
    /// A ball strike spikes hard; a practice swing that grazes the turf is much
    /// softer. Just above the detector's own 2.5g impact floor so a soft brush is
    /// filtered but real chips/drives pass. TUNABLE — lower if real shots are
    /// missed, raise if practice swings still slip through. (Was 4.0, which
    /// dropped real strikes on-course; lowered to 3.0 for balance.)
    private static let roundMinImpactG = 3.0

    private init() {
        motion.onSwing = { [weak self] metrics in self?.handleStrike(metrics) }
    }

    func start() {
        guard !isRunning else { return }
        // Practice owns the motion stream when active — don't fight it.
        guard !PracticeController.shared.isActive else { return }
        isRunning = true
        nextImpactId = 1
        lastImpactAt = .distantPast
        motion.start()
        // Keep motion alive wrist-down. No-ops if HealthKit isn't authorized;
        // the standard CMMotionManager path still works while foreground.
        Task { await workout.startSession() }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        motion.stop()
        Task { _ = await workout.stopSession() }
    }

    private func handleStrike(_ m: SwingMetrics) {
        // Air / practice swings (no impact spike) are exactly what we DON'T
        // want to gate on — drop them. Only real strikes pass.
        guard !m.isAirSwing else { return }
        // Stricter than practice: require a firm strike so a practice swing that
        // brushes the turf (a soft spike) doesn't record a phantom shot.
        guard m.peakImpactG >= Self.roundMinImpactG else { return }
        let now = Date()
        guard now.timeIntervalSince(lastImpactAt) >= Self.refractoryS else { return }
        lastImpactAt = now
        let id = nextImpactId
        nextImpactId += 1
        WatchSession.shared.send(.swingImpact(
            impactId: id,
            capturedAt: now.timeIntervalSince1970 * 1000,
            // Forward the FULL motion metrics (migration 031) so the round shot
            // carries the same swing tempo/quality data practice records.
            metrics: m,
            location: WatchSession.shared.lastLocation,
            // Tell the phone which club the watch had in hand so the shot latches
            // the right club even though the phone never saw a watch-side change.
            clubId: WatchSession.shared.lastResolvedClubId
        ))
        // Reflect the swing in the watch's own Shots count right away.
        WatchSession.shared.registerDetectedStrikeShotCount()
    }
}
