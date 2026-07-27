import Cocoa

/// Small always-on-top floating panel shown during lockdown when the room is
/// flagged as a test room, so a tester isn't locked out of their own Mac
/// with no clean way to leave — mirrors TestExitWindow.xaml on Windows.
final class TestExitWindowController: NSWindowController {
    var onExitRequested: (() -> Void)?

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 240, height: 64),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.level = .floating
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.isReleasedWhenClosed = false
        self.init(window: window)
        setupUI()
        positionTopRight()
    }

    private func positionTopRight() {
        guard let window = window, let screenFrame = NSScreen.main?.frame else { return }
        let x = screenFrame.maxX - window.frame.width - 24
        let y = screenFrame.maxY - window.frame.height - 24
        window.setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func setupUI() {
        guard let window = window else { return }
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 240, height: 64))
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor(calibratedWhite: 0.1, alpha: 0.9).cgColor
        content.layer?.cornerRadius = 12

        let label = NSTextField(labelWithString: "MODE TEST")
        label.font = .boldSystemFont(ofSize: 11)
        label.textColor = .white

        let button = NSButton(title: "Quitter le test", target: self, action: #selector(exitTapped))
        button.bezelStyle = .rounded

        let stack = NSStackView(views: [label, button])
        stack.orientation = .horizontal
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
        ])

        window.contentView = content
    }

    @objc private func exitTapped() {
        onExitRequested?()
    }
}
