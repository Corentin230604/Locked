import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var joinWindowController: JoinWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        joinWindowController = JoinWindowController()
        joinWindowController?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
