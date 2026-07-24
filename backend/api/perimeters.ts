import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import {
  createPerimeter,
  getMembership,
  isWithinScope,
  listPerimetersForSchool,
} from "../src/lib/schoolService";

/**
 * Creates campus/département/classe nodes in a school's perimeter tree, or
 * lists them. Only a platform admin, or a school_admin whose own scope
 * covers the target parent (or the whole school, for a new top-level node),
 * may create a node there — see schoolService.ts's isWithinScope().
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
    const perimeters = await listPerimetersForSchool(schoolId);
    res.status(200).json({ perimeters });
    return;
  }

  if (req.method === "POST") {
    const { schoolId, parentId, name, kind } = req.body ?? {};
    if (!schoolId || !name || !kind) {
      res.status(400).json({ error: "schoolId, name and kind are required" });
      return;
    }

    if (!platformAdmin) {
      const membership = await getMembership(caller.userId, schoolId);
      if (!membership || membership.role !== "school_admin") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (parentId) {
        if (!(await isWithinScope(membership.adminPerimeterId, parentId))) {
          res.status(403).json({ error: "parent perimeter is outside your scope" });
          return;
        }
      } else if (membership.adminPerimeterId !== null) {
        res.status(403).json({ error: "only a full-school admin can create a top-level perimeter" });
        return;
      }
    }

    const perimeter = await createPerimeter(schoolId, parentId ?? null, name, kind);
    res.status(201).json(perimeter);
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
