import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { getMembership } from "../src/lib/schoolService";

/** Lightweight counts for the super-admin's cross-school view: how many
 * members of each role, and how many rooms, without exposing full member
 * lists (that's the school admin's own panel — see school-memberships.ts). */
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

  const [{ count: schoolAdminCount }, { count: intervenantCount }, { count: etudiantCount }, { count: roomCount }] =
    await Promise.all([
      supabaseAdmin
        .from("school_memberships")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("role", "school_admin"),
      supabaseAdmin
        .from("school_memberships")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("role", "intervenant"),
      supabaseAdmin
        .from("school_memberships")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("role", "etudiant"),
      supabaseAdmin.from("rooms").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    ]);

  res.status(200).json({
    schoolAdminCount: schoolAdminCount ?? 0,
    intervenantCount: intervenantCount ?? 0,
    etudiantCount: etudiantCount ?? 0,
    roomCount: roomCount ?? 0,
  });
}
