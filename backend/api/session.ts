import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getRoomById, getSession } from "../src/lib/roomService";

/**
 * Polled by the Windows agent every few seconds. Carries everything the
 * agent needs to react to server-side state changes without a push channel:
 * its own status (to detect a teacher-triggered exclusion, see
 * api/exclude.ts) and the room's lifecycle (to detect the waiting -> started
 * transition and the started -> ended transition, see api/start.ts and
 * api/end.ts).
 */
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
  const room = await getRoomById(session.roomId);

  res.status(200).json({
    ...session,
    room: room
      ? { lifecycle: room.lifecycle, examFileAvailable: Boolean(room.examFilePath), isTest: room.isTest }
      : null,
  });
}
