import Cocoa

/// Shown while the room is "waiting": Excel is open in the background,
/// unlocked, and no surveillance system is armed yet — mirrors
/// WaitingWindow.xaml on Windows.
final class WaitingWindowController: NSWindowController {
    convenience init(examTitle: String) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 240),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.title = "Locked"
        window.level = .floating
        window.center()
        window.isReleasedWhenClosed = false
        self.init(window: window)
        setupUI(examTitle: examTitle)
    }

    private func setupUI(examTitle: String) {
        guard let window = window, let contentView = window.contentView else { return }
        let content = NSView(frame: contentView.bounds)
        content.autoresizingMask = [.width, .height]

        let titleLabel = NSTextField(labelWithString: "En attente du démarrage")
        titleLabel.font = .boldSystemFont(ofSize: 18)
        titleLabel.alignment = .center

        let examLabel = NSTextField(labelWithString: examTitle)
        examLabel.font = .systemFont(ofSize: 12)
        examLabel.textColor = .secondaryLabelColor
        examLabel.alignment = .center

        let noteLabel = NSTextField(
            wrappingLabelWithString:
                "Excel est ouvert en arrière-plan. L'examen démarrera automatiquement dès que l'intervenant le lancera."
        )
        noteLabel.font = .systemFont(ofSize: 11)
        noteLabel.textColor = .secondaryLabelColor
        noteLabel.alignment = .center

        let stack = NSStackView(views: [titleLabel, examLabel, noteLabel])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 30),
            noteLabel.widthAnchor.constraint(equalToConstant: 360),
        ])

        window.contentView = content
    }
}
