import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller } from "../src/lib/authContext";
import { getSessionHistoryForMemberships } from "../src/lib/roomService";
import { listMembershipsForUser } from "../src/lib/schoolService";

/** The caller's own room history as a student, across every school they've
 * ever joined a room in — feeds the Windows agent's post-login dashboard. */
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

  const memberships = await listMembershipsForUser(caller.userId);
  const studentMembershipIds = memberships.filter((m) => m.role === "etudiant").map((m) => m.id);
  const sessions = await getSessionHistoryForMemberships(studentMembershipIds);
  res.status(200).json({ sessions });
}
