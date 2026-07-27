import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import {
  computeDefaultValidUntil,
  getMembership,
  getSchoolById,
  inviteSchoolAdmin,
  isWithinScope,
} from "../src/lib/schoolService";

/**
 * Invites a school_admin by email, optionally scoped to a perimeter (null =
 * full-school). Reserved for the platform admin, or an existing school_admin
 * whose own scope covers the target perimeter — a full-school admin can
 * create another full-school admin, but a scoped admin can only delegate
 * within (or below) their own perimeter.
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

  const { schoolId, email, adminPerimeterId } = req.body ?? {};
  if (!schoolId || !email) {
    res.status(400).json({ error: "schoolId and email are required" });
    return;
  }

  if (!(await isPlatformAdmin(caller.userId))) {
    const callerMembership = await getMembership(caller.userId, schoolId);
    if (!callerMembership || callerMembership.role !== "school_admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (adminPerimeterId) {
      if (!(await isWithinScope(callerMembership.adminPerimeterId, adminPerimeterId))) {
        res.status(403).json({ error: "perimeter is outside your scope" });
        return;
      }
    } else if (callerMembership.adminPerimeterId !== null) {
      res.status(403).json({ error: "only a full-school admin can create another full-school admin" });
      return;
    }
  }

  const school = await getSchoolById(schoolId);
  if (!school) {
    res.status(404).json({ error: "school not found" });
    return;
  }

  const membership = await inviteSchoolAdmin({
    schoolId,
    email,
    adminPerimeterId: adminPerimeterId ?? null,
    validUntil: computeDefaultValidUntil(school.defaultValidityYears),
  });
  res.status(201).json(membership);
}
