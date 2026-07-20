import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { startRoom } from "../src/lib/roomService";

/** Teacher's "Démarrer l'examen" button. Every waiting agent picks this up
 * on its next poll (GET /api/session) and switches from the unlocked
 * background Excel window to fullscreen + full monitoring. */
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

  const room = await startRoom(roomId);
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  res.status(200).json(room);
}
