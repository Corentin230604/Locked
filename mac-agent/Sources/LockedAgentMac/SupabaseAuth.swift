import Foundation

/// Fixed for this deployment - the anon key is meant to be public (protected
/// by RLS policies, unlike the service_role key), so shipping it in the
/// agent binary is safe. Talked to directly (not through our own backend)
/// only for sign-in, via Supabase Auth's REST API.
enum SupabaseAuth {
    static let url = "https://kacjqpqppcqtdyebdpyi.supabase.co"
    static let anonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthY2pxcHFwcGNxdGR5ZWJkcHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDQzNzAsImV4cCI6MjA5OTc4MDM3MH0.IoOLViEXo8JAHgF3QVlLiWDrIyUAq5_kGBisZjG8RpI"

    private struct TokenResponse: Codable {
        let accessToken: String
        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
        }
    }

    /// (jwt, emailNotConfirmed) — the second is only ever true alongside a
    /// nil jwt, distinguishing "you haven't clicked your confirmation link
    /// yet" (see register-student.ts) from a genuinely wrong email/password.
    static func signIn(email: String, password: String) async -> (jwt: String?, emailNotConfirmed: Bool) {
        var request = URLRequest(url: URL(string: "\(url)/auth/v1/token?grant_type=password")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["email": email, "password": password])

        guard let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse
        else {
            return (nil, false)
        }
        if http.statusCode != 200 {
            let body = String(data: data, encoding: .utf8) ?? ""
            let notConfirmed = body.range(of: "not confirmed", options: .caseInsensitive) != nil
            return (nil, notConfirmed)
        }
        guard let token = try? JSONDecoder().decode(TokenResponse.self, from: data) else {
            return (nil, false)
        }
        return (token.accessToken, false)
    }
}

/// Backend errors are JSON `{ "error": "..." }` — show that message directly
/// instead of dumping the raw response body.
func extractErrorMessage(_ data: Data) -> String {
    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let message = obj["error"] as? String
    {
        return message
    }
    return String(data: data, encoding: .utf8) ?? "erreur inconnue"
}
