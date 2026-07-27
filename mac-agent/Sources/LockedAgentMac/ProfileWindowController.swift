import Cocoa

final class ProfileWindowController: NSWindowController {
    private let baseUrl: String
    private let authToken: String
    private let email: String

    private let schoolLabel = NSTextField(labelWithString: "—")
    private let classLabel = NSTextField(labelWithString: "—")
    private let statusValueLabel = NSTextField(labelWithString: "—")

    init(baseUrl: String, authToken: String, email: String) {
        self.baseUrl = baseUrl
        self.authToken = authToken
        self.email = email
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 280),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Locked — Profil"
        window.center()
        super.init(window: window)
        setupUI()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func fieldLabel(_ text: String) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.font = .systemFont(ofSize: 11)
        l.textColor = .secondaryLabelColor
        return l
    }

    private func setupUI() {
        guard let window = window, let contentView = window.contentView else { return }
        let content = NSView(frame: contentView.bounds)
        content.autoresizingMask = [.width, .height]

        let emailValueLabel = NSTextField(labelWithString: email)
        let closeButton = NSButton(title: "Fermer", target: self, action: #selector(closeTapped))
        closeButton.bezelStyle = .rounded

        let noteLabel = NSTextField(
            wrappingLabelWithString: "Pour changer de classe, contacte l'administrateur de ton établissement.")
        noteLabel.font = .systemFont(ofSize: 10)
        noteLabel.textColor = .secondaryLabelColor

        let stack = NSStackView(views: [
            fieldLabel("Email"), emailValueLabel,
            fieldLabel("Établissement"), schoolLabel,
            fieldLabel("Classe"), classLabel,
            fieldLabel("Abonnement"), statusValueLabel,
            noteLabel, closeButton,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 20),
            noteLabel.widthAnchor.constraint(equalToConstant: 260),
        ])

        window.contentView = content
    }

    func load() async {
        var request = URLRequest(url: URL(string: "\(baseUrl)/api/my-memberships")!)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        guard let (data, _) = try? await URLSession.shared.data(for: request),
            let response = try? JSONDecoder().decode(MyMembershipsResponse.self, from: data),
            let membership = response.memberships.first(where: { $0.role == "etudiant" })
        else {
            schoolLabel.stringValue = "Impossible de charger le profil."
            return
        }
        schoolLabel.stringValue = membership.schoolName
        classLabel.stringValue = membership.className ?? "—"
        statusValueLabel.stringValue =
            membership.effectiveStatus == "active"
            ? "Actif"
            : "En attente de renouvellement — contactez votre établissement"
    }

    @objc private func closeTapped() {
        window?.close()
    }
}
