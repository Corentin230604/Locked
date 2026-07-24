import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import {
  computeDefaultValidUntil,
  getMembership,
  getSchoolById,
  inviteIntervenant,
  isWithinScope,
  listMembershipsForSchool,
} from "../src/lib/schoolService";

/**
 * School-admin only: invites an intervenant by email (Supabase Auth sends
 * the activation link) and assigns the classes they'll manage. Every class
 * in classPerimeterIds must be within the caller's own scope — this is what
 * lets a delegated (per-campus/département) admin only hand out classes
 * they're actually responsible for.
 *
 * ⚠️ Supabase Auth's built-in email sending is rate-limited by default —
 * fine for individual intervenant invites, but a custom SMTP provider
 * (Resend, Postmark...) will be needed for any real volume.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const caller = await getCaller(req);
  if (!caller) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const platformAdmin = await isPlatformAdmin(caller.userId);

  if (req.method === "GET") {
    const schoolId = String(req.query.schoolId ?? "");
    if (!schoolId) {
      res.status(400).json({ error: "schoolId query param is required" });
      return;
    }
    if (!platformAdmin) {
      const membership = await getMembership(caller.userId, schoolId);
      if (!membership || membership.role !== "school_admin") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    }
    const memberships = await listMembershipsForSchool(schoolId);
    res.status(200).json({ memberships: memberships.filter((m) => m.role === "intervenant") });
    return;
  }

  if (req.method === "POST") {
    const { schoolId, email, classPerimeterIds } = req.body ?? {};
    if (!schoolId || !email) {
      res.status(400).json({ error: "schoolId and email are required" });
      return;
    }
    const classIds: string[] = Array.isArray(classPerimeterIds) ? classPerimeterIds : [];

    let adminPerimeterId: string | null = null;
    if (!platformAdmin) {
      const membership = await getMembership(caller.userId, schoolId);
      if (!membership || membership.role !== "school_admin") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      adminPerimeterId = membership.adminPerimeterId;
      for (const perimeterId of classIds) {
        if (!(await isWithinScope(adminPerimeterId, perimeterId))) {
          res.status(403).json({ error: `class ${perimeterId} is outside your scope` });
          return;
        }
      }
    }

    const school = await getSchoolById(schoolId);
    if (!school) {
      res.status(404).json({ error: "school not found" });
      return;
    }

    const membership = await inviteIntervenant({
      schoolId,
      email,
      adminPerimeterId,
      classPerimeterIds: classIds,
      validUntil: computeDefaultValidUntil(school.defaultValidityYears),
    });
    res.status(201).json(membership);
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
