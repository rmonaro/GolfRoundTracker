import Foundation
import Capacitor
import WatchConnectivity

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
        CAPPluginMethod(name: "sendState", returnType: CAPPluginReturnPromise)
    ]

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

    /// Send the latest round-state snapshot to the watch. Uses
    /// `updateApplicationContext` so only the most recent state is delivered
    /// (Apple coalesces queued contexts).
    @objc func sendState(_ call: CAPPluginCall) {
        guard let state = call.getObject("state") else {
            call.reject("Missing required `state` object")
            return
        }
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated else {
            call.reject("WCSession not activated")
            return
        }
        do {
            try WCSession.default.updateApplicationContext(state)
            call.resolve()
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
