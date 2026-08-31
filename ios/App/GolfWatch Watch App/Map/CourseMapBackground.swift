import SwiftUI
import MapKit
import CoreLocation

/// Satellite map of the current hole, drawn as the BACKGROUND of the existing
/// on-course screen.
///
/// Responsibilities are split deliberately: this view owns geography and
/// nothing else — imagery, overlays, markers, camera. Every yardage, control
/// and piece of round state stays in `HoleHomeView`, layered on top. Neither
/// knows how the other works.
///
/// It is intentionally NON-INTERACTIVE (`interactionModes: []`). The round
/// screen's buttons, its Digital Crown behaviour and the putt controls all sit
/// directly on top of this, and on a 1.7" screen a map that competes for pans
/// and crown rotation costs the golfer far more than free browsing gains them.
/// The camera framing below is what replaces manual panning, and it is the
/// thing worth getting right.
struct CourseMapBackground: View {
    /// Resolved geometry for the hole being shown. Nil → nothing is drawn and
    /// the caller keeps its plain background.
    let geometry: HoleMapGeometry?
    /// The watch's own best GPS fix. This is `WatchSession.lastLocation` — the
    /// same single feed that drives shot detection and every yardage. The map
    /// deliberately does not open its own location stream.
    let player: CLLocationCoordinate2D?
    /// Where the golfer is playing to: the round's pin when it has one, else
    /// the green centre. Passed in because a flag moved during THIS round beats
    /// the course's stored pin, and only the round screen knows that.
    let target: CLLocationCoordinate2D?
    /// True when `target` is a real recorded flag rather than the green
    /// centroid — the two are drawn differently on purpose.
    let targetIsPin: Bool
    /// Landing positions of this hole's recorded shots, in play order.
    let shots: [CLLocationCoordinate2D]
    /// Ask for aerial photography rather than the standard base map.
    ///
    /// A REQUEST, not a promise. Apple documents that watchOS may render the
    /// Standard style even when Imagery is asked for, and we cannot detect which
    /// one we got — so the overlays below are tuned to stay readable either way
    /// rather than assuming a photograph is underneath.
    let useSatellite: Bool
    /// Always On / wrist-down. Freezes camera work while the screen is dimmed.
    let isDimmed: Bool

    @StateObject private var camera = HoleCameraController()

    var body: some View {
        Map(position: $camera.position, interactionModes: []) {
            holeOverlays
            playingLine
            teeMarker
            shotProgressPath
            shotMarkers
            targetMarker
            playerMarker
        }
        // Imagery when the golfer wants it, standard otherwise.
        //
        // Golf is read off aerial photography, so imagery is the default — but
        // it is genuinely a request: Apple documents that MapKit on watchOS "may
        // render the map using the Standard map style rather than requested
        // Hybrid or Imagery styles", and there is no API to ask which one you
        // actually got. Everything below therefore has to work under both.
        //
        // (This was briefly hard-coded to standard on the strength of imagery
        // tiles failing with `GEOErrorDomain -11` — which turned out to be a
        // simulator refusing EVERY tile type, not a watchOS limitation. Don't
        // conclude anything about style support from a simulator.)
        //
        // Points of interest are excluded from the standard style: business and
        // road labels across a fairway are clutter at this size and help nobody
        // play. `.flat` skips terrain elevation, which the camera never tilts to
        // use.
        .mapStyle(
            useSatellite
                ? .imagery(elevation: .flat)
                : .standard(elevation: .flat, pointsOfInterest: .excludingAll)
        )
        .mapControlVisibility(.hidden)
        // Fill the container explicitly rather than trusting the ZStack to
        // propose a size. `Map` has no intrinsic size, and in a stack whose
        // other child drives the layout it can be handed nothing — which shows
        // up as `CAMetalLayer ignoring invalid setDrawableSize width=0 height=0`
        // and a map that is present in the hierarchy, logs camera updates, and
        // draws nothing at all.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The map is scenery for the controls in front of it; it must never
        // take a tap, a swipe or crown focus away from them.
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { reframe(animated: false) }
        .onChange(of: geometry?.holeNumber) { _, newHole in
            guard let newHole else { return }
            camera.holeChanged(to: newHole)
            reframe(animated: false)
        }
        // Latitude alone is enough of a change signal here: the controller
        // re-checks both axes and applies its own distance threshold, so this
        // only needs to fire on movement, not describe it.
        .onChange(of: player?.latitude) { _, _ in
            if let player {
                MapLog.log(
                    .playerLocation,
                    String(format: "%.5f,%.5f", player.latitude, player.longitude)
                )
            }
            reframe()
        }
        .onChange(of: target?.latitude) { _, _ in reframe() }
        .onChange(of: shots.count) { old, new in
            guard new > old else { return }
            MapLog.log(.shotMarkerAdded, "hole \(geometry?.holeNumber ?? -1): \(new) shot(s) mapped")
        }
    }

