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

    func start() {
        guard !isRunning else { return }
        isRunning = true
        buffer.removeAll()
        detector.reset()
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
            } catch {
                // Batched streaming needs an active workout + supported HW;
                // if it errors, fall back to the standard manager.
                self.startStandard()
            }
        }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
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
