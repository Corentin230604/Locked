import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { deleteMembership, getMembership, getMembershipById } from "../src/lib/schoolService";

/**
 * Immediately revokes a membership — distinct from the automatic
 * expiry-then-grace-period deletion (lifecycleService.ts). Reserved for a
 * full-school admin or the platform admin, same bar as update-membership.ts.
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

  const { membershipId } = req.body ?? {};
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
      res.status(403).json({ error: "seul un admin de toute l'école peut révoquer un compte" });
      return;
    }
  }

  await deleteMembership(membershipId);
  res.status(200).json({ ok: true });
}
