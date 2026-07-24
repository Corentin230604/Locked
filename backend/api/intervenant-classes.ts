import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import {
  assignIntervenantClass,
  getMembership,
  getMembershipById,
  isWithinScope,
  listIntervenantClasses,
  removeIntervenantClass,
} from "../src/lib/schoolService";

/** Adds or removes a class from the set an intervenant is allowed to create
 * rooms for. Only the school_admin whose scope covers both the intervenant's
 * school and the target class may change this. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const caller = await getCaller(req);
  if (!caller) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  if (req.method === "GET") {
    const membershipId = String(req.query.membershipId ?? "");
    if (!membershipId) {
      res.status(400).json({ error: "membershipId query param is required" });
      return;
    }
    const classes = await listIntervenantClasses(membershipId);
    res.status(200).json({ classes });
    return;
  }

  if (req.method === "POST") {
    const { membershipId, perimeterId, action } = req.body ?? {};
    if (!membershipId || !perimeterId || (action !== "add" && action !== "remove")) {
      res.status(400).json({ error: "membershipId, perimeterId and action ('add'|'remove') are required" });
      return;
    }

    const targetMembership = await getMembershipById(membershipId);
    if (!targetMembership || targetMembership.role !== "intervenant") {
      res.status(404).json({ error: "intervenant membership not found" });
      return;
    }

    if (!(await isPlatformAdmin(caller.userId))) {
      const callerMembership = await getMembership(caller.userId, targetMembership.schoolId);
      if (!callerMembership || callerMembership.role !== "school_admin") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (!(await isWithinScope(callerMembership.adminPerimeterId, perimeterId))) {
        res.status(403).json({ error: "class is outside your scope" });
        return;
      }
    }

    if (action === "add") {
      await assignIntervenantClass(membershipId, perimeterId);
    } else {
      await removeIntervenantClass(membershipId, perimeterId);
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
