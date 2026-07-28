import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { isValidIpOrCidr } from "../src/lib/network";
import { getMembership, getSchoolById, updateSchoolAllowedIpRanges } from "../src/lib/schoolService";

/**
 * GET/PUT the CIDR allowlist a student's IP must fall within to join any
 * room of this school (see api/join.ts). Reserved for a full-school admin
 * (adminPerimeterId null) or the platform admin — a scoped campus/department
 * admin can't change a restriction that applies to the whole établissement.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    if (!membership || membership.role !== "school_admin" || membership.adminPerimeterId !== null) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }

  if (req.method === "GET") {
    const school = await getSchoolById(schoolId);
    if (!school) {
      res.status(404).json({ error: "school not found" });
      return;
    }
    res.status(200).json({ allowedIpRanges: school.allowedIpRanges });
    return;
  }

  if (req.method === "PUT") {
    const { allowedIpRanges } = req.body ?? {};
    if (!Array.isArray(allowedIpRanges)) {
      res.status(400).json({ error: "allowedIpRanges[] is required" });
      return;
    }
    const cleaned = allowedIpRanges.map((v: unknown) => String(v).trim()).filter((v: string) => v.length > 0);
    const invalid = cleaned.find((v: string) => !isValidIpOrCidr(v));
    if (invalid) {
      res.status(400).json({ error: `adresse invalide : ${invalid} (attendu : IP ou plage CIDR, ex. 203.0.113.0/24)` });
      return;
    }

    const school = await updateSchoolAllowedIpRanges(schoolId, cleaned);
    res.status(200).json({ allowedIpRanges: school.allowedIpRanges });
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
