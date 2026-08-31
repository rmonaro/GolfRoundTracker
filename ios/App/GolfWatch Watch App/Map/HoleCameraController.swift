import Foundation
import Combine
import CoreLocation
import MapKit
import SwiftUI

/// Decides what part of the hole the map shows, and — just as importantly —
/// when NOT to move.
///
/// The framing rule is a single idea rather than a set of hard-coded "tee /
/// fairway / green" modes: **always frame the golfer together with the target
/// they are playing to.** That one rule produces every behaviour we want, for
/// free and without mode-switch popping:
///
///   • On the tee, the golfer and the green are 400 yards apart, so the camera
///     covers most of the hole.
///   • Down the fairway the span shrinks with every stride, so the view closes
///     in on the approach.
///   • Around the green the span is small, so the camera is already tight.
///   • On the green the green polygon itself sets a floor on the span, so it
///     fills the screen instead of zooming to a five-metre box.
///
/// The other half of this type's job is battery. A watch GPS delivers a fix a
/// second for four hours; re-framing on each one would animate the map
/// continuously, keep MapKit tessellating, and never let the screen settle.
/// Updates are therefore gated on the golfer having actually gone somewhere.
@MainActor
final class HoleCameraController: ObservableObject {
    /// Bound straight into `Map(position:)`.
    @Published var position: MapCameraPosition = .automatic

    // MARK: - Tuning

    /// How far the golfer must move before the camera is allowed to re-frame.
    ///
    /// Chosen against the watch's own GPS behaviour rather than picked round:
    /// fixes are accepted up to 30 m of horizontal accuracy
    /// (`WatchSession.MAX_ACCURACY_M`), so a golfer standing perfectly still
    /// produces a position that wanders by 10–20 m. A threshold under that
    /// would have the map drifting while they address the ball. 25 m is
    /// comfortably outside the noise and about ten paces — far enough that a
    /// re-frame reads as "I've walked on", not as a twitch.
    private static let recenterDistanceM: Double = 25

    /// Minimum gap between camera moves. Even walking briskly, re-framing more
    /// often than this just animates over the previous animation.
    private static let minIntervalS: TimeInterval = 3

    /// Re-frame when the required span changes by more than this fraction, even
    /// if the golfer hasn't crossed the distance threshold — this is what keeps
    /// the green filling the screen as they close the last few yards.
    private static let spanChangeFraction: Double = 0.25

    /// Rotate only when the line of play has genuinely swung this far.
    ///
    /// The map is oriented to the direction of play, so heading is derived from
    /// a GPS position — and GPS jitter would otherwise rock the whole hole back
    /// and forth by a couple of degrees while the golfer stands still. 12° is
    /// well outside that noise but still tracks a dogleg as it's rounded.
    private static let headingChangeDeg: Double = 12

    /// Ground span (meters) → `MapCamera` distance.
    ///
    /// MapKit expresses zoom as the distance from the CAMERA to the centre
    /// point, which is not the same thing as the ground extent you end up
    /// seeing: at pitch 0 the visible extent is roughly half the distance,
    /// because it falls out of the field of view. Treating them as equal (the
    /// first attempt at this) zoomed in about 2× too far and cut the hole off
    /// the screen.
    ///
    /// Deliberately biased toward showing MORE than the computed span. Framing
    /// a little wide costs a slightly smaller green; framing tight loses the
    /// flag off the top of the screen, which is the one thing the golfer opened
    /// the map to see. TUNABLE — this is the dial for overall zoom.
    private static let cameraDistanceFactor: Double = 2.0

    /// Never zoom tighter than this. On the green the extremes of the polygon
    /// can be 25 m apart; without a floor the camera would sit so close that
    /// the imagery has nothing left to resolve and the golfer loses all sense
    /// of where they are.
    private static let minSpanM: Double = 70

    /// Never frame more than this. A 600-yard par 5 seen whole on a 1.7"
    /// display is a green smudge — past this we prefer showing the golfer and
    /// the ground in front of them.
    private static let maxSpanM: Double = 460

    /// Breathing room around the framed points, so the golfer's dot and the
    /// flag aren't pinned to the screen edge under the UI overlay.
    private static let paddingFactor: Double = 1.45

    /// How far from the hole a fix can be and still count as "the golfer is
    /// playing this hole".
    ///
    /// Framing blindly on whatever position we hold is how the map ended up
    /// centred on Kansas: the watch reported a fix in San Francisco while the
    /// course was in New York, so the bounding box spanned the continent, the
    /// span clamped to its 460 m maximum, and the camera settled on the midpoint
    /// — 4,000 km from the hole and showing nothing at all.
    ///
    /// That is not a simulator curiosity. A watch that hasn't got its first lock
    /// yet, or is handing back a last-known fix from the golfer's house, does
    /// exactly the same thing on a real course. 1400 m is roughly twice the
    /// longest hole ever built, so anything beyond it is not a position on this
    /// hole — it is a position from somewhere else, and framing on it destroys
    /// the view instead of degrading it.
    private static let maxPlayerDistanceM: Double = 1400

