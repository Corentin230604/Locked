import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { createSchool, listSchools } from "../src/lib/schoolService";

/** Platform-admin only: provisions a new school, or lists every school on
 * the platform. This is the "je dois lui programmer son compte" step —
 * nobody can register with a school's email domain until it exists here. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const caller = await getCaller(req);
  if (!caller) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!(await isPlatformAdmin(caller.userId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  if (req.method === "GET") {
    const schools = await listSchools();
    res.status(200).json({ schools });
    return;
  }

  if (req.method === "POST") {
    const { name, emailDomains, defaultValidityYears, defaultGracePeriodDays } = req.body ?? {};
    if (!name || !Array.isArray(emailDomains) || emailDomains.length === 0) {
      res.status(400).json({ error: "name and emailDomains[] are required" });
      return;
    }
    const school = await createSchool(name, emailDomains, defaultValidityYears, defaultGracePeriodDays);
    res.status(201).json(school);
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
