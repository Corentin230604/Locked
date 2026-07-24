import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import {
  computeEffectiveStatus,
  getMembership,
  getSchoolById,
  listMembershipsForSchool,
} from "../src/lib/schoolService";

/** Every member of a school (all roles), annotated with effective status —
 * feeds the school admin panel's member list and its "en attente de
 * renouvellement" view. Full member list, unlike school-stats.ts's counts
 * (which the platform super-admin can see without a school_admin role). */
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

  if (!(await isPlatformAdmin(caller.userId))) {
    const membership = await getMembership(caller.userId, schoolId);
    if (!membership || membership.role !== "school_admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }

  const school = await getSchoolById(schoolId);
  const memberships = await listMembershipsForSchool(schoolId);
  const withStatus = memberships.map((m) => ({
    ...m,
    effectiveStatus: computeEffectiveStatus(m.validUntil, school?.defaultGracePeriodDays ?? 60),
  }));

  res.status(200).json({ members: withStatus });
}
