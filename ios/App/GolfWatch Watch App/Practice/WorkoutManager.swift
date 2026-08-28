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
    /// Long-running heart-rate observer (see `startHeartRateStream`). Held so it
    /// can be stopped, and so a second start doesn't stack duplicate queries.
    private var hrStreamQuery: HKAnchoredObjectQuery?
    /// True once HealthKit has actually answered an authorization request in a
    /// context that could present its sheet. Distinct from `isCollecting`: we
    /// can be authorized and still have no workout running.
    private var didRequestAuthorization = false

    private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let hrvType = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
    private let calType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!

    /// Most recent heart-rate reading (bpm) from the LIVE workout builder,
    /// 0 until the first sample.
    @Published private(set) var currentHeartRate: Double = 0

    /// Most recent heart rate HealthKit has on file, from `refreshRecentHeartRate()`.
    /// The watch samples heart rate on its own schedule all day, so this is
    /// usually populated within a couple of minutes even when no workout is
    /// running. 0 when nothing recent exists (or read access was refused).
    @Published private(set) var recentHeartRate: Double = 0

    /// True once `startSession` has a workout actually collecting. False after
    /// a failure — authorization refused, HealthKit unavailable, or the session
    /// refusing to start because the app was in the background. Callers use
    /// this to retry rather than reporting 0 bpm forever.
    @Published private(set) var isCollecting = false

    /// The heart rate to attribute to something happening right now: the live
    /// workout reading when one is flowing, else the most recent stored sample.
    ///
    /// Round mode previously read only the live value, so a round whose workout
    /// session never started (or whose HR read authorization was never granted)
    /// reported 0 for every shot — and 0 is dropped from the wire payload, so
    /// every shot arrived with no heart rate at all.
    var bestHeartRate: Double { currentHeartRate > 0 ? currentHeartRate : recentHeartRate }

    private var heartRates: [Double] = []
    private var hrvValues: [Double] = []

    /// Request authorization + start a golf workout. Safe to call when
    /// HealthKit isn't available or authorized — it just won't collect.
    /// Idempotent: a second call while already collecting is a no-op, so
    /// callers can use it as "make sure this is running".
    @discardableResult
    func startSession() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        if isCollecting, session != nil { return true }

        guard await requestAuthorization() else {
            // Can't collect live, but stored samples may still be readable.
            refreshRecentHeartRate()
            return false
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
            isCollecting = true
            // Seed something usable immediately — the live builder's first
            // sample can be a minute or more away, and a shot hit in that
            // window would otherwise carry no heart rate.
            refreshRecentHeartRate()
            return true
        } catch {
            session = nil
            builder = nil
            isCollecting = false
            refreshRecentHeartRate()
            return false
        }
    }

    /// Ask HealthKit for the permissions this manager needs, independently of
    /// starting a workout.
    ///
    /// Split out because WHERE this is called from decides whether the user
    /// ever sees the permission sheet. Round mode's detector is started from a
    /// `WCSession` application-context delivery, which normally arrives with
    /// the watch app in the BACKGROUND — HealthKit can't present its sheet
    /// there, so authorization silently never happened and every round shot
    /// carried 0 bpm while practice (started by a foreground tap) worked fine.
    /// Callers now also invoke this from a foreground path so the prompt is
    /// actually shown.
    ///
    /// Returns false only when the request itself failed. HealthKit never
    /// reports READ denial — a refused read looks exactly like "no data" — so
    /// a true return is not a promise that samples will arrive.
    @discardableResult
    func requestAuthorization() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        let toShare: Set = [HKQuantityType.workoutType()]
        let toRead: Set<HKObjectType> = [hrType, hrvType, calType]
        do {
            try await healthStore.requestAuthorization(toShare: toShare, read: toRead)
            didRequestAuthorization = true
            return true
        } catch {
            return false
        }
    }

    /// Keep `recentHeartRate` warm for the whole round via a long-running
    /// anchored query rather than a poll.
    ///
    /// The watch samples heart rate on its own all-day schedule, so HealthKit
    /// has data whether or not our workout session ever started. A polling
    /// `Task.sleep` loop can't collect it: with no workout running the app has
    /// no background runtime, gets suspended between strikes, and the timer
    /// simply doesn't fire. An anchored query's update handler is delivered by
    /// HealthKit — with background delivery it wakes us — so the fallback stays
    /// current in exactly the situation the poll was useless in.
    ///
    /// Idempotent: a second call while the stream is live is a no-op.
    func startHeartRateStream() {
        guard HKHealthStore.isHealthDataAvailable(), hrStreamQuery == nil else { return }
        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = {
            [weak self] _, samples, _, _, _ in
            guard let newest = samples?
                .compactMap({ $0 as? HKQuantitySample })
                .max(by: { $0.endDate < $1.endDate }) else { return }
            let bpm = newest.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            guard bpm > 0 else { return }
            Task { @MainActor in self?.recentHeartRate = bpm }
        }
        // Only samples from now on — history would just churn the handler.
        let predicate = HKQuery.predicateForSamples(withStart: Date(), end: nil, options: .strictStartDate)
        let query = HKAnchoredObjectQuery(
            type: hrType,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit,
            resultsHandler: handler
        )
        query.updateHandler = handler
        hrStreamQuery = query
        healthStore.execute(query)
        // Entitled for it (`com.apple.developer.healthkit.background-delivery`)
        // — failure here is non-fatal, the stream still delivers while awake.
        healthStore.enableBackgroundDelivery(for: hrType, frequency: .immediate) { _, _ in }
        // Seed from storage so a strike in the first seconds isn't blank.
        refreshRecentHeartRate()
    }

    /// Tear down the heart-rate stream started by `startHeartRateStream`.
    func stopHeartRateStream() {
        if let q = hrStreamQuery {
            healthStore.stop(q)
            hrStreamQuery = nil
        }
        healthStore.disableBackgroundDelivery(for: hrType) { _, _ in }
    }

    /// Whether authorization has been requested from somewhere that could show
    /// the sheet. Callers use it to avoid re-prompting on every foreground.
    var hasRequestedAuthorization: Bool { didRequestAuthorization }

    /// Read the most recent stored heart-rate sample (last 15 minutes) into
    /// `recentHeartRate`. This is what makes a heart rate available when the
    /// live workout isn't running or hasn't produced a sample yet.
    func refreshRecentHeartRate() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let end = Date()
        let predicate = HKQuery.predicateForSamples(
            withStart: end.addingTimeInterval(-15 * 60), end: end, options: .strictEndDate
        )
        let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(
            sampleType: hrType,
            predicate: predicate,
            limit: 1,
            sortDescriptors: [newestFirst]
        ) { [weak self] _, samples, _ in
            guard let sample = samples?.first as? HKQuantitySample else { return }
            let bpm = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            guard bpm > 0 else { return }
            Task { @MainActor in self?.recentHeartRate = bpm }
        }
        healthStore.execute(query)
    }

    /// Stop the workout and return the collected summary.
    func stopSession() async -> WorkoutSummary {
        isCollecting = false
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
    ) {
        // Mark the session dead so `startSession` will genuinely restart it on
        // the next attempt instead of short-circuiting on `isCollecting` — and
        // so heart rate falls back to stored samples in the meantime.
        Task { @MainActor in
            self.isCollecting = false
            self.session = nil
            self.builder = nil
            self.refreshRecentHeartRate()
        }
    }
}
