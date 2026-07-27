import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { getMembership, getMembershipById, updateMembershipRole } from "../src/lib/schoolService";

/**
 * Changes an existing membership's role and/or scope (promote/demote,
 * reassign a scoped admin's perimeter, fix a student's class). Reserved for
 * a full-school admin (adminPerimeterId === null) or the platform admin —
 * same bar as renew-membership.ts, since role changes are sensitive enough
 * not to delegate to scoped admins in v1.
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

  const { membershipId, role, adminPerimeterId, classPerimeterId } = req.body ?? {};
  if (!membershipId) {
    res.status(400).json({ error: "membershipId is required" });
    return;
  }

  const target = await getMembershipById(membershipId);
  if (!target) {
    res.status(404).json({ error: "membership not found" });
    return;
  }

  if (!(await isPlatformAdmin(caller.userId))) {
    const callerMembership = await getMembership(caller.userId, target.schoolId);
    if (
      !callerMembership ||
      callerMembership.role !== "school_admin" ||
      callerMembership.adminPerimeterId !== null
    ) {
      res.status(403).json({ error: "seul un admin de toute l'école peut modifier un rôle" });
      return;
    }
  }

  const updated = await updateMembershipRole(membershipId, { role, adminPerimeterId, classPerimeterId });
  res.status(200).json(updated);
}
