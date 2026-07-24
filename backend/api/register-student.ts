import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import {
  computeDefaultValidUntil,
  createMembership,
  getMembership,
  getPerimeterByJoinCode,
  getSchoolById,
} from "../src/lib/schoolService";

/**
 * Student self-registration: school email + class code + name + password.
 * The class code (created by the school for a specific classe perimeter) is
 * what proves the school authorized this account — a matching email domain
 * alone is never enough, per the design decision that the school must
 * always explicitly authorize every account.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { email, password, name, classCode } = req.body ?? {};
  if (!email || !password || !name || !classCode) {
    res.status(400).json({ error: "email, password, name and classCode are required" });
    return;
  }

  const perimeter = await getPerimeterByJoinCode(classCode);
  if (!perimeter || perimeter.kind !== "classe") {
    res.status(404).json({ error: "code classe invalide" });
    return;
  }

  const school = await getSchoolById(perimeter.schoolId);
  if (!school) {
    res.status(404).json({ error: "school not found" });
    return;
  }

  const domain = String(email).split("@")[1]?.toLowerCase();
  if (!domain || !school.emailDomains.includes(domain)) {
    res.status(403).json({ error: "cette adresse email ne correspond pas à l'établissement de cette classe" });
    return;
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (createError || !created.user) {
    const alreadyExists = createError?.message?.toLowerCase().includes("already");
    res.status(alreadyExists ? 409 : 500).json({
      error: alreadyExists
        ? "un compte existe déjà avec cet email — connectez-vous plutôt"
        : `inscription impossible: ${createError?.message}`,
    });
    return;
  }

  const existing = await getMembership(created.user.id, school.id);
  if (existing) {
    res.status(409).json({ error: "vous êtes déjà inscrit dans cet établissement" });
    return;
  }

  const membership = await createMembership({
    userId: created.user.id,
    schoolId: school.id,
    role: "etudiant",
    classPerimeterId: perimeter.id,
    validUntil: computeDefaultValidUntil(school.defaultValidityYears),
  });

  res.status(201).json(membership);
}
