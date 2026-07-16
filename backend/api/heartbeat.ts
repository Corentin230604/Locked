import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { touchSession } from "../src/lib/roomService";

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

  await touchSession(sessionId);
  res.status(200).json({ ok: true });
}
