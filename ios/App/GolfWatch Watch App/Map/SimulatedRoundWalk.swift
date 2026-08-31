#if DEBUG
import Foundation
import CoreLocation
import Combine

/// DEBUG-only synthetic GPS, so the map, the yardages and the camera can be
/// exercised without driving to a golf course.
///
/// Entirely compiled out of release builds — the `#if DEBUG` wraps the whole
/// file, so there is no fake-location code, and no control that could reach it,
/// in anything a golfer installs.
///
/// It works by walking the CURRENT HOLE'S OWN GEOMETRY rather than replaying
/// canned coordinates: positions are interpolated along the real tee→green line
/// for whichever hole is on screen. That means the same four stops (tee,
/// fairway, approach, green) test every hole of every course, and the yardages
/// they produce are the yardages that hole would really give.
///
/// Fixes are injected through `WatchSession.debugInjectFix`, i.e. the same
/// buffer Core Location writes to. Nothing downstream — distance, club
/// suggestion, on-green detection, camera framing — can tell the difference,
/// which is the point.
@MainActor
final class SimulatedRoundWalk: ObservableObject {
    static let shared = SimulatedRoundWalk()

    /// Where along the hole the simulated golfer is standing.
    enum Stop: Int, CaseIterable {
        case off = 0
        case tee
        case fairway
        case approach
        case green

        var label: String {
            switch self {
            case .off: return "SIM"
            case .tee: return "TEE"
            case .fairway: return "FWY"
            case .approach: return "APP"
            case .green: return "GRN"
            }
        }

        /// Fraction of the way from the tee to the green.
        var progress: Double {
            switch self {
            case .off: return 0
            case .tee: return 0.02
            case .fairway: return 0.55
            case .approach: return 0.88
            case .green: return 0.99
            }
        }
    }

    @Published private(set) var stop: Stop = .off

    var isActive: Bool { stop != .off }

    /// Advance to the next stop, wrapping back to off after the green.
    func cycle(geometry: HoleMapGeometry?, pin: CLLocationCoordinate2D?) {
        let all = Stop.allCases
        let next = all[(all.firstIndex(of: stop)! + 1) % all.count]
        stop = next
        emit(geometry: geometry, pin: pin)
    }

    func reset() {
        stop = .off
    }

    /// Push the fix for the current stop. Called on each cycle and whenever the
    /// displayed hole changes, so stepping holes re-places the simulated golfer
    /// on the new one instead of leaving them a fairway behind.
    func emit(geometry: HoleMapGeometry?, pin: CLLocationCoordinate2D?) {
        guard stop != .off else { return }
        guard let coord = coordinate(geometry: geometry, pin: pin) else { return }
        // Plausible accuracy: comfortably inside WatchSession's 30 m gate, so
        // the fix is accepted and ranked the way a good real one would be.
        let location = CLLocation(
            coordinate: coord,
            altitude: 0,
            horizontalAccuracy: 5,
            verticalAccuracy: 5,
            course: -1,
            speed: 1.4,
            timestamp: Date()
        )
        WatchSession.shared.debugInjectFix(location)
    }

    private func coordinate(
        geometry: HoleMapGeometry?,
        pin: CLLocationCoordinate2D?
    ) -> CLLocationCoordinate2D? {
        // End of the walk is the pin when the round has one, else the green.
        let end = pin ?? geometry?.greenCenter
        guard let end else { return nil }
        // Start from the tee; without one, back off 300 m from the green along
        // the centerline so there's still a hole to walk down.
        let start = geometry?.tee
            ?? geometry?.centerline.first
            ?? end
        let t = stop.progress
        return CLLocationCoordinate2D(
            latitude: start.latitude + (end.latitude - start.latitude) * t,
            longitude: start.longitude + (end.longitude - start.longitude) * t
        )
    }
}
#endif
