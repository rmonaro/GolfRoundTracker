import Foundation
import CoreMotion
import simd

/// Streams high-rate wrist motion from CoreMotion and emits a completed
/// `SwingMetrics` for each detected swing. MOTION-BASED — produces relative /
/// estimated signals only, never absolute club or ball geometry.
///
/// V1 uses `CMMotionManager` device-motion at 100 Hz while the practice screen
/// is foreground. V2 can upgrade to `CMBatchedSensorManager` (200 Hz on
/// Series 8+/Ultra) wrapped in an `HKWorkoutSession` for wrist-down / dimmed
/// operation. Requires `NSMotionUsageDescription` in the watch target's
/// Info.plist.
@MainActor
final class SwingMotionService {
    /// Called on the main actor for each completed swing.
    var onSwing: ((SwingMetrics) -> Void)?

    private let motion = CMMotionManager()
    private let batched = CMBatchedSensorManager()
    private var batchedTask: Task<Void, Never>?
    private let detector = SwingDetector()
    private let calc = SwingMetricsCalculator()

    private var buffer: [MotionSample] = []
    private static let sampleHz = 100.0
    /// Keep ~4s of context so a full swing's window is always available. Sized
    /// for the 200 Hz batched path so it always holds a full swing.
    private static let maxBuffer = Int(200.0 * 4)

    private(set) var isRunning = false

    /// Timestamp of the last sample actually delivered. `nil` until the first
    /// one arrives after a (re)start.
    private(set) var lastSampleAt: Date?
    private var watchdogTask: Task<Void, Never>?

    /// How long without a single sample counts as a dead feed.
    ///
    /// At 100-200 Hz a healthy stream delivers continuously, so any real gap is
    /// a stopped stream, not a quiet wrist. Motion does NOT stop because the
    /// golfer is standing still — CoreMotion keeps sampling.
    private static let feedStallS: TimeInterval = 8
    private static let watchdogIntervalS: UInt64 = 5_000_000_000

    func start() {
        guard !isRunning else { return }
        isRunning = true
        buffer.removeAll()
        detector.reset()
        lastSampleAt = nil
        startWatchdog()
        // Prefer the high-rate (200 Hz) batched sensor path on supported
        // watches (Series 8+/Ultra); fall back to the 100 Hz device-motion
        // manager everywhere else.
        if CMBatchedSensorManager.isDeviceMotionSupported {
            startBatched()
        } else {
            startStandard()
        }
    }

    private func startStandard() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / Self.sampleHz
        motion.startDeviceMotionUpdates(to: .main) { [weak self] dm, _ in
            guard let self, let dm else { return }
            self.ingest(dm)
        }
    }

    private func startBatched() {
        batchedTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await batch in self.batched.deviceMotionUpdates() {
                    for dm in batch { self.ingest(dm) }
                }
                // The sequence ENDED without throwing. Nothing here is an error
                // to catch, and nothing restarts it — the app simply stops
                // seeing swings for the rest of the round. The watchdog notices
                // the silence; falling back here means it usually doesn't have
                // to wait that long.
                if self.isRunning { self.startStandard() }
            } catch {
                // Batched streaming needs an active workout + supported HW;
                // if it errors, fall back to the standard manager.
                if self.isRunning { self.startStandard() }
            }
        }
    }

    /// Restart the feed if samples stop arriving.
    ///
    /// The round keeps this service running for hours with the app backgrounded
    /// and the wrist down. Both CoreMotion paths can stop delivering in that
    /// state — the batched sequence can simply end, and device-motion updates do
    /// not always survive the transition — and until now that failed SILENTLY:
    /// `isRunning` stayed true, no error surfaced, and every subsequent swing
    /// was missed with nothing in the UI to suggest anything was wrong.
    ///
    /// Same shape as the GPS feed's `ensureLocationFlowing()` and the workout
    /// session's upkeep loop, for the same reason.
    private func startWatchdog() {
        watchdogTask?.cancel()
        watchdogTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.watchdogIntervalS)
                guard let self, self.isRunning else { return }
                guard let last = self.lastSampleAt else { continue }
                if Date().timeIntervalSince(last) > Self.feedStallS {
                    self.restartFeed()
                }
            }
        }
    }

    /// Tear the CoreMotion feed down and bring it back, keeping `isRunning`
    /// true throughout so callers see no interruption.
    private func restartFeed() {
        batchedTask?.cancel()
        batchedTask = nil
        if CMBatchedSensorManager.isDeviceMotionSupported {
            batched.stopDeviceMotionUpdates()
        }
        motion.stopDeviceMotionUpdates()
        // A restarted stream re-bases its timestamps, so anything buffered is
        // no longer comparable with what comes next. The detector's phase is
        // stale for the same reason.
        buffer.removeAll()
        detector.reset()
        lastSampleAt = nil
        if CMBatchedSensorManager.isDeviceMotionSupported {
            startBatched()
        } else {
            startStandard()
        }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        watchdogTask?.cancel()
        watchdogTask = nil
        lastSampleAt = nil
        batchedTask?.cancel()
        batchedTask = nil
        if CMBatchedSensorManager.isDeviceMotionSupported {
            batched.stopDeviceMotionUpdates()
        }
        motion.stopDeviceMotionUpdates()
        buffer.removeAll()
        detector.reset()
    }

    private func ingest(_ dm: CMDeviceMotion) {
        lastSampleAt = Date()
        let sample = MotionSample(
            t: dm.timestamp,
            userAccel: simd_double3(dm.userAcceleration.x, dm.userAcceleration.y, dm.userAcceleration.z),
            rotationRate: simd_double3(dm.rotationRate.x, dm.rotationRate.y, dm.rotationRate.z),
            gravity: simd_double3(dm.gravity.x, dm.gravity.y, dm.gravity.z)
        )
        buffer.append(sample)
        if buffer.count > Self.maxBuffer {
            buffer.removeFirst(buffer.count - Self.maxBuffer)
        }

        if detector.advance(with: sample) == .finished {
            if let window = detector.takeCompletedWindow(from: buffer) {
                let metrics = calc.compute(window)
                onSwing?(metrics)
            }
            detector.reset()
        }
    }
}
