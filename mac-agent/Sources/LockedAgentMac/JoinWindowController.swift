import Cocoa

final class JoinWindowController: NSWindowController, NSTextFieldDelegate {
    private let baseUrlField = NSTextField(string: "https://locked-j4y8.onrender.com")
    private let emailField = NSTextField()
    private let passwordField = NSSecureTextField()
    private let lastNameField = NSTextField()
    private let firstNameField = NSTextField()
    private let classCodeField = NSTextField()
    private let lastNameLabel = NSTextField(labelWithString: "Nom")
    private let firstNameLabel = NSTextField(labelWithString: "Prénom")
    private let classCodeLabel = NSTextField(labelWithString: "Code classe")
    private let statusLabel = NSTextField(wrappingLabelWithString: "")
    private let continueButton = NSButton(title: "Continuer", target: nil, action: nil)
    private let toggleButton = NSButton(title: "Nouveau sur Locked ? Créer un compte", target: nil, action: nil)

    private var registerMode = false
    private var formattingField = false
    private var dashboardController: StudentDashboardWindowController?

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 500),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Locked"
        window.center()
        self.init(window: window)
        setupUI()
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

        let titleLabel = NSTextField(labelWithString: "Locked")
        titleLabel.font = .boldSystemFont(ofSize: 22)
        let subtitleLabel = NSTextField(labelWithString: "Espace étudiant")
        subtitleLabel.font = .systemFont(ofSize: 12)
        subtitleLabel.textColor = .secondaryLabelColor

        lastNameLabel.isHidden = true
        lastNameField.isHidden = true
        firstNameLabel.isHidden = true
        firstNameField.isHidden = true
        classCodeLabel.isHidden = true
        classCodeField.isHidden = true

        lastNameField.delegate = self
        firstNameField.delegate = self

        statusLabel.textColor = .systemRed
        statusLabel.font = .systemFont(ofSize: 11)

        continueButton.bezelStyle = .rounded
        continueButton.target = self
        continueButton.action = #selector(continueTapped)

        toggleButton.isBordered = false
        toggleButton.contentTintColor = .linkColor
        toggleButton.font = .systemFont(ofSize: 11)
        toggleButton.target = self
        toggleButton.action = #selector(toggleModeTapped)

        let stack = NSStackView(views: [
            titleLabel, subtitleLabel,
            fieldLabel("Adresse du serveur"), baseUrlField,
            fieldLabel("Email"), emailField,
            fieldLabel("Mot de passe"), passwordField,
            lastNameLabel, lastNameField,
            firstNameLabel, firstNameField,
            classCodeLabel, classCodeField,
            continueButton, toggleButton, statusLabel,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
        ])

        for field in [baseUrlField, emailField, passwordField, lastNameField, firstNameField, classCodeField] {
            field.translatesAutoresizingMaskIntoConstraints = false
            field.widthAnchor.constraint(equalToConstant: 320).isActive = true
        }

        window.contentView = content
    }

    @objc private func toggleModeTapped() {
        registerMode.toggle()
        lastNameLabel.isHidden = !registerMode
        lastNameField.isHidden = !registerMode
        firstNameLabel.isHidden = !registerMode
        firstNameField.isHidden = !registerMode
        classCodeLabel.isHidden = !registerMode
        classCodeField.isHidden = !registerMode
        toggleButton.title = registerMode ? "Déjà un compte ? Se connecter" : "Nouveau sur Locked ? Créer un compte"
    }

    /// Nom -> majuscules, Prénom -> première lettre en majuscule et le
    /// reste en minuscule, au fil de la saisie. Edits the live field editor
    /// (not just `stringValue`) so the visible text and the caret position
    /// stay in sync while typing.
    func controlTextDidChange(_ obj: Notification) {
        guard !formattingField,
            let field = obj.object as? NSTextField,
            let editor = field.currentEditor()
        else { return }

        let text = editor.string
        let formatted: String
        if field === lastNameField {
            formatted = text.uppercased()
        } else if field === firstNameField {
            guard let first = text.first else { return }
            formatted = String(first).uppercased() + text.dropFirst().lowercased()
        } else {
            return
        }
        guard formatted != text else { return }

        let range = editor.selectedRange
        formattingField = true
        editor.string = formatted
        editor.selectedRange = NSRange(location: min(range.location, formatted.count), length: 0)
        formattingField = false
    }

    @objc private func continueTapped() {
        continueButton.isEnabled = false
        statusLabel.stringValue = ""

        let baseUrl = baseUrlField.stringValue.trimmingCharacters(in: .whitespaces)
        let email = emailField.stringValue.trimmingCharacters(in: .whitespaces)
        let password = passwordField.stringValue

        guard !email.isEmpty, !password.isEmpty else {
            statusLabel.stringValue = "Merci de renseigner votre email et votre mot de passe."
            continueButton.isEnabled = true
            return
        }

        Task {
            defer { continueButton.isEnabled = true }

            if registerMode {
                let lastName = lastNameField.stringValue.trimmingCharacters(in: .whitespaces)
                let firstName = firstNameField.stringValue.trimmingCharacters(in: .whitespaces)
                let fullName = "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
                let classCode = classCodeField.stringValue.trimmingCharacters(in: .whitespaces).uppercased()
                guard !lastName.isEmpty, !firstName.isEmpty, !classCode.isEmpty else {
                    statusLabel.stringValue = "Merci de renseigner votre nom, votre prénom et le code de votre classe."
                    return
                }

                var request = URLRequest(url: URL(string: "\(baseUrl)/api/register-student")!)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try? JSONSerialization.data(withJSONObject: [
                    "email": email, "password": password, "name": fullName, "classCode": classCode,
                ])

                guard let (data, response) = try? await URLSession.shared.data(for: request) else {
                    statusLabel.stringValue = "Erreur réseau."
                    return
                }
                let http = response as? HTTPURLResponse
                if let http = http, !(200...299).contains(http.statusCode) {
                    statusLabel.stringValue = "Inscription impossible : \(extractErrorMessage(data))"
                    return
                }
            }

            let (token, emailNotConfirmed) = await SupabaseAuth.signIn(email: email, password: password)
            guard let token = token else {
                if emailNotConfirmed {
                    // Registration now requires a real click-through
                    // confirmation (see register-student.ts) — this is the
                    // expected first sign-in attempt right after creating
                    // the account, not an error with the password.
                    statusLabel.stringValue =
                        registerMode
                        ? "Compte créé ! Un email de confirmation vous a été envoyé — cliquez sur le lien qu'il contient avant de pouvoir vous connecter."
                        : "Votre email n'est pas encore confirmé. Vérifiez votre boîte mail et cliquez sur le lien reçu lors de l'inscription."
                } else {
                    statusLabel.stringValue =
                        registerMode
                        ? "Email ou mot de passe incorrect."
                        : "Email ou mot de passe incorrect. Si vous n'avez pas encore de compte, cliquez sur « Créer un compte » ci-dessous."
                }
                return
            }

            dashboardController = StudentDashboardWindowController(baseUrl: baseUrl, authToken: token, email: email)
            dashboardController?.showWindow(nil)
            window?.close()
        }
    }
}