    private func reframe(animated: Bool = true) {
        // Always On: the watch is showing a dimmed, low-frame-rate snapshot.
        // Animating the camera there is invisible and costs real power, so the
        // last framing simply stays put until the wrist comes back up.
        guard !isDimmed else { return }
        camera.update(geometry: geometry, player: player, target: target, animated: animated)
    }

    // MARK: - Course overlays

    /// Fairway → water → bunkers → tee → green, back to front (the order
    /// `HoleMapGeometry` already sorted them into).
    ///
    /// These are the hole. There is no aerial photograph underneath to annotate
    /// — watchOS may not render one, and a course with no signal certainly
    /// won't — so the fills carry the picture and the strokes sharpen its
    /// edges.
    @MapContentBuilder
    private var holeOverlays: some MapContent {
        ForEach(geometry?.features ?? []) { feature in
            ForEach(Array(feature.rings.enumerated()), id: \.offset) { _, ring in
                if feature.isLine {
                    MapPolyline(coordinates: ring)
                        .stroke(style(for: feature.type).stroke, lineWidth: 1.5)
                } else {
                    MapPolygon(coordinates: ring)
                        .foregroundStyle(style(for: feature.type).fill)
                        .stroke(style(for: feature.type).stroke, lineWidth: 1.2)
                }
            }
        }
    }

    private struct FeatureStyle {
        let fill: Color
        let stroke: Color
    }

    /// Colours track the phone's `FEATURE_STYLE` so a hole reads the same on
    /// both devices; the OPACITY depends on what is underneath.
    ///
    /// Over imagery the fills are washes — the photograph is the map, and
    /// painting over it would destroy the thing the golfer came to look at, so
    /// the strokes do most of the work of marking edges. Over the standard base
    /// map there is no photograph, so the fills have to BE the hole and are much
    /// more solid. Same hues either way, so a hole is recognisably the same hole.
    ///
    /// Strokes are near-opaque in both: an edge is what tells you where the
    /// green starts, and that matters whichever base map you got.
    private func style(for type: String) -> FeatureStyle {
        // Imagery visible underneath → light wash. Plain base map → solid.
        let fillAlpha: (Double, Double) -> Double = { overImagery, overStandard in
            self.useSatellite ? overImagery : overStandard
        }
        switch type {
        case "green":
            return FeatureStyle(
                fill: Color(red: 0.45, green: 0.78, blue: 0.45)
                    .opacity(fillAlpha(0.30, 0.85)),
                stroke: Color(red: 0.36, green: 0.85, blue: 0.42).opacity(0.95)
            )
        case "fairway":
            return FeatureStyle(
                fill: Color(red: 0.42, green: 0.62, blue: 0.24)
                    .opacity(fillAlpha(0.14, 0.70)),
                stroke: Color(red: 0.55, green: 0.80, blue: 0.30).opacity(0.65)
            )
        case "bunker":
            return FeatureStyle(
                fill: Color(red: 0.96, green: 0.83, blue: 0.35)
                    .opacity(fillAlpha(0.40, 0.90)),
                stroke: Color(red: 0.98, green: 0.66, blue: 0.15).opacity(0.9)
            )
        case "water", "water_hazard":
            return FeatureStyle(
                fill: Color(red: 0.25, green: 0.62, blue: 0.92)
                    .opacity(fillAlpha(0.38, 0.85)),
                stroke: Color(red: 0.01, green: 0.53, blue: 0.82).opacity(0.95)
            )
        case "tee":
            return FeatureStyle(
                fill: Color(red: 0.62, green: 0.80, blue: 0.50)
                    .opacity(fillAlpha(0.28, 0.80)),
                stroke: Color(red: 0.41, green: 0.62, blue: 0.22).opacity(0.8)
            )
        default:
            return FeatureStyle(fill: .white.opacity(0.06), stroke: .clear)
        }
    }

