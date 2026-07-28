import Foundation

// Backend JSON is already camelCase, matching Swift's own convention, so no
// custom CodingKeys/keyDecodingStrategy are needed anywhere here.

struct ScreenshotConfig: Codable {
    var enabled: Bool
    var perMinute: Int
}

struct RoomConfig: Codable {
    var examTitle: String
    var countdownSeconds: Int
    var screenshot: ScreenshotConfig
}

struct JoinResponse: Codable {
    var sessionId: String
    var roomId: String
    var config: RoomConfig
    /// "waiting" | "started" | "ended" at the moment this student joined.
    var lifecycle: String
    var examFileAvailable: Bool
    /// All restrictions apply exactly as in a real exam, but a floating
    /// "Quitter le test" button stays available.
    var isTest: Bool
    /// "active" normally, or "pending_approval" when joining after the room
    /// has already started — the agent must wait at the airlock (see
    /// AirlockWindowController) instead of locking down immediately.
    var status: String
}

struct RoomStatus: Codable {
    var lifecycle: String
    var examFileAvailable: Bool
    var isTest: Bool
}

/// Shape of GET /api/session — polled every few seconds since there is no
/// server-to-agent push channel in this architecture.
struct SessionStatusResponse: Codable {
    var status: String
    var room: RoomStatus?
}

/// Shape of GET /api/exam-file — a short-lived signed Supabase Storage URL,
/// never the file bytes directly from our own API.
struct ExamFileResponse: Codable {
    var url: String
    var filename: String
}

struct SessionHistoryRoom: Codable {
    var code: String
    var isTest: Bool
    var createdAt: String
    var config: RoomConfig
}

/// One row of GET /api/my-sessions — the student's own room history.
struct SessionHistoryItem: Codable {
    var status: String
    var joinedAt: String
    var room: SessionHistoryRoom
}

struct SessionHistoryResponse: Codable {
    var sessions: [SessionHistoryItem]
}

/// One row of GET /api/my-memberships.
struct MembershipInfo: Codable {
    var role: String
    var schoolName: String
    var className: String?
    var validUntil: String
    var effectiveStatus: String
}

struct MyMembershipsResponse: Codable {
    var memberships: [MembershipInfo]
    var isPlatformAdmin: Bool
}
