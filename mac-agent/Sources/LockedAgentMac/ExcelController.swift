import Cocoa

/// Drives the locally installed Excel via AppleScript — there's no COM
/// equivalent on macOS, so Apple Events (through System Events for the
/// fullscreen toggle) is the native automation mechanism instead. The first
/// run prompts the student for Automation permission ("Locked wants to
/// control Microsoft Excel" / "...control System Events").
final class ExcelController {
    func launch(filePath: String?) {
        let script: String
        if let filePath = filePath {
            script = """
                tell application "Microsoft Excel"
                    activate
                    open POSIX file "\(filePath)"
                end tell
                """
        } else {
            script = """
                tell application "Microsoft Excel"
                    activate
                    make new workbook
                end tell
                """
        }
        runAppleScript(script)
    }

    /// Called when the teacher starts the room: snaps this student's Excel
    /// to native fullscreen via the Accessibility bridge in System Events.
    func enterFullscreenLockdown() {
        let script = """
            tell application "Microsoft Excel" to activate
            delay 0.3
            tell application "System Events"
                tell process "Microsoft Excel"
                    set value of attribute "AXFullScreen" of window 1 to true
                end tell
            end tell
            """
        runAppleScript(script)
    }

    /// Saves to a path we control (so we know exactly which file to read
    /// back and upload) and returns its bytes. Called when the teacher ends
    /// the exam.
    func saveAndReadBytes() -> Data? {
        let tempPath = NSTemporaryDirectory() + "locked-submission-\(UUID().uuidString).xlsx"
        let script = """
            tell application "Microsoft Excel"
                save active workbook in POSIX file "\(tempPath)" as Excel XML file
            end tell
            """
        runAppleScript(script)
        return FileManager.default.contents(atPath: tempPath)
    }

    func quit() {
        runAppleScript("tell application \"Microsoft Excel\" to quit saving no")
    }

    @discardableResult
    private func runAppleScript(_ source: String) -> Bool {
        guard let script = NSAppleScript(source: source) else { return false }
        var error: NSDictionary?
        script.executeAndReturnError(&error)
        if let error = error {
            NSLog("Locked: AppleScript error: \(error)")
            return false
        }
        return true
    }
}
