import Cocoa

/// Shown when a student joins after the room has already started: the
/// session sits as "pending_approval" server-side until the teacher approves
/// or denies it — see BackendClient's onEntryApproved/onEntryDenied. No
/// surveillance is armed yet, mirrors WaitingWindowController.
final class AirlockWindowController: NSWindowController {
    convenience init(examTitle: String) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 260),
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

        let titleLabel = NSTextField(labelWithString: "En attente d'autorisation")
        titleLabel.font = .boldSystemFont(ofSize: 18)
        titleLabel.alignment = .center

        let examLabel = NSTextField(labelWithString: examTitle)
        examLabel.font = .systemFont(ofSize: 12)
        examLabel.textColor = .secondaryLabelColor
        examLabel.alignment = .center

        let noteLabel = NSTextField(
            wrappingLabelWithString:
                "L'examen a déjà commencé. L'intervenant doit valider votre entrée avant que vous puissiez rejoindre la room — patientez, cette fenêtre se fermera automatiquement dès sa décision."
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
