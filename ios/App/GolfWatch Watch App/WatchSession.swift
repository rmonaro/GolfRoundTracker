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
    let bag: [WatchClub]

    static let empty = WatchRoundState(
        active: false,
        courseName: nil, holeNumber: nil, holesPlayed: nil, par: nil,
        distanceYards: nil, distanceFeet: nil, scoreVsPar: nil,
        shotsThisHole: nil, puttsThisHole: nil,
        suggestedClubId: nil, selectedClubId: nil,
        recordingShot: false, bag: []
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

    private let locationManager = CLLocationManager()
    /// Latched start-position for the current "in-progress" shot. Captured
    /// when the user taps "Start Shot" on the recording flow; the end
    /// position is captured at submit time.
    private(set) var pendingShotStart: CLLocation?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationAuthStatus = locationManager.authorizationStatus
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

    // MARK: - Outbound

    /// Send a message back to the phone. Uses `transferUserInfo` for
    /// guaranteed delivery (queued, FIFO) — vital for `recordShot` which
    /// can't be silently dropped.
    func send(_ message: WatchOutboundMessage) {
        guard WCSession.default.activationState == .activated else { return }
        WCSession.default.transferUserInfo(message.payload)
    }

    // MARK: - GPS

    func requestLocationPermission() {
        locationManager.requestWhenInUseAuthorization()
    }

    /// Capture a single high-accuracy GPS fix and stash it as the pending
    /// shot start. Caller should pair this with `captureEndAndSend(...)`.
    func captureShotStart() {
        pendingShotStart = lastLocation
        locationManager.startUpdatingLocation()
    }

    /// Stop GPS updates and emit a `recordShot` with the current location as
    /// the end. Clears the pending start so the next shot starts fresh.
    func captureEndAndSend(clubId: String?, targetType: String, targetResult: String) {
        locationManager.stopUpdatingLocation()
        let end = lastLocation
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
        Task { @MainActor in
            self.lastLocation = fix
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
