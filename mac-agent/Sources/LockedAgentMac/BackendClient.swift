import Foundation

/// REST client for the Locked backend. There is no server-to-agent push
/// channel in this architecture, so exclusion and room lifecycle transitions
/// (waiting -> started -> ended) are all discovered by polling this
/// session's own row — mirrors the Windows agent's BackendClient.cs exactly.
final class BackendClient {
    private let baseURL: String
    private let sessionId: String
    private var lastLifecycle: String
    private var lastStatus: String
    private let authToken: String
    private var pollTask: Task<Void, Never>?

    var onExcluded: (() -> Void)?
    var onRoomStarted: (() -> Void)?
    var onRoomEnded: (() -> Void)?
    /// Teacher let this student in from the airlock.
    var onEntryApproved: (() -> Void)?
    /// Teacher refused this student at the airlock.
    var onEntryDenied: (() -> Void)?

    init(baseURL: String, sessionId: String, initialLifecycle: String, authToken: String, initialStatus: String = "active") {
        self.baseURL = baseURL
        self.sessionId = sessionId
        self.lastLifecycle = initialLifecycle
        self.authToken = authToken
        self.lastStatus = initialStatus
    }

    private func makeRequest(path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest {
        var request = URLRequest(url: URL(string: "\(baseURL)\(path)")!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        if let body = body {
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    func sendEvent(type: String, payload: [String: Any]? = nil) async {
        var body: [String: Any] = ["sessionId": sessionId, "type": type]
        if let payload = payload { body["payload"] = payload }
        let request = makeRequest(path: "/api/events", method: "POST", body: body)
        _ = try? await URLSession.shared.data(for: request)
    }

    func sendHeartbeat() async {
        let request = makeRequest(path: "/api/heartbeat", method: "POST", body: ["sessionId": sessionId])
        _ = try? await URLSession.shared.data(for: request)
    }

    /// Downloads the exam file the teacher imported, if any, via a
    /// short-lived signed URL — the agent never gets Storage credentials.
    func downloadExamFile() async -> Data? {
        let request = makeRequest(path: "/api/exam-file?sessionId=\(sessionId)")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse, http.statusCode == 200,
            let info = try? JSONDecoder().decode(ExamFileResponse.self, from: data),
            let fileURL = URL(string: info.url)
        else {
            return nil
        }
        return try? await URLSession.shared.data(from: fileURL).0
    }

    /// Uploads the student's saved workbook once the exam ends.
    func uploadSubmission(fileData: Data, filename: String) async {
        let body: [String: Any] = [
            "sessionId": sessionId,
            "fileBase64": fileData.base64EncodedString(),
            "filename": filename,
        ]
        let request = makeRequest(path: "/api/submission", method: "POST", body: body)
        _ = try? await URLSession.shared.data(for: request)
    }

    func startPolling() {
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { break }

                let request = makeRequest(path: "/api/session?sessionId=\(sessionId)")
                guard let (data, _) = try? await URLSession.shared.data(for: request),
                    let status = try? JSONDecoder().decode(SessionStatusResponse.self, from: data)
                else {
                    continue  // transient network/server error — retry on the next tick
                }

                if status.status == "excluded" {
                    onExcluded?()
                    return
                }

                if lastStatus == "pending_approval" && status.status != lastStatus {
                    lastStatus = status.status
                    if status.status == "active" {
                        onEntryApproved?()
                    } else {
                        // "left" (denied) or anything else — either way this
                        // student isn't getting into the room.
                        onEntryDenied?()
                        return
                    }
                }

                let lifecycle = status.room?.lifecycle ?? lastLifecycle
                if lifecycle != lastLifecycle {
                    let previous = lastLifecycle
                    lastLifecycle = lifecycle
                    if lifecycle == "started" && previous == "waiting" {
                        onRoomStarted?()
                    } else if lifecycle == "ended" {
                        onRoomEnded?()
                        return
                    }
                }
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
    }
}
