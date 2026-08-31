import Foundation
import Combine

/// Owns the watch's copy of the course geometry: receives it from the phone,
/// keeps it on disk, and hands the current hole's render-ready geometry to the
/// map.
///
/// Why the watch stores its own copy at all: a golf course is where cell signal
/// goes to die, and the phone is in a bag for most of a round. Once a course has
/// been received the watch can draw every hole with no phone and no network,
/// for this round and every future round there — which is the whole point.
///
/// Threading: the file arrives on WatchConnectivity's background queue and is
/// read there (the OS deletes the temp file the moment the delegate returns),
/// then handed to the main actor for decoding and publication.
@MainActor
final class CourseMapStore: ObservableObject {
    static let shared = CourseMapStore()

    /// The course currently loaded, if any. Published so the map view redraws
    /// the moment a transfer lands mid-round.
    @Published private(set) var course: WatchCourseMap?
    /// Set when a decode failed, so the UI can stay on the plain background
    /// instead of showing an empty map. Purely diagnostic otherwise.
    @Published private(set) var lastError: String?

    /// Per-hole resolved geometry, built lazily and kept.
    ///
    /// Resolving a hole walks every vertex of every polygon; doing it per frame
    /// as the golfer walks would be the single most expensive thing on screen.
    /// Cleared whenever the loaded course changes.
    private var geometryCache: [Int: HoleMapGeometry] = [:]

    /// Course ids we've already tried (and failed) to load from disk, so a
    /// course the watch has never received doesn't re-hit the filesystem on
    /// every snapshot the phone pushes.
    private var missingOnDisk: Set<String> = []

    private init() {}

    // MARK: - Lookup

    /// Render-ready geometry for a hole, for a SPECIFIC course.
    /// Nil when that course isn't loaded, the hole isn't in it, or the hole has
    /// no usable geometry — every one of which is a normal state (a course that
    /// was never OSM-synced, a 9-hole loop played as 18), not an error.
    ///
    /// `courseId` is required rather than implied. Without it this returned
    /// whatever course happened to be loaded, so a golfer whose second round of
    /// the day was at a different course — and whose new map hadn't arrived yet
    /// — got the PREVIOUS course's hole 7 drawn behind their yardages. A map of
    /// the wrong golf course is far worse than no map: it looks authoritative
    /// and it is entirely fiction.
    func geometry(forHole holeNumber: Int, courseId: String) -> HoleMapGeometry? {
        guard let course, course.courseId == courseId else { return nil }
        if let cached = geometryCache[holeNumber] { return cached }
        guard let hole = course.holes.first(where: { $0.n == holeNumber }) else {
            MapLog.log(.missingGeometry, "hole \(holeNumber) absent from \(course.courseId)")
            return nil
        }
        let resolved = HoleMapGeometry(hole: hole)
        guard !resolved.isEmpty else {
            MapLog.log(.missingGeometry, "hole \(holeNumber) has no drawable geometry")
            return nil
        }
        geometryCache[holeNumber] = resolved
        MapLog.log(
            .greenLoaded,
            "hole \(holeNumber): \(resolved.features.count) features, "
                + "greenRing=\(resolved.greenRing?.count ?? 0) pts"
        )
        return resolved
    }

    /// True when the store already holds this course.
    func isLoaded(courseId: String) -> Bool {
        course?.courseId == courseId
    }

    /// True when this exact hole of this course is already held. Lets the
    /// snapshot path skip re-decoding geometry it already has — the state
    /// channel re-delivers on every yardage change, so without this we'd parse
    /// the same polygons a few hundred times a round.
    func hasHole(_ holeNumber: Int, courseId: String) -> Bool {
        guard let course, course.courseId == courseId else { return false }
        return course.holes.contains { $0.n == holeNumber }
    }

    // MARK: - Loading

    /// Make sure `courseId`'s geometry is loaded, reading it from disk if a
    /// previous round already received it. Cheap and idempotent — safe to call
    /// from every snapshot delivery, which is exactly how the round screen uses
    /// it (the watch app can be launched long after the file arrived).
    func ensureLoaded(courseId: String) {
        guard course?.courseId != courseId else { return }
        guard !missingOnDisk.contains(courseId) else { return }
        guard let data = try? Data(contentsOf: Self.fileURL(for: courseId)) else {
            missingOnDisk.insert(courseId)
            MapLog.log(.missingGeometry, "no cached course map for \(courseId)")
            return
        }
        adopt(data: data, courseId: courseId, source: "disk")
    }

    /// Decode and publish, replacing whatever was loaded.
    private func adopt(data: Data, courseId: String, source: String) {
        do {
            let decoded = try JSONDecoder().decode(WatchCourseMap.self, from: data)
            guard decoded.v == WatchCourseMap.supportedVersion else {
                // A newer phone build wrote a format this watch doesn't know.
                // Refusing beats half-decoding: the golfer keeps the plain
                // background rather than a map drawn from guessed-at fields.
                lastError = "unsupported course map version \(decoded.v)"
                MapLog.log(.missingGeometry, "version \(decoded.v) unsupported")
                return
            }
            course = decoded
            geometryCache.removeAll()
            missingOnDisk.remove(courseId)
            lastError = nil
            MapLog.log(
                .courseDataLoaded,
                "\(decoded.courseName ?? decoded.courseId): \(decoded.holes.count) holes "
                    + "(\(data.count) bytes, from \(source))"
            )
        } catch {
            lastError = error.localizedDescription
            MapLog.log(.missingGeometry, "decode failed (\(source)): \(error)")
        }
    }

