import Cocoa

/// Full-screen red countdown shown the moment the student leaves Excel —
/// mirrors OverlayWindow.xaml on Windows.
final class OverlayWindowController: NSWindowController {
    private let countdownLabel = NSTextField(labelWithString: "")
    private var remaining: Int
    private var timer: Timer?
    private let title: String
    private let subtitle: String

    var onCountdownExpired: (() -> Void)?

    init(
        countdownSeconds: Int,
        title: String = "Vous avez quitté Excel",
        subtitle: String = "Revenez immédiatement, sinon vous serez exclu de l'examen"
    ) {
        remaining = countdownSeconds
        self.title = title
        self.subtitle = subtitle
        let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        let window = NSWindow(
            contentRect: screenFrame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.level = .screenSaver
        window.backgroundColor = NSColor(calibratedRed: 0.7, green: 0, blue: 0, alpha: 0.9)
        window.isOpaque = false
        window.isReleasedWhenClosed = false
        super.init(window: window)
        countdownLabel.stringValue = "\(remaining)"
        setupUI()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupUI() {
        guard let window = window, let contentView = window.contentView else { return }
        let content = NSView(frame: contentView.bounds)
        content.autoresizingMask = [.width, .height]

        let titleLabel = NSTextField(wrappingLabelWithString: title)
        titleLabel.font = .boldSystemFont(ofSize: 36)
        titleLabel.textColor = .white
        titleLabel.alignment = .center

        let subtitleLabel = NSTextField(wrappingLabelWithString: subtitle)
        subtitleLabel.font = .systemFont(ofSize: 18)
        subtitleLabel.textColor = .white
        subtitleLabel.alignment = .center

        countdownLabel.font = .boldSystemFont(ofSize: 84)
        countdownLabel.textColor = .white
        countdownLabel.alignment = .center

        let stack = NSStackView(views: [titleLabel, subtitleLabel, countdownLabel])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
        ])

        window.contentView = content
    }

    func startCountdown() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            self.remaining -= 1
            self.countdownLabel.stringValue = "\(max(self.remaining, 0))"
            if self.remaining <= 0 {
                self.timer?.invalidate()
                self.onCountdownExpired?()
            }
        }
    }

    func cancelCountdown() {
        timer?.invalidate()
        window?.close()
    }
}
