import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getRoomByCode, getSessionsForRoom } from "../src/lib/roomService";

/** Snapshot of a room's sessions — used by the dashboard on first load, before
 * its Supabase Realtime subscription starts delivering live updates. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const code = String(req.query.code ?? "");
  if (!code) {
    res.status(400).json({ error: "code query param is required" });
    return;
  }

  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  const sessions = await getSessionsForRoom(room.id);
  res.status(200).json({ room, sessions });
}