    // MARK: - State

    private var lastFramedFrom: CLLocationCoordinate2D?
    private var lastFramedSpanM: Double = 0
    private var lastFramedHeading: Double = 0
    private var lastFramedHole: Int?
    private var lastUpdateAt: Date = .distantPast

    /// Re-frame for a new hole on the next update regardless of thresholds.
    /// Called when the round (or the watch's local preview) moves hole.
    func holeChanged(to holeNumber: Int) {
        guard lastFramedHole != holeNumber else { return }
        lastFramedHole = holeNumber
        lastFramedFrom = nil
        lastFramedSpanM = 0
        lastFramedHeading = 0
        lastUpdateAt = .distantPast
        MapLog.log(.currentHole, "camera reset for hole \(holeNumber)")
    }

    /// Recompute the framing if anything has changed enough to be worth it.
    ///
    /// - Parameters:
    ///   - geometry: the current hole, or nil (nothing to frame).
    ///   - player: the watch's own best fix, or nil before the first one.
    ///   - target: where they're playing to — the pin when the round has one,
    ///     else the green centre. Passed in rather than read off `geometry`
    ///     because a flag moved during THIS round beats the stored course pin.
    ///   - animated: false for the first frame of a hole, so it appears already
    ///     correct instead of flying in from the previous hole.
    func update(
        geometry: HoleMapGeometry?,
        player: CLLocationCoordinate2D?,
        target: CLLocationCoordinate2D?,
        animated: Bool = true
    ) {
        guard let frame = Self.desiredFrame(geometry: geometry, player: player, target: target)
        else { return }

        let now = Date()
        let isFirstFrame = lastFramedFrom == nil
        if !isFirstFrame {
            guard now.timeIntervalSince(lastUpdateAt) >= Self.minIntervalS else { return }
            let moved = lastFramedFrom.map { GeoMath.distance($0, frame.center) } ?? .infinity
            let spanDelta = abs(frame.spanM - lastFramedSpanM)
                / max(lastFramedSpanM, 1)
            let turned = Self.angleDelta(frame.headingDeg, lastFramedHeading)
            guard moved >= Self.recenterDistanceM
                    || spanDelta >= Self.spanChangeFraction
                    || turned >= Self.headingChangeDeg
            else { return }
        }

        lastFramedFrom = frame.center
        lastFramedSpanM = frame.spanM
        lastFramedHeading = frame.headingDeg
        lastUpdateAt = now

        // A rotated camera, not a region: `MKCoordinateRegion` is always
        // north-up and cannot express the direction of play.
        let camera = MapCamera(
            centerCoordinate: frame.center,
            distance: frame.spanM * Self.cameraDistanceFactor,
            heading: frame.headingDeg,
            pitch: 0
        )
        // The first frame of a hole snaps; later ones ease, so walking up the
        // fairway feels like the map keeping pace rather than jumping.
        if animated && !isFirstFrame {
            withAnimation(.easeInOut(duration: 0.9)) { position = .camera(camera) }
        } else {
            position = .camera(camera)
        }
        MapLog.log(
            .cameraUpdated,
            "player=\(Self.fmt(player)) target=\(Self.fmt(target))"
                + " green=\(Self.fmt(geometry?.greenCenter))"
                + " tee=\(Self.fmt(geometry?.tee))"
                + " ring[0]=\(Self.fmt(geometry?.greenRing?.first))"
                + String(
                    format: " → center=%.5f,%.5f span=%.0fm heading=%.0f°",
                    frame.center.latitude, frame.center.longitude,
                    frame.spanM, frame.headingDeg
                )
        )
    }

    // MARK: - Framing

    struct Frame {
        let center: CLLocationCoordinate2D
        let spanM: Double
        /// Compass degrees to point UP the screen — the direction of play.
        let headingDeg: Double
    }

    /// Smallest angle between two compass headings, in degrees (0…180).
    static func angleDelta(_ a: Double, _ b: Double) -> Double {
        let d = abs(a - b).truncatingRemainder(dividingBy: 360)
        return d > 180 ? 360 - d : d
    }

