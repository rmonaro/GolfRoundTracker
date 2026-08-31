import Foundation

/// DEBUG-only logging for the course map.
///
/// Compiled out entirely in release: a golfer's four-hour round would otherwise
/// generate a log line per GPS fix, and os_log's ring buffer is not free on a
/// watch. The tags are stable strings so a console filter on `MAP_` shows the
/// whole map subsystem and nothing else.
enum MapLog {
    enum Tag: String {
        case currentHole = "MAP_CURRENT_HOLE"
        case playerLocation = "MAP_PLAYER_LOCATION"
        case cameraUpdated = "MAP_CAMERA_UPDATED"
        case courseDataLoaded = "MAP_COURSE_DATA_LOADED"
        case greenLoaded = "MAP_GREEN_LOADED"
        case shotMarkerAdded = "MAP_SHOT_MARKER_ADDED"
        case missingGeometry = "MAP_MISSING_GEOMETRY"
        case locationError = "MAP_LOCATION_ERROR"
    }

    /// Tags that fire on the GPS cadence. Off by default even in DEBUG —
    /// a fix a second drowns out everything else you were trying to read.
    /// Flip to `true` while specifically debugging position handling.
    private nonisolated static let verbosePositionLogging = false

    /// Log a map event from ANY isolation context.
    ///
    /// Explicitly `nonisolated`, which this target requires rather than merely
    /// prefers: it builds with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, so
    /// an unannotated static method is implicitly main-actor isolated. The
    /// callers that most need to log are precisely the ones that can't be —
    /// `CLLocationManagerDelegate` and `WCSessionDelegate` callbacks are
    /// `nonisolated` and arrive on background queues. Logging touches no shared
    /// mutable state, so there is nothing here for an actor to protect, and
    /// hopping to the main actor just to print would be worse than useless.
    nonisolated static func log(_ tag: Tag, _ message: @autoclosure () -> String) {
        #if DEBUG
        if tag == .playerLocation && !verbosePositionLogging { return }
        print("[\(tag.rawValue)] \(message())")
        #endif
    }
}
