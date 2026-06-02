import Foundation
import WatchConnectivity
import CoreLocation
import Combine

/// Round-state snapshot received from the phone. Mirrors the JS-side
/// `WatchRoundState` interface in `src/services/watchBridge.ts` — keep the
/// two in sync.
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
    let pinLat: Double?
    let pinLng: Double?
    let bag: [WatchClub]

    static let empty = WatchRoundState(
        active: false,
        courseName: nil, holeNumber: nil, holesPlayed: nil, par: nil,
        distanceYards: nil, distanceFeet: nil, scoreVsPar: nil,
        shotsThisHole: nil, puttsThisHole: nil,
        suggestedClubId: nil, selectedClubId: nil,
        recordingShot: false, pinLat: nil, pinLng: nil, bag: []
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
                    start: CLLocation?, end: CLLocation?)
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

    var payload: [String: Any] {
        switch self {
        case .recordShot(let clubId, let targetType, let targetResult, let start, let end):
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
        guard let loc = lastLocation else { return nil }
        guard let plat = state.pinLat, let plng = state.pinLng else { return nil }
        // Reject ancient fixes (>30s) — phone went out of sight, sat in
        // a bag, etc. A stale fix would lie about your distance.
        if loc.timestamp.timeIntervalSinceNow < -30 { return nil }
        // Reject very inaccurate fixes (>50m). At golf yardages this is
        // worse than just showing the phone-snapshot number.
        if loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > 50 { return nil }
        let pin = CLLocation(latitude: plat, longitude: plng)
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
            // Phone has confirmed an updated state — drop any optimistic
            // local override now that the snapshot reflects reality. If
            // the snapshot still doesn't match (slow round-trip), the
            // override stays — but the next snapshot will clear it.
            if let local = self.localSelectedClubId,
               snapshot.selectedClubId == local {
                self.localSelectedClubId = nil
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