    /// Pure framing maths — no state, so it can be reasoned about (and
    /// exercised from the debug walk) on its own.
    static func desiredFrame(
        geometry: HoleMapGeometry?,
        player: CLLocationCoordinate2D?,
        target: CLLocationCoordinate2D?
    ) -> Frame? {
        // Where the hole is, for judging whether the fix belongs to it.
        let holeAnchor = target ?? geometry?.greenCenter ?? geometry?.tee

        // Only frame on the golfer when they are plausibly ON this hole.
        let usablePlayer: CLLocationCoordinate2D? = {
            guard let player else { return nil }
            guard let holeAnchor else { return player }
            let away = GeoMath.distance(player, holeAnchor)
            guard away > maxPlayerDistanceM else { return player }
            // Tagged as a LOCATION event, not missing geometry: the hole's
            // geometry is fine, it is the fix that doesn't belong to it.
            MapLog.log(
                .locationError,
                String(format: "player %.0fm from hole — framing the hole instead", away)
            )
            return nil
        }()

        // Points that must be on screen. The green ring is included so the whole
        // putting surface stays visible on an approach, not just its centre.
        var points: [CLLocationCoordinate2D] = []
        if let usablePlayer { points.append(usablePlayer) }
        if let target { points.append(target) }
        if let ring = geometry?.greenRing {
            // A green is small; a handful of extremes frames it as well as all
            // 200 vertices would, at a fraction of the cost per update.
            points.append(contentsOf: extremes(of: ring))
        } else if let center = geometry?.greenCenter {
            points.append(center)
        }
        // With no usable fix, show the whole hole tee→green. That is the most
        // useful "we don't know where you are" view — and far better than
        // zooming to the green alone, which tells a golfer nothing about where
        // they are playing from.
        if usablePlayer == nil, let tee = geometry?.tee {
            points.append(tee)
        }
        if points.isEmpty {
            if let green = geometry?.greenCenter { points.append(green) }
        }
        // With only the tee known (no fix, no green), there is nothing to frame
        // BETWEEN — show the tee at a sensible default scale.
        // Which way is "up": the direction the hole is played.
        //
        // A golfer reads a hole from where they stand toward the flag, so the
        // map is rotated to match rather than left north-up — the tee ends up at
        // the bottom of the screen and the green at the top, which is how every
        // yardage book and course guide is drawn.
        //
        // Anchored on the TEE when there's no usable fix, and on the golfer once
        // there is, so the view follows their actual line of play round a dogleg
        // instead of staying fixed to the hole's overall axis. `headingChangeDeg`
        // is what stops that rotating on GPS noise.
        let headingFrom = usablePlayer ?? geometry?.tee
        let headingTo = target ?? geometry?.greenCenter
        let headingDeg: Double = {
            guard let headingFrom, let headingTo else { return 0 }
            // Two points at the same spot have no bearing; north-up is the
            // honest answer rather than an arbitrary rotation.
            guard GeoMath.distance(headingFrom, headingTo) > 1 else { return 0 }
            let radians = GeoMath.bearing(from: headingFrom, to: headingTo)
            let degrees = radians * 180 / .pi
            return degrees < 0 ? degrees + 360 : degrees
        }()

        guard let first = points.first else { return nil }
        guard points.count > 1 else {
            return Frame(center: first, spanM: minSpanM * 2, headingDeg: headingDeg)
        }

        var minLat = first.latitude, maxLat = first.latitude
        var minLng = first.longitude, maxLng = first.longitude
        for p in points {
            minLat = min(minLat, p.latitude)
            maxLat = max(maxLat, p.latitude)
            minLng = min(minLng, p.longitude)
            maxLng = max(maxLng, p.longitude)
        }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2
        )
        let heightM = (maxLat - minLat) * GeoMath.metersPerDegreeLat
        let widthM = (maxLng - minLng) * GeoMath.metersPerDegreeLng(atLatitude: center.latitude)
        // One square span for both axes: the watch screen is nearly square, and
        // a single number keeps the "has this changed enough to re-frame?" test
        // to one comparison.
        let span = max(heightM, widthM) * paddingFactor
        return Frame(
            center: center,
            spanM: min(maxSpanM, max(minSpanM, span)),
            headingDeg: headingDeg
        )
    }

    /// Compact coordinate for logging; "nil" when absent. Six decimals is
    /// ~11 cm, enough to spot a transposed or defaulted pair at a glance.
    private static func fmt(_ c: CLLocationCoordinate2D?) -> String {
        guard let c else { return "nil" }
        return String(format: "%.6f,%.6f", c.latitude, c.longitude)
    }

    /// The four compass extremes of a ring — enough to bound it exactly.
    private static func extremes(of ring: [CLLocationCoordinate2D]) -> [CLLocationCoordinate2D] {
        guard var north = ring.first else { return [] }
        var south = north, east = north, west = north
        for c in ring {
            if c.latitude > north.latitude { north = c }
            if c.latitude < south.latitude { south = c }
            if c.longitude > east.longitude { east = c }
            if c.longitude < west.longitude { west = c }
        }
        return [north, south, east, west]
    }
}
