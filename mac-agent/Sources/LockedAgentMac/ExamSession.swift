import Cocoa

/// Orchestrates one exam session end to end. This first version wires the
/// join/poll/heartbeat plumbing only — fullscreen lockdown, keyboard
/// blocking, focus watching and screenshots land in a follow-up commit
/// (they each need a separate macOS permission grant: Accessibility,
/// Screen Recording, Automation).
final class ExamSession {
    private let baseUrl: String
    private let join: JoinResponse
    private let authToken: String
    private let backend: BackendClient
    private var heartbeatTask: Task<Void, Never>?

    init(baseUrl: String, join: JoinResponse, authToken: String) {
        self.baseUrl = baseUrl
        self.join = join
        self.authToken = authToken
        self.backend = BackendClient(
            baseURL: baseUrl, sessionId: join.sessionId, initialLifecycle: join.lifecycle, authToken: authToken)
    }

    func start() async {
        backend.onExcluded = { [weak self] in self?.handleExcluded() }
        backend.onRoomStarted = { [weak self] in self?.handleRoomStarted() }
        backend.onRoomEnded = { [weak self] in
            Task { await self?.handleRoomEnded() }
        }
        backend.startPolling()

        heartbeatTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                await backend.sendHeartbeat()
            }
        }

        NSLog("Locked: session started (lifecycle=\(join.lifecycle))")
    }

    private func handleRoomStarted() {
        NSLog("Locked: room started — verrouillage complet à venir sur macOS")
    }

    private func handleExcluded() {
        heartbeatTask?.cancel()
        backend.stopPolling()
        NSApp.terminate(nil)
    }

    private func handleRoomEnded() async {
        heartbeatTask?.cancel()
        backend.stopPolling()
        NSApp.terminate(nil)
    }
}
