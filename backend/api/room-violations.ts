import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { getRoomById, getViolationsForRoom, listRoomCoOrganizerIds } from "../src/lib/roomService";
import { getMembership } from "../src/lib/schoolService";

/** Full event log for one room (history detail view) — Realtime only
 * delivers *new* violations, so a finished room needs this REST snapshot.
 * Reserved for the room's creator, one of its co-organizers, or the
 * platform admin. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const caller = await getCaller(req);
  if (!caller) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  const roomId = String(req.query.roomId ?? "");
  if (!roomId) {
    res.status(400).json({ error: "roomId query param is required" });
    return;
  }

  const room = await getRoomById(roomId);
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  if (!(await isPlatformAdmin(caller.userId)) && room.schoolId) {
    const membership = await getMembership(caller.userId, room.schoolId);
    const isCreator = membership && membership.id === room.createdByMembershipId;
    const coOrganizerIds = await listRoomCoOrganizerIds(roomId);
    const isCoOrganizer = coOrganizerIds.includes(caller.userId);
    if (!isCreator && !isCoOrganizer) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }

  const violations = await getViolationsForRoom(roomId);
  res.status(200).json({ violations });
}
