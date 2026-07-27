import Cocoa

/// Orchestrates one exam session end to end. While the room is "waiting",
/// Excel is open in the background, unlocked, with no surveillance armed.
/// The moment the teacher starts the room — or immediately, if this student
/// joins after it has already started — every surveillance system arms at
/// once: fullscreen lockdown, focus watcher, keyboard blocker, and periodic
/// screenshots. When the teacher ends the room, everything disarms and the
/// workbook is saved and uploaded automatically. Mirrors the Windows agent's
/// ExamSession.cs structure and method names one-for-one.
final class ExamSession {
    private let baseUrl: String
    private let join: JoinResponse
    private let authToken: String
    private let backend: BackendClient
    private let excel = ExcelController()

    private var focusWatcher: FocusWatcher?
    private var keyboardBlocker: KeyboardBlocker?
    private var screenshotService: ScreenshotService?
    private var overlay: OverlayWindowController?
    private var waitingWindow: WaitingWindowController?
    private var testExitWindow: TestExitWindowController?
    private var heartbeatTask: Task<Void, Never>?
    private var locked = false

    init(baseUrl: String, join: JoinResponse, authToken: String) {
        self.baseUrl = baseUrl
        self.join = join
        self.authToken = authToken
        self.backend = BackendClient(
            baseURL: baseUrl, sessionId: join.sessionId, initialLifecycle: join.lifecycle, authToken: authToken)
    }

    func start() async {
        backend.onExcluded = { [weak self] in
            DispatchQueue.main.async { self?.exclude() }
        }
        backend.onRoomStarted = { [weak self] in
            DispatchQueue.main.async { self?.lockDown() }
        }
        backend.onRoomEnded = { [weak self] in
            Task { await self?.endExam() }
        }
        backend.startPolling()

        var examFilePath: String?
        if join.examFileAvailable, let data = await backend.downloadExamFile() {
            let path = NSTemporaryDirectory() + "locked-exam-\(UUID().uuidString).xlsx"
            FileManager.default.createFile(atPath: path, contents: data)
            examFilePath = path
        }

        excel.launch(filePath: examFilePath)

        heartbeatTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if Task.isCancelled { break }
                await backend.sendHeartbeat()
            }
        }

        if join.lifecycle == "started" {
            lockDown()
        } else {
            let waiting = WaitingWindowController(examTitle: join.config.examTitle)
            waiting.showWindow(nil)
            waitingWindow = waiting
        }
    }

    /// Arms every surveillance system at once: fullscreen, focus watcher,
    /// keyboard blocker, screenshots. Idempotent — a late joiner calls this
    /// from start() directly, everyone else from onRoomStarted, never both.
    private func lockDown() {
        guard !locked else { return }
        locked = true

        waitingWindow?.window?.close()
        waitingWindow = nil

        excel.enterFullscreenLockdown()

        let watcher = FocusWatcher()
        watcher.onFocusLost = { [weak self] in self?.onFocusLost() }
        watcher.onFocusRestored = { [weak self] in self?.onFocusRestored() }
        watcher.install()
        focusWatcher = watcher

        let blocker = KeyboardBlocker()
        blocker.install()
        keyboardBlocker = blocker

        let perMinute = join.config.screenshot.enabled ? join.config.screenshot.perMinute : 0
        let screenshots = ScreenshotService(
            baseUrl: baseUrl, sessionId: join.sessionId, authToken: authToken, perMinute: perMinute)
        screenshots.start()
        screenshotService = screenshots

        if join.isTest {
            let testExit = TestExitWindowController()
            testExit.onExitRequested = { [weak self] in self?.exitTestMode() }
            testExit.showWindow(nil)
            testExitWindow = testExit
        }
    }

    private func onFocusLost() {
        let overlayController = OverlayWindowController(countdownSeconds: join.config.countdownSeconds)
        overlayController.onCountdownExpired = { [weak self] in self?.onCountdownExpired() }
        overlayController.showWindow(nil)
        overlayController.startCountdown()
        overlay = overlayController
        Task { await backend.sendEvent(type: "focus_lost") }
    }

    private func onFocusRestored() {
        overlay?.cancelCountdown()
        overlay = nil
        Task { await backend.sendEvent(type: "focus_returned") }
    }

    private func onCountdownExpired() {
        Task { await backend.sendEvent(type: "excluded", payload: ["reason": "countdown_expired"]) }
        exclude()
    }

    /// Teacher clicked "Terminer l'examen": disarm everything, save the
    /// workbook to a path we control, and upload it.
    private func endExam() async {
        disarm()
        if let bytes = excel.saveAndReadBytes() {
            await backend.uploadSubmission(fileData: bytes, filename: "\(join.config.examTitle).xlsx")
        }
        excel.quit()
        backend.stopPolling()
        NSApp.terminate(nil)
    }

    private func exclude() {
        disarm()
        excel.quit()
        backend.stopPolling()
        // TODO: show a dedicated "vous avez été exclu" screen before quitting,
        // instead of terminating the whole agent outright.
        NSApp.terminate(nil)
    }

    /// Tester clicked "Quitter le test": disarm everything exactly like a
    /// real end-of-exam, but record a distinct event so this never shows up
    /// as a real exclusion on the teacher's dashboard.
    private func exitTestMode() {
        disarm()
        Task { await backend.sendEvent(type: "test_exit") }
        excel.quit()
        backend.stopPolling()
        NSApp.terminate(nil)
    }

    private func disarm() {
        keyboardBlocker?.uninstall()
        focusWatcher?.uninstall()
        screenshotService?.stop()
        heartbeatTask?.cancel()
        overlay?.cancelCountdown()
        waitingWindow?.window?.close()
        testExitWindow?.window?.close()
        testExitWindow = nil
    }
}
