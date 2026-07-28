import Cocoa

/// Polls the machine every few seconds for two anti-cheat signals the
/// keyboard blocker and focus watcher can't catch: a second monitor plugged
/// in (could mirror an answer sheet on a screen off to the side) and a known
/// remote-access/AI-assistant application running (could let someone else —
/// human or not — drive the machine, or surface an answer, without ever
/// taking Excel out of focus). The app-name blocklist is a best-effort
/// heuristic, not exhaustive — anything not on this list goes undetected.
/// Mirrors the Windows agent's EnvironmentWatcher.cs.
final class EnvironmentWatcher {
    private static let pollInterval: TimeInterval = 5

    // Matched against each running app's localizedName, case-insensitive,
    // substring match — not a complete list, easily extended in practice.
    private static let forbiddenAppNames = [
        "teamviewer", "anydesk", "chrome remote desktop", "vnc viewer",
        "screens", "aeroadmin", "supremo", "ammyy", "chatgpt", "copilot",
    ]

    private var timer: Timer?
    private var activeReasons: Set<String> = []

    /// (reason, humanMessage) — fired the moment a new violation reason
    /// appears, not re-fired on every poll while it's still present.
    var onViolationDetected: ((String, String) -> Void)?
    /// Fired once a given reason is no longer observed.
    var onViolationCleared: ((String) -> Void)?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    private func poll() {
        var seenThisPoll: Set<String> = []

        if NSScreen.screens.count > 1 {
            seenThisPoll.insert("multi_monitor")
        }

        for app in NSWorkspace.shared.runningApplications {
            guard let name = app.localizedName?.lowercased() else { continue }
            for forbidden in Self.forbiddenAppNames {
                if name.contains(forbidden) {
                    seenThisPoll.insert("forbidden_app:\(app.localizedName ?? forbidden)")
                }
            }
        }

        for reason in seenThisPoll where !activeReasons.contains(reason) {
            activeReasons.insert(reason)
            onViolationDetected?(reason, Self.describe(reason))
        }

        // Snapshot before mutating — removing from a Set while iterating it
        // directly is undefined behavior in Swift.
        for reason in Array(activeReasons) where !seenThisPoll.contains(reason) {
            activeReasons.remove(reason)
            onViolationCleared?(reason)
        }
    }

    private static func describe(_ reason: String) -> String {
        if reason == "multi_monitor" { return "Écran secondaire détecté" }
        if reason.hasPrefix("forbidden_app:") {
            return "Application non autorisée détectée : \(reason.dropFirst("forbidden_app:".count))"
        }
        return reason
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }
}