    // MARK: - Receiving from the phone

    /// Holes received so far for a course still in flight, keyed by hole number.
    private var incomingHoles: [Int: WatchMapHole] = [:]
    private var incomingCourseId: String?
    private var incomingCourseName: String?
    private var incomingExpected = 0

    /// Absorb one hole of a course arriving as its own `transferUserInfo`.
    ///
    /// The course is sent hole by hole rather than as one document because
    /// `transferFile` did not deliver — reliably so between paired simulators,
    /// and unverifiable on device — while `transferUserInfo` is the queued,
    /// guaranteed, FIFO channel this app already moves every watch→phone shot
    /// over. Per-hole chunks also keep each message small enough that size is
    /// never the question.
    ///
    /// Published INCREMENTALLY, not on completion: messages arrive in order, so
    /// hole 1's map is usable while hole 18 is still in flight — which is the
    /// difference between the map being there on the first tee and arriving
    /// somewhere on the back nine. The assembled document is written to disk
    /// once the last hole lands, so later rounds load it in one read.
    func ingestHole(
        courseId: String,
        courseName: String?,
        version: Int,
        total: Int,
        holeJSON: Data
    ) {
        guard version == WatchCourseMap.supportedVersion else {
            lastError = "unsupported course map version \(version)"
            MapLog.log(.missingGeometry, "hole message version \(version) unsupported")
            return
        }
        guard let hole = try? JSONDecoder().decode(WatchMapHole.self, from: holeJSON) else {
            MapLog.log(.missingGeometry, "hole message decode failed for \(courseId)")
            return
        }
        // A different course means the golfer moved on — start clean rather
        // than blending two courses into one document.
        if incomingCourseId != courseId {
            incomingCourseId = courseId
            incomingHoles.removeAll()
            incomingCourseName = courseName
            // Drop a previously-loaded course too, so nothing can draw the old
            // one's holes while this one assembles.
            if course?.courseId != courseId {
                course = nil
                geometryCache.removeAll()
            }
        }
        incomingExpected = max(incomingExpected, total)
        incomingHoles[hole.n] = hole
        // This hole may already have a resolved entry from an earlier, partial
        // version of the course; drop just that one rather than the whole cache.
        geometryCache.removeValue(forKey: hole.n)

        let assembled = WatchCourseMap(
            v: WatchCourseMap.supportedVersion,
            courseId: courseId,
            courseName: incomingCourseName ?? courseName,
            holes: incomingHoles.values.sorted { $0.n < $1.n }
        )
        course = assembled
        missingOnDisk.remove(courseId)
        lastError = nil
        MapLog.log(
            .courseDataLoaded,
            "hole \(hole.n) received (\(incomingHoles.count)/\(incomingExpected))"
        )

        if incomingHoles.count >= incomingExpected, incomingExpected > 0 {
            if let data = try? JSONEncoder().encode(assembled) {
                persist(data: data, courseId: courseId)
                MapLog.log(
                    .courseDataLoaded,
                    "course \(courseId) complete — cached \(data.count) bytes"
                )
            }
            incomingHoles.removeAll()
            incomingCourseId = nil
            incomingExpected = 0
        }
    }

    private func persist(data: Data, courseId: String) {
        let url = Self.fileURL(for: courseId)
        do {
            try FileManager.default.createDirectory(
                at: Self.directory, withIntermediateDirectories: true
            )
            try data.write(to: url, options: .atomic)
            pruneCache(keeping: courseId)
        } catch {
            // Non-fatal: the in-memory copy below still drives this round's map.
            // Only the "works again next launch with no phone" property is lost.
            MapLog.log(.missingGeometry, "persist failed: \(error.localizedDescription)")
        }
    }

    /// Keep a handful of recent courses and drop the rest.
    ///
    /// A regular golfer plays a small rotation of courses, and each map is on the
    /// order of a hundred kilobytes — but a watch is not the place to accumulate
    /// every course ever visited. Oldest-first by modification date.
    private func pruneCache(keeping courseId: String) {
        let keep = 5
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: Self.directory,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return }
        guard urls.count > keep else { return }
        let dated = urls.map { url -> (URL, Date) in
            let d = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            return (url, d)
        }
        .sorted { $0.1 > $1.1 }

        for (url, _) in dated.dropFirst(keep) {
            guard url.lastPathComponent != "\(courseId).json" else { continue }
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - Paths

    private static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("CourseMaps", isDirectory: true)
    }

    private static func fileURL(for courseId: String) -> URL {
        // Course ids are server-issued UUIDs, but sanitize anyway — a stray
        // slash would silently write outside the directory.
        let safe = courseId.replacingOccurrences(
            of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression
        )
        return directory.appendingPathComponent("\(safe).json")
    }
}
