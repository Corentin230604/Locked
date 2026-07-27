import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller } from "../src/lib/authContext";
import { getRoomsForIntervenant } from "../src/lib/roomService";
import { getMembership } from "../src/lib/schoolService";

/** Every room the caller created or was added to as a co-organizer, for one
 * school — feeds the intervenant space's "Historique" view. */
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

  const schoolId = String(req.query.schoolId ?? "");
  if (!schoolId) {
    res.status(400).json({ error: "schoolId query param is required" });
    return;
  }

  const membership = await getMembership(caller.userId, schoolId);
  if (!membership || (membership.role !== "intervenant" && membership.role !== "school_admin")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const rooms = await getRoomsForIntervenant(schoolId, membership.id, caller.userId);
  res.status(200).json({ rooms });
}