    /// The hole's playing line, tee → green.
    ///
    /// Drawn because our own geometry has to carry the whole map. A sparse
    /// course — hole 1 here resolves to just three features — is a couple of
    /// disconnected shapes without it, and a golfer can't tell which way the
    /// hole runs. The centreline is the one piece of data that says "this is a
    /// hole, and it plays THIS way", and we already have it for every synced
    /// hole.
    ///
    /// Deliberately pale and thin, and visually distinct from the amber dashed
    /// `shotProgressPath`: one is where the hole goes, the other is where the
    /// ball has actually been, and confusing them would misread the round.
    @MapContentBuilder
    private var playingLine: some MapContent {
        if let line = geometry?.centerline, line.count >= 2 {
            MapPolyline(coordinates: line)
                .stroke(.white.opacity(0.38), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
        }
    }

    // MARK: - Shots

    /// Tee/first shot → each landing → the golfer, as a thin dashed line.
    ///
    /// Named for what it is. This is GPS PROGRESSION, not ball flight: the
    /// points are where the ball came to rest, so the line is the route the ball
    /// took around the hole on the ground, and drawing it as a smooth arc would
    /// be a lie about data we don't have. Dashed, so it never reads as a
    /// trajectory.
    @MapContentBuilder
    private var shotProgressPath: some MapContent {
        let path = shotProgressCoordinates
        if path.count >= 2 {
            MapPolyline(coordinates: path)
                .stroke(
                    Color(red: 0.98, green: 0.75, blue: 0.14).opacity(0.85),
                    style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [4, 3])
                )
        }
    }

    private var shotProgressCoordinates: [CLLocationCoordinate2D] {
        var path: [CLLocationCoordinate2D] = []
        // Start at the tee when we have one, so the first shot's line shows
        // where it was played from.
        if let tee = geometry?.tee, !shots.isEmpty { path.append(tee) }
        path.append(contentsOf: shots)
        // Finish at the golfer — the "where I am now" leg of the progression.
        if let player { path.append(player) }
        return path
    }

    /// Small amber dots for previous shots. Deliberately unlabelled: a number
    /// per shot on a 1.7" screen would cover the very hole the golfer is trying
    /// to read, and the shot list already lives on the phone.
    @MapContentBuilder
    private var shotMarkers: some MapContent {
        ForEach(Array(shots.enumerated()), id: \.offset) { _, coord in
            Annotation("", coordinate: coord, anchor: .center) {
                Circle()
                    .fill(Color(red: 0.98, green: 0.75, blue: 0.14))
                    .frame(width: 7, height: 7)
                    .overlay(Circle().stroke(.black.opacity(0.55), lineWidth: 1))
            }
            .annotationTitles(.hidden)
        }
    }

    // MARK: - Pin / green

