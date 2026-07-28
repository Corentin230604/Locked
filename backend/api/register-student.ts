import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import {
  computeDefaultValidUntil,
  createMembership,
  getMembership,
  getPerimeterByJoinCode,
  getSchoolById,
} from "../src/lib/schoolService";

// Same anon key committed across every dashboard/agent in this repo (see
// e.g. dashboard.html's comment) — it's meant to be public, protected by RLS,
// unlike the service-role key. Used here (not supabaseAdmin) specifically
// because Supabase only auto-sends its confirmation email for signups made
// through this public endpoint — the admin API's createUser() never sends
// one no matter how emailConfirm is set, which is what let an unconfirmed,
// unowned email in through the front door before this change.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthY2pxcHFwcGNxdGR5ZWJkcHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDQzNzAsImV4cCI6MjA5OTc4MDM3MH0.IoOLViEXo8JAHgF3QVlLiWDrIyUAq5_kGBisZjG8RpI";

/**
 * Student self-registration: school email + class code + name + password.
 * The class code (created by the school for a specific classe perimeter)
 * and the email-domain check together prove the *school* authorized this
 * account — but neither proves the student actually controls the mailbox
 * they typed in (a class code is meant to be shared with a whole class, so
 * it isn't really a secret). That's what the confirmation email below is
 * for: Supabase requires it to be clicked before the account can sign in.
 * Requires "Confirm email" enabled in the Supabase project's Auth settings,
 * and a custom SMTP provider configured there (Resend/SendGrid/Postmark) —
 * Supabase's own built-in mailer has a low hourly rate limit unsuited to a
 * whole class registering around the same time.
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

  const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { name } }),
  });
  const signupBody: any = await signupRes.json().catch(() => ({}));

  if (!signupRes.ok || !signupBody?.id) {
    const message = String(signupBody?.msg ?? signupBody?.error_description ?? signupBody?.error ?? "");
    const alreadyExists = message.toLowerCase().includes("already");
    res.status(alreadyExists ? 409 : 500).json({
      error: alreadyExists
        ? "un compte existe déjà avec cet email — connectez-vous plutôt"
        : `inscription impossible: ${message || "erreur inconnue"}`,
    });
    return;
  }

  const userId = signupBody.id as string;

  const existing = await getMembership(userId, school.id);
  if (existing) {
    res.status(409).json({ error: "vous êtes déjà inscrit dans cet établissement" });
    return;
  }

  const membership = await createMembership({
    userId,
    schoolId: school.id,
    role: "etudiant",
    classPerimeterId: perimeter.id,
    validUntil: computeDefaultValidUntil(school.defaultValidityYears),
  });

  // The membership exists right away, but the account itself can't sign in
  // until the student clicks the confirmation link Supabase just emailed —
  // see JoinWindow.xaml.cs/JoinWindowController.swift's handling of the
  // resulting "email not confirmed" sign-in error.
  res.status(201).json({ ...membership, emailConfirmationRequired: true });
}
