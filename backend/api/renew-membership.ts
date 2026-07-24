import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import {
  computeDefaultValidUntil,
  getMembership,
  getMembershipById,
  getSchoolById,
  renewMembership,
} from "../src/lib/schoolService";

/**
 * Renews a membership for another school year (or a custom validUntil date).
 * Reserved for a full-school admin (adminPerimeterId === null) or the
 * platform admin — renewal is sensitive enough that we don't delegate it to
 * scoped admins in v1.
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

  const { membershipId, validUntil } = req.body ?? {};
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
      res.status(403).json({ error: "seul un admin de toute l'école peut renouveler un compte" });
      return;
    }
  }

  let nextValidUntil: string = validUntil;
  if (!nextValidUntil) {
    const school = await getSchoolById(target.schoolId);
    if (!school) {
      res.status(404).json({ error: "school not found" });
      return;
    }
    nextValidUntil = computeDefaultValidUntil(school.defaultValidityYears);
  }

  const updated = await renewMembership(membershipId, nextValidUntil);
  res.status(200).json(updated);
}