    /// The flag when the round has a real pin, a hollow ring when all we have is
    /// the green centroid. Keeping them visually distinct matters: "the middle
    /// of the green" and "where the cup is today" are different places, and a
    /// golfer clubbing off the wrong one is short or long by a full club.
    @MapContentBuilder
    private var targetMarker: some MapContent {
        if let target {
            Annotation("", coordinate: target, anchor: targetIsPin ? .bottomLeading : .center) {
                if targetIsPin {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.9), radius: 1.5)
                } else {
                    Circle()
                        .stroke(.white.opacity(0.9), lineWidth: 2)
                        .frame(width: 11, height: 11)
                        .shadow(color: .black.opacity(0.8), radius: 1.5)
                }
            }
            .annotationTitles(.hidden)
        }
    }

    /// Tee marker, for courses whose geometry has a tee POINT but no tee
    /// polygon.
    ///
    /// The overlay set is meant to stand on its own now that the base map may be
    /// plain, and "where the hole starts" is part of reading a hole — without
    /// this, a course with no tee polygon simply had no tee on the map. Skipped
    /// when a tee polygon is already drawn, so it never doubles up.
    @MapContentBuilder
    private var teeMarker: some MapContent {
        if let tee = geometry?.tee,
           !(geometry?.features.contains { $0.type == "tee" } ?? false) {
            Annotation("", coordinate: tee, anchor: .center) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(red: 0.62, green: 0.80, blue: 0.50))
                    .frame(width: 9, height: 9)
                    .overlay(
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(.black.opacity(0.6), lineWidth: 1)
                    )
            }
            .annotationTitles(.hidden)
        }
    }

    // MARK: - Golfer

    /// The golfer's own position — larger than the shot dots, and the only blue
    /// thing on screen, so it reads instantly against green grass and yellow
    /// sand. A white ring keeps it visible over dark water and tree shadow,
    /// which a plain dot disappears into.
    ///
    /// Drawn from our own fix rather than MapKit's `UserAnnotation` so it shows
    /// exactly the position every yardage on this screen was computed from —
    /// two location sources that disagree by a few metres would be worse than
    /// one that is occasionally stale.
    @MapContentBuilder
    private var playerMarker: some MapContent {
        if let player {
            Annotation("", coordinate: player, anchor: .center) {
                ZStack {
                    Circle()
                        .fill(.black.opacity(0.35))
                        .frame(width: 20, height: 20)
                    Circle()
                        .fill(Color(red: 0.16, green: 0.55, blue: 1.0))
                        .frame(width: 12, height: 12)
                    Circle()
                        .stroke(.white, lineWidth: 2)
                        .frame(width: 12, height: 12)
                }
            }
            .annotationTitles(.hidden)
        }
    }
}

/// Top-and-bottom scrims that make white text survive satellite imagery.
///
/// The rule this follows: darken where the TEXT is, never the middle of the
/// screen. A full-screen dim would guarantee readability and destroy the reason
/// the map is there — the golfer has to be able to recognise the hole. The
/// gradients are opaque enough at the very edges to anchor the hole number and
/// the yardages, and fully clear across the band where the fairway and green
/// actually sit.
struct MapReadabilityScrim: View {
    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(
                colors: [.black.opacity(0.75), .black.opacity(0.28), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 54)
            Spacer(minLength: 0)
            LinearGradient(
                colors: [.clear, .black.opacity(0.45), .black.opacity(0.82)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 96)
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}

extension View {
    /// Text shadow for content sitting on satellite imagery.
    ///
    /// Belt and braces with the scrim above: the scrim handles the top and
    /// bottom bands, and this keeps anything in between (the club pill, the
    /// score) legible over a bright bunker without needing its own card. Two
    /// passes — a tight dark halo plus a soft spread — is what survives both
    /// white sand and dark tree line.
    func mapLegibleText() -> some View {
        self
            .shadow(color: .black.opacity(0.85), radius: 1, x: 0, y: 0)
            .shadow(color: .black.opacity(0.55), radius: 3, x: 0, y: 1)
    }
}

extension View {
    /// Apply the map text treatment only when the map is actually behind this
    /// content. Off the map the shadows would be invisible work on every frame,
    /// and the watch has four hours of round to get through.
    @ViewBuilder
    func mapLegibleText(when enabled: Bool) -> some View {
        if enabled { mapLegibleText() } else { self }
    }
}
