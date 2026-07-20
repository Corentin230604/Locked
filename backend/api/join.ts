import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { joinRoom } from "../src/lib/roomService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { code, studentName } = req.body ?? {};
  if (!code || !studentName) {
    res.status(400).json({ error: "code and studentName are required" });
    return;
  }

  const result = await joinRoom(code, studentName);
  if (!result) {
    res.status(404).json({ error: "room not found or closed" });
    return;
  }

  res.status(201).json({
    sessionId: result.session.id,
    roomId: result.room.id,
    config: result.room.config,
    lifecycle: result.room.lifecycle,
    examFileAvailable: Boolean(result.room.examFilePath),
  });
}
