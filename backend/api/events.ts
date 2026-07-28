import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import {
  finalizeSessionExit,
  getSession,
  recordViolation,
  ViolationType,
} from "../src/lib/roomService";

const AGENT_EVENT_TYPES: ViolationType[] = [
  "focus_lost",
  "focus_returned",
  "excluded",
  "disconnected",
  "test_exit",
  "environment_violation_detected",
  "environment_violation_cleared",
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
    // The agent self-reports "excluded" for two distinct countdowns: the
    // focus-loss overlay (reason "countdown_expired") and the environment
    // watcher's own overlay (multiple monitors / a forbidden app still
    // running once its countdown expires — reason is neither of the
    // countdown reasons above). A teacher-initiated exclusion goes through
    // api/exclude.ts instead, which records "manual_exclusion" directly.
    const reason = payload?.reason === "countdown_expired" ? "focus_timeout" : "environment_violation";
    await finalizeSessionExit(sessionId, "excluded", reason);
  } else if (type === "disconnected") {
    await finalizeSessionExit(sessionId, "disconnected", "heartbeat_timeout");
  } else if (type === "test_exit") {
    await finalizeSessionExit(sessionId, "left", "test_exit");
  }

  const event = await recordViolation(sessionId, session.roomId, type, payload);
  res.status(201).json({ ok: true, eventId: event.id });
}
