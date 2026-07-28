import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { denyEntry } from "../src/lib/roomService";

/** Teacher refuses a pending joiner (airlock, see roomService.joinRoom). The
 * agent has no push channel — it discovers this by polling GET /api/session,
 * exactly like an exclusion. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { sessionId } = req.body ?? {};
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const session = await denyEntry(sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found or not pending approval" });
    return;
  }

  res.status(200).json({ ok: true });
}
