import Cocoa

/// Watches OS-level app activation changes and reports whether Excel is
/// still the frontmost app. This is what detects "the student switched
/// away", independently of whatever the keyboard blocker manages to stop —
/// mirrors the Windows agent's FocusWatcher.cs (SetWinEventHook there,
/// NSWorkspace notifications here).
final class FocusWatcher {
    private let excelBundleIdentifier = "com.microsoft.Excel"
    private var isOnExcel = true
    private var observer: NSObjectProtocol?

    var onFocusLost: (() -> Void)?
    var onFocusRestored: (() -> Void)?

    func install() {
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self else { return }
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
                return
            }
            let onExcel = app.bundleIdentifier == self.excelBundleIdentifier
            if onExcel == self.isOnExcel { return }
            self.isOnExcel = onExcel
            if onExcel {
                self.onFocusRestored?()
            } else {
                self.onFocusLost?()
            }
        }
    }

    func uninstall() {
        if let observer = observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observer = nil
    }
}
