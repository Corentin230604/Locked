import Cocoa

/// Shown right after login: room history, a "Rejoindre" field directly on
/// screen (the only real action available, so no fake navigation was added
/// just to have a menu), Profil and Déconnexion.
final class StudentDashboardWindowController: NSWindowController {
    private let baseUrl: String
    private let authToken: String
    private let email: String

    private let roomCodeField = NSTextField()
    private let joinButton = NSButton(title: "Rejoindre", target: nil, action: nil)
    private let statusLabel = NSTextField(wrappingLabelWithString: "")
    private let historyStack = NSStackView()
    private var examSession: ExamSession?

    init(baseUrl: String, authToken: String, email: String) {
        self.baseUrl = baseUrl
        self.authToken = authToken
        self.email = email
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 600),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Locked"
        window.center()
        super.init(window: window)
        setupUI()
        Task { await loadHistory() }
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func label(_ text: String, size: CGFloat = 13, secondary: Bool = false) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.font = .systemFont(ofSize: size)
        if secondary { l.textColor = .secondaryLabelColor }
        return l
    }

    private func setupUI() {
        guard let window = window, let contentView = window.contentView else { return }
        let content = NSView(frame: contentView.bounds)
        content.autoresizingMask = [.width, .height]

        let titleLabel = label("Locked", size: 22)
        titleLabel.font = .boldSystemFont(ofSize: 22)
        let greetingLabel = label("Connecté en tant que \(email)", size: 12, secondary: true)

        roomCodeField.placeholderString = "Code de la room"
        roomCodeField.translatesAutoresizingMaskIntoConstraints = false

        joinButton.bezelStyle = .rounded
        joinButton.target = self
        joinButton.action = #selector(joinTapped)

        statusLabel.textColor = .systemRed
        statusLabel.font = .systemFont(ofSize: 11)

        let profileButton = NSButton(title: "Profil", target: self, action: #selector(profileTapped))
        let logoutButton = NSButton(title: "Déconnexion", target: self, action: #selector(logoutTapped))
        profileButton.bezelStyle = .rounded
        logoutButton.bezelStyle = .rounded

        let topButtonsStack = NSStackView(views: [profileButton, logoutButton])
        topButtonsStack.orientation = .horizontal
        topButtonsStack.spacing = 8

        let joinLabel = label("Rejoindre une room", size: 14)
        let historyLabel = label("Historique", size: 14)

        historyStack.orientation = .vertical
        historyStack.alignment = .leading
        historyStack.spacing = 6
        historyStack.translatesAutoresizingMaskIntoConstraints = false

        let historyScroll = NSScrollView()
        historyScroll.hasVerticalScroller = true
        historyScroll.documentView = historyStack
        historyScroll.translatesAutoresizingMaskIntoConstraints = false

        let mainStack = NSStackView(views: [
            titleLabel, greetingLabel, topButtonsStack,
            joinLabel, roomCodeField, joinButton, statusLabel,
            historyLabel, historyScroll,
        ])
        mainStack.orientation = .vertical
        mainStack.alignment = .leading
        mainStack.spacing = 10
        mainStack.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(mainStack)
        NSLayoutConstraint.activate([
            mainStack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            mainStack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            mainStack.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
            mainStack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24),
            roomCodeField.widthAnchor.constraint(equalToConstant: 320),
            historyScroll.widthAnchor.constraint(equalToConstant: 392),
            historyScroll.heightAnchor.constraint(equalToConstant: 220),
            historyStack.widthAnchor.constraint(equalToConstant: 380),
        ])

        window.contentView = content
    }

    @objc private func joinTapped() {
        joinButton.isEnabled = false
        statusLabel.stringValue = ""
        let roomCode = roomCodeField.stringValue.trimmingCharacters(in: .whitespaces).uppercased()
        guard !roomCode.isEmpty else {
            statusLabel.stringValue = "Renseigne le code de la room."
            joinButton.isEnabled = true
            return
        }

        Task {
            defer { joinButton.isEnabled = true }
            var request = URLRequest(url: URL(string: "\(baseUrl)/api/join")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["code": roomCode, "studentName": email])

            guard let (data, response) = try? await URLSession.shared.data(for: request),
                let http = response as? HTTPURLResponse
            else {
                statusLabel.stringValue = "Erreur réseau."
                return
            }
            guard (200...299).contains(http.statusCode) else {
                statusLabel.stringValue = extractErrorMessage(data)
                return
            }
            guard let join = try? JSONDecoder().decode(JoinResponse.self, from: data) else {
                statusLabel.stringValue = "Réponse du serveur invalide."
                return
            }

            let session = ExamSession(baseUrl: baseUrl, join: join, authToken: authToken)
            examSession = session
            await session.start()
            window?.orderOut(nil)
        }
    }

    @objc private func profileTapped() {
        let profile = ProfileWindowController(baseUrl: baseUrl, authToken: authToken, email: email)
        profile.showWindow(nil)
        Task { await profile.load() }
    }

    @objc private func logoutTapped() {
        let join = JoinWindowController()
        join.showWindow(nil)
        window?.close()
    }

    private func loadHistory() async {
        var request = URLRequest(url: URL(string: "\(baseUrl)/api/my-sessions")!)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        guard let (data, _) = try? await URLSession.shared.data(for: request),
            let response = try? JSONDecoder().decode(SessionHistoryResponse.self, from: data)
        else {
            return
        }

        historyStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        if response.sessions.isEmpty {
            historyStack.addArrangedSubview(label("Aucun examen pour le moment.", size: 12, secondary: true))
            return
        }
        for item in response.sessions {
            let title = item.room.config.examTitle.isEmpty ? "Examen" : item.room.config.examTitle
            let row = label("\(title) — \(Self.statusText(item.status))", size: 12)
            historyStack.addArrangedSubview(row)
        }
    }

    private static func statusText(_ status: String) -> String {
        switch status {
        case "active": return "En cours"
        case "excluded": return "Exclu"
        case "disconnected": return "Déconnecté"
        case "left": return "Terminé"
        case "pending_approval": return "En attente d'autorisation"
        default: return status
        }
    }
}
