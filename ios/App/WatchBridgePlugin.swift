import Foundation
import Capacitor
import WatchConnectivity
import HealthKit

/// Custom bridge controller — required so the in-app `WatchBridgePlugin`
/// (which lives in the App target rather than a Pod / SPM module) gets
/// registered with Capacitor's plugin registry. Without this the JS side
/// gets `UNIMPLEMENTED` when it calls any WatchBridge method.
///
/// Wired into `Main.storyboard` via customClass + customModule="App".
@objc(BridgeViewController)
public class BridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WatchBridgePlugin())
    }
}

/// Capacitor plugin that bridges the JS side of the iOS app to the paired
/// Apple Watch via WatchConnectivity.
///
/// Phone → Watch:
///   • `sendState(state: object)` — pushes the latest round snapshot using
///     `updateApplicationContext`. Latest-wins, queued by the OS while the
///     watch is asleep. Use for read-only fields the watch displays.
///
/// Watch → Phone:
///   • Messages received via `transferUserInfo` (guaranteed delivery, FIFO)
///     are routed to JS through the `messageFromWatch` listener. The watch
///     uses this for high-value events (record shot, navigate hole) where
///     we cannot tolerate loss.
///   • Live `sendMessage` (only when both apps are foreground + reachable)
///     is also handled and goes through the same listener.
///
/// Reachability:
///   • `isReachable()` reflects WCSession.isReachable (live link). Useful
///     in JS to show a "watch online" indicator.
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isReachable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "launchWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endWatchPractice", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()

    /// Latest snapshot received from JS while the session was still
    /// activating. WCSession.activate() is async — the JS layer can (and
    /// does) fire sendState during the activation window. Latest-wins:
    /// we only need the most recent context to flush once activation
    /// completes, since `updateApplicationContext` itself coalesces.
    private var pendingState: [String: Any]?
    private let queueLock = NSLock()

    /// Activate the WCSession. Idempotent — safe to call from JS on every
    /// app launch. No-ops if WatchConnectivity isn't supported (iPad, etc).
    @objc func activate(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve(["supported": false])
            return
        }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated {
            session.activate()
        }
        call.resolve([
            "supported": true,
            "activationState": session.activationState.rawValue,
            "isPaired": session.isPaired,
            "isWatchAppInstalled": session.isWatchAppInstalled,
            "isReachable": session.isReachable
        ])
    }

    @objc func isReachable(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve(["reachable": false])
            return
        }
        call.resolve(["reachable": WCSession.default.isReachable])
    }

    /// Launch the paired Apple Watch app via HealthKit's `startWatchApp(with:)`
    /// — the only Apple-sanctioned way for an iOS app to launch its watch app.
    /// Used for both starting a round (the watch then shows the round from its
    /// synced state) and starting practice.
    ///
    /// `startPractice` (default false): when true, a `startPractice` command is
    /// queued to the watch so it opens straight into a practice session. Round
    /// launches send NO command, so launching for a round never kicks off
    /// practice. Requires the HealthKit capability on the iOS app. Best-effort:
    /// resolves `launched: false` (never rejects).
    @objc func launchWatch(_ call: CAPPluginCall) {
        let startPractice = call.getBool("startPractice") ?? false

        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["launched": false, "reason": "healthUnavailable"])
            return
        }

        // Queue the practice-start command (guaranteed FIFO delivery) so the
        // watch knows what to do once it wakes. Delivered after the launch.
        if startPractice,
           WCSession.isSupported(),
           WCSession.default.activationState == .activated {
            WCSession.default.transferUserInfo(["watchCommand": "startPractice"])
        }

        let config = HKWorkoutConfiguration()
        config.activityType = .golf
        config.locationType = .outdoor
        // startWatchApp needs share authorization for the workout type. A
        // missing HealthKit capability surfaces here as an entitlement error.
        healthStore.requestAuthorization(toShare: [HKObjectType.workoutType()], read: []) { [weak self] _, authError in
            guard let self else { return }
            if let authError = authError {
                call.resolve(["launched": false, "reason": "auth: \(authError.localizedDescription)"])
                return
            }
            self.healthStore.startWatchApp(with: config) { success, error in
                if success {
                    call.resolve(["launched": true])
                } else {
                    call.resolve([
                        "launched": false,
                        "reason": error?.localizedDescription ?? "startWatchApp returned false"
                    ])
                }
            }
        }
    }

    /// Tell the watch to end its active practice session (phone-initiated end
    /// of a range / practice session). Mirrors the `startPractice` command
    /// path: a `watchCommand` user-info is queued (guaranteed FIFO) so the
    /// watch finalizes its session and sends back `practiceEnded`. Best-effort
    /// — resolves regardless of watch reachability.
    @objc func endWatchPractice(_ call: CAPPluginCall) {
        if WCSession.isSupported(),
           WCSession.default.activationState == .activated {
            WCSession.default.transferUserInfo(["watchCommand": "endPractice"])
        }
        call.resolve(["sent": true])
    }

    /// Send the latest round-state snapshot to the watch. Uses
    /// `updateApplicationContext` so only the most recent state is delivered
    /// (Apple coalesces queued contexts).
    ///
    /// If the session hasn't finished activating yet, the state is stashed
    /// and flushed from `activationDidCompleteWith` instead of rejected.
    /// This keeps the JS side simple — it can fire-and-forget without
    /// worrying about the activation race.
    @objc func sendState(_ call: CAPPluginCall) {
        guard let state = call.getObject("state") else {
            call.reject("Missing required `state` object")
            return
        }
        guard WCSession.isSupported() else {
            // No watch hardware (iPad). Resolve quietly so JS doesn't log.
            call.resolve(["delivered": false, "reason": "unsupported"])
            return
        }
        let session = WCSession.default
        // Make sure activation is in flight if nothing called activate() yet.
        if session.delegate == nil {
            session.delegate = self
        }
        if session.activationState == .notActivated {
            session.activate()
        }
        if session.activationState != .activated {
            queueLock.lock()
            pendingState = state
            queueLock.unlock()
            call.resolve(["delivered": false, "reason": "activating"])
            return
        }
        // No paired watch (common: no watch sim attached, or user has no
        // Apple Watch). Stash the snapshot in case pairing happens later
        // and resolve cleanly — rejecting here would spam the JS console
        // every time the round state changes.
        guard session.isPaired else {
            queueLock.lock()
            pendingState = state
            queueLock.unlock()
            call.resolve(["delivered": false, "reason": "unpaired"])
            return
        }
        // Watch is paired but the companion app isn't installed yet.
        // Same treatment — no error, just hold the latest snapshot.
        guard session.isWatchAppInstalled else {
            queueLock.lock()
            pendingState = state
            queueLock.unlock()
            call.resolve(["delivered": false, "reason": "watchAppNotInstalled"])
            return
        }
        do {
            try session.updateApplicationContext(state)
            call.resolve(["delivered": true])
        } catch {
            call.reject("updateApplicationContext failed: \(error.localizedDescription)")
        }
    }

    // MARK: - WCSessionDelegate

    public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        notifyListeners("activationDidComplete", data: [
            "activationState": activationState.rawValue,
            "error": error?.localizedDescription ?? NSNull()
        ])
        // Flush any state that JS pushed while activation was still in
        // flight. Latest-wins: only the most recent pending snapshot is
        // applied, matching updateApplicationContext's own coalescing.
        if activationState == .activated {
            queueLock.lock()
            let toFlush = pendingState
            pendingState = nil
            queueLock.unlock()
            if let pending = toFlush {
                do {
                    try session.updateApplicationContext(pending)
                } catch {
                    // Surface to JS via the activation event so the user
                    // can see what went wrong in the console.
                    notifyListeners("activationDidComplete", data: [
                        "activationState": activationState.rawValue,
                        "error": "pending flush failed: \(error.localizedDescription)"
                    ])
                }
            }
        }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {
        notifyListeners("sessionStateChanged", data: ["state": "inactive"])
    }

    public func sessionDidDeactivate(_ session: WCSession) {
        // Required when the iPhone is paired with a different watch. Re-
        // activate so we're ready for the next session.
        WCSession.default.activate()
        notifyListeners("sessionStateChanged", data: ["state": "deactivated"])
    }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        notifyListeners("reachabilityChanged", data: ["reachable": session.isReachable])
    }

    // Watch → phone: live message (both apps foreground + reachable).
    public func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        notifyListeners("messageFromWatch", data: ["message": message, "delivery": "live"])
    }

    // Watch → phone: queued user-info (guaranteed delivery, FIFO).
    public func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        notifyListeners("messageFromWatch", data: ["message": userInfo, "delivery": "queued"])
    }
}
