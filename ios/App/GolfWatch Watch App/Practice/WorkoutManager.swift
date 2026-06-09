import Foundation
import HealthKit
import Combine

/// Compact health summary collected over a practice session.
struct WorkoutSummary {
    let avgHeartRate: Double
    let maxHeartRate: Double
    let minHeartRate: Double
    let hrvSdnn: Double          // milliseconds (often absent during activity)
    let activeCalories: Double   // kcal
    let durationSeconds: Int

    static let empty = WorkoutSummary(
        avgHeartRate: 0, maxHeartRate: 0, minHeartRate: 0,
        hrvSdnn: 0, activeCalories: 0, durationSeconds: 0
    )

    /// True when we actually captured heart-rate data (HealthKit authorized
    /// and a workout ran). Drives whether the phone shows HR stats.
    var hasData: Bool { avgHeartRate > 0 }
}

/// Wraps an `HKWorkoutSession` + `HKLiveWorkoutBuilder` so practice mode can
/// surface heart rate (and, when available, HRV / calories). Requires the
/// HealthKit capability on the watch + iOS targets and the "Workout
/// processing" background mode on the watch target — without those this
/// no-ops cleanly and the rest of practice still works.
@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let hrvType = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
    private let calType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!

    /// Most recent heart-rate reading (bpm), 0 until the first sample.
    @Published private(set) var currentHeartRate: Double = 0

    private var heartRates: [Double] = []
    private var hrvValues: [Double] = []

    /// Request authorization + start a golf workout. Safe to call when
    /// HealthKit isn't available or authorized — it just won't collect.
    func startSession() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        let toShare: Set = [HKQuantityType.workoutType()]
        let toRead: Set<HKObjectType> = [hrType, hrvType, calType]
        do {
            try await healthStore.requestAuthorization(toShare: toShare, read: toRead)
        } catch {
            return
        }

        let config = HKWorkoutConfiguration()
        config.activityType = .golf
        config.locationType = .outdoor
        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore, workoutConfiguration: config
            )
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder

            heartRates.removeAll()
            hrvValues.removeAll()
            currentHeartRate = 0

            let start = Date()
            session.startActivity(with: start)
            builder.beginCollection(withStart: start) { _, _ in }
        } catch {
            session = nil
            builder = nil
        }
    }

    /// Stop the workout and return the collected summary.
    func stopSession() async -> WorkoutSummary {
        guard let session, let builder else { return .empty }
        session.end()
        let end = Date()

        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            builder.endCollection(withEnd: end) { _, _ in cont.resume() }
        }
        let workout: HKWorkout? = await withCheckedContinuation { cont in
            builder.finishWorkout { wk, _ in cont.resume(returning: wk) }
        }

        let summary = WorkoutSummary(
            avgHeartRate: average(heartRates),
            maxHeartRate: heartRates.max() ?? 0,
            minHeartRate: heartRates.min() ?? 0,
            hrvSdnn: average(hrvValues),
            activeCalories: workout?.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0,
            durationSeconds: Int(workout?.duration ?? 0)
        )

        self.session = nil
        self.builder = nil
        return summary
    }

    private func average(_ xs: [Double]) -> Double {
        xs.isEmpty ? 0 : xs.reduce(0, +) / Double(xs.count)
    }

    private func ingest(_ builder: HKLiveWorkoutBuilder, _ types: Set<HKSampleType>) {
        for type in types {
            guard let q = type as? HKQuantityType, let stats = builder.statistics(for: q) else { continue }
            if q == hrType {
                let unit = HKUnit.count().unitDivided(by: .minute())
                if let v = stats.mostRecentQuantity()?.doubleValue(for: unit), v > 0 {
                    currentHeartRate = v
                    heartRates.append(v)
                    if heartRates.count > 2000 { heartRates.removeFirst(heartRates.count - 2000) }
                }
            } else if q == hrvType {
                let unit = HKUnit.secondUnit(with: .milli)
                if let v = stats.mostRecentQuantity()?.doubleValue(for: unit), v > 0 {
                    hrvValues.append(v)
                }
            }
        }
    }
}

// MARK: - Delegates

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        Task { @MainActor in
            self.ingest(workoutBuilder, collectedTypes)
        }
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {}

    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didFailWithError error: Error
    ) {}
}
