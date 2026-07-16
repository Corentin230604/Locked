import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getSession } from "../src/lib/roomService";

/** Polled by the Windows agent every few seconds to detect a teacher-triggered
 * exclusion (see api/exclude.ts) — no direct server-to-agent push exists once
 * Socket.IO is out of the picture, so the agent watches its own session row. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const sessionId = String(req.query.sessionId ?? "");
  if (!sessionId) {
    res.status(400).json({ error: "sessionId query param is required" });
    return;
  }

  const session = await getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  res.status(200).json(session);
}
