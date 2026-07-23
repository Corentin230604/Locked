import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import {
  getSession,
  recordViolation,
  updateSessionStatus,
  ViolationType,
} from "../src/lib/roomService";

const AGENT_EVENT_TYPES: ViolationType[] = [
  "focus_lost",
  "focus_returned",
  "excluded",
  "disconnected",
  "test_exit",
];

/** Agent -> backend event relay (focus lost/returned, self-excluded on
 * countdown expiry, disconnected). Writing the row is what the dashboard's
 * Supabase Realtime subscription on `violations` picks up automatically —
 * there is no separate broadcast step to wire. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { sessionId, type, payload } = req.body ?? {};
  if (!sessionId || !AGENT_EVENT_TYPES.includes(type)) {
    res.status(400).json({ error: "sessionId and a valid type are required" });
    return;
  }

  const session = await getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  if (type === "excluded") {
    await updateSessionStatus(sessionId, "excluded");
  } else if (type === "disconnected") {
    await updateSessionStatus(sessionId, "disconnected");
  } else if (type === "test_exit") {
    await updateSessionStatus(sessionId, "left");
  }

  const event = await recordViolation(sessionId, session.roomId, type, payload);
  res.status(201).json({ ok: true, eventId: event.id });
}
