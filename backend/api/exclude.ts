import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { excludeSession } from "../src/lib/roomService";

/** Teacher-triggered exclusion from the dashboard "Exclure" button. The agent
 * has no push channel to receive this instantly — it discovers the status
 * flip by polling GET /api/session (see api/session.ts). */
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

  const session = await excludeSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  res.status(200).json({ ok: true });
}
