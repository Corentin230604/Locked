import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { endRoom } from "../src/lib/roomService";

/** Teacher's "Terminer l'examen" button. Closes the room to new joins and
 * signals every agent (via polling) to save its workbook and submit it —
 * see api/submission.ts. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { roomId } = req.body ?? {};
  if (!roomId) {
    res.status(400).json({ error: "roomId is required" });
    return;
  }

  const room = await endRoom(roomId);
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  res.status(200).json(room);
}
