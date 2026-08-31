import Foundation
import CoreLocation

/// Course geometry the watch draws behind the on-course screen.
///
/// Decoded from the JSON file the phone sends once per course (see
/// `buildWatchCourseMap` on the JS side and `sendCourseMap` in
/// `WatchBridgePlugin`). Mirrors that encoder field-for-field — the short keys
/// are deliberate, since this crosses a file transfer and gets re-read on every
/// watch app launch for the rest of the course's life.
///
/// Every coordinate arrives as an explicit `lat` / `lng` pair rather than a
/// GeoJSON `[lng, lat]` array. The database stores GeoJSON order; naming the
/// fields is what stops the conversion to `CLLocationCoordinate2D` silently
/// transposing the course into the Gulf of Guinea.

// MARK: - Wire format

struct WatchMapPoint: Codable, Equatable {
    let lat: Double
    let lng: Double

    /// The coordinate, or nil when the numbers can't describe a place on Earth.
    ///
    /// Rejects `(0, 0)` on purpose: it is a valid coordinate but, 600 km off
    /// West Africa, it is never a golf hole — it is what a dropped or defaulted
    /// value looks like. Letting one through would stretch a hole's bounding
    /// box across an ocean and zoom the camera out to the whole planet.
    var coordinate: CLLocationCoordinate2D? {
        guard lat.isFinite, lng.isFinite else { return nil }
        guard !(lat == 0 && lng == 0) else { return nil }
        let c = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        guard CLLocationCoordinate2DIsValid(c) else { return nil }
        return c
    }
}

struct WatchMapFeature: Codable {
    /// `green` | `fairway` | `tee` | `bunker` | `water` | `water_hazard`
    let t: String
    let line: Bool
    let rings: [[WatchMapPoint]]

    enum CodingKeys: String, CodingKey { case t, line, rings }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        t = try c.decode(String.self, forKey: .t)
        line = (try? c.decode(Bool.self, forKey: .line)) ?? false
        rings = (try? c.decode([[WatchMapPoint]].self, forKey: .rings)) ?? []
    }
}

struct WatchMapHole: Codable {
    let n: Int
    let par: Int?
    let tee: WatchMapPoint?
    /// Green centroid from the course row. NOT the pin — see `pin`.
    let green: WatchMapPoint?
    /// Recorded flag position, when the course has one. Kept separate from
    /// `green` because they mean different things to a golfer and the map
    /// draws them differently.
    let pin: WatchMapPoint?
    let centerline: [WatchMapPoint]
    let features: [WatchMapFeature]

    enum CodingKeys: String, CodingKey { case n, par, tee, green, pin, centerline, features }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        n = try c.decode(Int.self, forKey: .n)
        par = try? c.decode(Int.self, forKey: .par)
        tee = try? c.decode(WatchMapPoint.self, forKey: .tee)
        green = try? c.decode(WatchMapPoint.self, forKey: .green)
        pin = try? c.decode(WatchMapPoint.self, forKey: .pin)
        centerline = (try? c.decode([WatchMapPoint].self, forKey: .centerline)) ?? []
        features = (try? c.decode([WatchMapFeature].self, forKey: .features)) ?? []
    }
}

/// Encodable as well as Decodable: the course now arrives as per-hole
/// messages, so the watch ASSEMBLES this document itself and has to be able to
/// write the result to its cache. Decode-only would mean the on-disk format and
/// the wire format could drift apart silently.
struct WatchCourseMap: Codable {
    let v: Int
    let courseId: String
    let courseName: String?
    let holes: [WatchMapHole]

    /// Wire versions this build understands. A file written by a newer phone is
    /// ignored rather than half-decoded — the golfer keeps the plain background
    /// instead of a map drawn from fields we guessed at.
    static let supportedVersion = 1
}

// MARK: - Resolved, render-ready geometry

/// One drawable ring set, already converted to CoreLocation and ordered for
/// drawing. Built once per hole and cached — MapKit gets handed the same arrays
/// on every frame rather than re-parsing JSON as the golfer walks.
struct HoleMapFeature: Identifiable {
    let id: String
    let type: String
    let isLine: Bool
    let rings: [[CLLocationCoordinate2D]]
}

/// Everything the map needs for one hole, resolved and validated.
struct HoleMapGeometry {
    let holeNumber: Int
    let par: Int?
    let tee: CLLocationCoordinate2D?
    /// Green centroid (course geometry).
    let greenCenter: CLLocationCoordinate2D?
    /// Stored flag position for this hole, if the course has one.
    let storedPin: CLLocationCoordinate2D?
    let centerline: [CLLocationCoordinate2D]
    /// Drawn back-to-front: fairway, then water, then bunkers, then tee, then
    /// green on top — so a bunker cut into a green stays visible.
    let features: [HoleMapFeature]
    /// The largest `green` ring, used for the front / back yardages. Nil when
    /// the course has no green polygon (only a centroid), in which case the
    /// watch shows the centre yardage alone rather than inventing depth.
    let greenRing: [CLLocationCoordinate2D]?

    /// True when there is genuinely nothing to draw. The caller falls back to
    /// the plain background rather than showing an empty map.
    var isEmpty: Bool {
        features.isEmpty && greenCenter == nil && tee == nil
    }

    /// Draw order. Higher wins. Mirrors the phone map's `FEATURE_LAYER_ORDER`
    /// so a hole looks like the same hole on both devices.
    static func z(_ type: String) -> Int {
        switch type {
        case "fairway": return 1
        case "water_hazard", "water": return 2
        case "bunker": return 3
        case "tee": return 4
        case "green": return 5
        default: return 0
        }
    }

