import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller } from "../src/lib/authContext";
import { addRoomCoOrganizers, getRoomByCoOrganizerCode } from "../src/lib/roomService";
import { getMembership } from "../src/lib/schoolService";

/**
 * A different code than the student join code (rooms.co_organizer_code):
 * lets another intervenant (or school_admin) at the same school become a
 * ponctual co-organizer of a specific room — the "co-créer / rejoindre en
 * tant qu'intervenant" flow, useful for multi-class partiels supervised by
 * several people.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const caller = await getCaller(req);
  if (!caller) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  const { coOrganizerCode } = req.body ?? {};
  if (!coOrganizerCode) {
    res.status(400).json({ error: "coOrganizerCode is required" });
    return;
  }

  const room = await getRoomByCoOrganizerCode(coOrganizerCode);
  if (!room || !room.schoolId) {
    res.status(404).json({ error: "code invalide" });
    return;
  }

  const membership = await getMembership(caller.userId, room.schoolId);
  if (!membership || (membership.role !== "intervenant" && membership.role !== "school_admin")) {
    res.status(403).json({ error: "vous n'êtes pas intervenant de cet établissement" });
    return;
  }

  await addRoomCoOrganizers(room.id, [caller.userId]);
  res.status(200).json(room);
}
