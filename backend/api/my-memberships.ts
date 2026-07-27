import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import {
  computeEffectiveStatus,
  getPerimeterById,
  getSchoolById,
  listMembershipsForUser,
} from "../src/lib/schoolService";

/**
 * The logged-in caller's own memberships, each annotated with its effective
 * status (active / pending_renewal / expired) — used to show the "no active
 * subscription" screen, and, when there's more than one, the workspace
 * switcher for a teacher who belongs to several schools.
 */
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
  const withStatus = await Promise.all(
    memberships.map(async (m) => {
      const school = await getSchoolById(m.schoolId);
      const className = m.classPerimeterId ? (await getPerimeterById(m.classPerimeterId))?.name ?? null : null;
      return {
        ...m,
        schoolName: school?.name ?? "",
        className,
        effectiveStatus: computeEffectiveStatus(m.validUntil, school?.defaultGracePeriodDays ?? 60),
      };
    })
  );

  res.status(200).json({ memberships: withStatus, isPlatformAdmin: await isPlatformAdmin(caller.userId) });
}