    init(hole: WatchMapHole) {
        holeNumber = hole.n
        par = hole.par
        tee = hole.tee?.coordinate
        greenCenter = hole.green?.coordinate
        storedPin = hole.pin?.coordinate
        centerline = hole.centerline.compactMap(\.coordinate)

        var resolved: [HoleMapFeature] = []
        var bestGreenRing: [CLLocationCoordinate2D]?
        for (i, f) in hole.features.enumerated() {
            let rings: [[CLLocationCoordinate2D]] = f.rings
                .map { $0.compactMap(\.coordinate) }
                // A polygon needs three points to enclose anything; a line two.
                .filter { $0.count >= (f.line ? 2 : 3) }
            guard !rings.isEmpty else { continue }
            resolved.append(
                HoleMapFeature(id: "\(hole.n)-\(i)-\(f.t)", type: f.t, isLine: f.line, rings: rings)
            )
            if f.t == "green", !f.line {
                // A green can arrive as several rings (a double green, or an
                // inner hole). The biggest one is the putting surface.
                for ring in rings where ring.count > (bestGreenRing?.count ?? 0) {
                    bestGreenRing = ring
                }
            }
        }
        resolved.sort { HoleMapGeometry.z($0.type) < HoleMapGeometry.z($1.type) }
        features = resolved
        greenRing = bestGreenRing
    }
}

// MARK: - Green depth (front / centre / back)

/// The three yardages a golfer actually plays to.
struct GreenDepth {
    let front: CLLocationCoordinate2D
    let center: CLLocationCoordinate2D
    let back: CLLocationCoordinate2D
}

extension HoleMapGeometry {
    /// Front / centre / back of the green measured ALONG THE LINE OF PLAY from
    /// where the golfer is standing.
    ///
    /// Front and back aren't fixed compass points on a green — they are its
    /// nearest and farthest points from the ball, which is why walking around a
    /// green changes them. So rather than storing them (the database has no such
    /// columns, and any stored pair would be wrong from half the fairway), they
    /// are derived here from the real green polygon: project every vertex onto
    /// the player→centre line and take the extremes.
    ///
    /// Returns nil without a green polygon — the watch then shows the centre
    /// yardage on its own instead of fabricating a depth the data doesn't have.
    func greenDepth(from player: CLLocationCoordinate2D) -> GreenDepth? {
        guard let ring = greenRing, ring.count >= 3 else { return nil }
        // Centroid of the polygon we actually have, not the stored centroid —
        // the two can differ, and front/back must bracket THIS ring.
        let center = GeoMath.centroid(of: ring)
        let bearing = GeoMath.bearing(from: player, to: center)
        var nearest = ring[0]
        var farthest = ring[0]
        var minProj = Double.greatestFiniteMagnitude
        var maxProj = -Double.greatestFiniteMagnitude
        for point in ring {
            // Distance along the line of play, signed from the player.
            let proj = GeoMath.projection(of: point, from: player, alongBearing: bearing)
            if proj < minProj { minProj = proj; nearest = point }
            if proj > maxProj { maxProj = proj; farthest = point }
        }
        return GreenDepth(front: nearest, center: center, back: farthest)
    }
}

// MARK: - Geometry helpers

/// Small-scale geodesy. Golf holes are under 600 m end to end, so an
/// equirectangular projection with cos-latitude scaling is accurate to well
/// under a yard here — and costs a fraction of a haversine per vertex, which
/// matters when this runs over every green polygon on every camera update.
enum GeoMath {
    static let metersPerDegreeLat: Double = 111_320

    static func metersPerDegreeLng(atLatitude lat: Double) -> Double {
        metersPerDegreeLat * cos(lat * .pi / 180)
    }

    static func centroid(of ring: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D {
        guard !ring.isEmpty else { return CLLocationCoordinate2D(latitude: 0, longitude: 0) }
        var lat = 0.0
        var lng = 0.0
        for c in ring {
            lat += c.latitude
            lng += c.longitude
        }
        return CLLocationCoordinate2D(
            latitude: lat / Double(ring.count),
            longitude: lng / Double(ring.count)
        )
    }

    /// Compass bearing (radians, clockwise from north) from `a` to `b`.
    static func bearing(
        from a: CLLocationCoordinate2D,
        to b: CLLocationCoordinate2D
    ) -> Double {
        let mLng = metersPerDegreeLng(atLatitude: a.latitude)
        let east = (b.longitude - a.longitude) * mLng
        let north = (b.latitude - a.latitude) * metersPerDegreeLat
        return atan2(east, north)
    }

    /// How far `point` lies along `bearing` from `origin`, in meters. Negative
    /// when it sits behind the origin.
    static func projection(
        of point: CLLocationCoordinate2D,
        from origin: CLLocationCoordinate2D,
        alongBearing bearing: Double
    ) -> Double {
        let mLng = metersPerDegreeLng(atLatitude: origin.latitude)
        let east = (point.longitude - origin.longitude) * mLng
        let north = (point.latitude - origin.latitude) * metersPerDegreeLat
        return east * sin(bearing) + north * cos(bearing)
    }

    /// Straight-line distance in meters.
    static func distance(
        _ a: CLLocationCoordinate2D,
        _ b: CLLocationCoordinate2D
    ) -> Double {
        let mLng = metersPerDegreeLng(atLatitude: (a.latitude + b.latitude) / 2)
        let east = (b.longitude - a.longitude) * mLng
        let north = (b.latitude - a.latitude) * metersPerDegreeLat
        return (east * east + north * north).squareRoot()
    }

    static func yards(fromMeters m: Double) -> Int {
        Int((m / 0.9144).rounded())
    }
}
