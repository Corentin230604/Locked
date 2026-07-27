import Cocoa

/// Captures the screen the teacher's configured number of times per minute
/// (1-60), at random moments within each 60-second window rather than fixed
/// intervals — mirrors the Windows agent's ScreenshotService.cs exactly.
/// Requires the Screen Recording permission; silently captures nothing
/// (best-effort, matches the "don't interrupt the exam for a dropped frame"
/// posture already used for upload failures) if it isn't granted.
final class ScreenshotService {
    private let baseUrl: String
    private let sessionId: String
    private let authToken: String
    private let perMinute: Int
    private var task: Task<Void, Never>?

    init(baseUrl: String, sessionId: String, authToken: String, perMinute: Int) {
        self.baseUrl = baseUrl
        self.sessionId = sessionId
        self.authToken = authToken
        self.perMinute = perMinute
    }

    func start() {
        guard perMinute > 0 else { return }
        task = Task {
            while !Task.isCancelled {
                let windowStart = Date()
                let offsetsMs = (0..<perMinute).map { _ in Int.random(in: 0..<60_000) }.sorted()

                for offsetMs in offsetsMs {
                    let target = windowStart.addingTimeInterval(Double(offsetMs) / 1000)
                    let delay = target.timeIntervalSinceNow
                    if delay > 0 {
                        try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    }
                    if Task.isCancelled { break }
                    await captureAndUpload()
                }

                let remaining = 60.0 - Date().timeIntervalSince(windowStart)
                if remaining > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
                }
            }
        }
    }

    func stop() {
        task?.cancel()
    }

    private func captureAndUpload() async {
        guard let image = CGWindowListCreateImage(.infinite, .optionOnScreenOnly, kCGNullWindowID, .bestResolution),
            let pngData = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        else {
            return
        }

        var request = URLRequest(url: URL(string: "\(baseUrl)/api/screenshot")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "sessionId": sessionId,
            "imageBase64": pngData.base64EncodedString(),
        ])
        _ = try? await URLSession.shared.data(for: request)
    }
}
