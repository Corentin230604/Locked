import { supabaseAdmin } from "./supabaseAdmin";

export interface School {
  id: string;
  name: string;
  emailDomains: string[];
  defaultValidityYears: number;
  defaultGracePeriodDays: number;
  /** CIDR ranges (e.g. "203.0.113.0/24") a student's IP must fall within to
   * join a room of this school. Empty = no restriction (default). */
  allowedIpRanges: string[];
  createdAt: string;
}

export type PerimeterKind = "campus" | "departement" | "classe" | "group";

export interface Perimeter {
  id: string;
  schoolId: string;
  parentId: string | null;
  name: string;
  kind: PerimeterKind;
  joinCode: string | null;
  createdAt: string;
}

export type MembershipRole = "school_admin" | "intervenant" | "etudiant";
export type MembershipStoredStatus = "active" | "pending_renewal";
export type EffectiveStatus = "active" | "pending_renewal" | "expired";

export interface SchoolMembership {
  id: string;
  userId: string;
  schoolId: string;
  role: MembershipRole;
  adminPerimeterId: string | null;
  classPerimeterId: string | null;
  validFrom: string;
  validUntil: string;
  status: MembershipStoredStatus;
  createdAt: string;
}

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function generateJoinCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

function toSchool(row: any): School {
  return {
    id: row.id,
    name: row.name,
    emailDomains: row.email_domains ?? [],
    defaultValidityYears: row.default_validity_years,
    defaultGracePeriodDays: row.default_grace_period_days,
    allowedIpRanges: row.allowed_ip_ranges ?? [],
    createdAt: row.created_at,
  };
}

function toPerimeter(row: any): Perimeter {
  return {
    id: row.id,
    schoolId: row.school_id,
    parentId: row.parent_id,
    name: row.name,
    kind: row.kind,
    joinCode: row.join_code,
    createdAt: row.created_at,
  };
}

function toMembership(row: any): SchoolMembership {
  return {
    id: row.id,
    userId: row.user_id,
    schoolId: row.school_id,
    role: row.role,
    adminPerimeterId: row.admin_perimeter_id,
    classPerimeterId: row.class_perimeter_id,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** École year runs Sept -> Aug; `years` school years of validity from today
 * lands on the Aug 31st that many school-year-ends away. */
export function computeDefaultValidUntil(validityYears: number): string {
  const now = new Date();
  const currentSchoolYearEndYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const endYear = currentSchoolYearEndYear + (validityYears - 1);
  return `${endYear}-08-31`;
}

/** active while valid_until hasn't passed; pending_renewal during the grace
 * window after it passes (still logs in, but see the "no active
 * subscription" screen); expired once the grace window elapses too — a
 * cleanup job deletes these, see lifecycleService.ts. */
export function computeEffectiveStatus(validUntil: string, gracePeriodDays: number): EffectiveStatus {
  const today = new Date();
  const until = new Date(`${validUntil}T00:00:00Z`);
  if (today.getTime() <= until.getTime()) return "active";
  const graceEnd = new Date(until);
  graceEnd.setUTCDate(graceEnd.getUTCDate() + gracePeriodDays);
  return today.getTime() <= graceEnd.getTime() ? "pending_renewal" : "expired";
}

export async function createSchool(
  name: string,
  emailDomains: string[],
  defaultValidityYears = 1,
  defaultGracePeriodDays = 60
): Promise<School> {
  const { data, error } = await supabaseAdmin
    .from("schools")
    .insert({
      name,
      email_domains: emailDomains,
      default_validity_years: defaultValidityYears,
      default_grace_period_days: defaultGracePeriodDays,
    })
    .select()
    .single();
  if (error) throw error;
  return toSchool(data);
}

export async function listSchools(): Promise<School[]> {
  const { data, error } = await supabaseAdmin.from("schools").select().order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toSchool);
}

export async function getSchoolById(id: string): Promise<School | null> {
  const { data, error } = await supabaseAdmin.from("schools").select().eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toSchool(data) : null;
}

/** Reserved for a full-school admin (adminPerimeterId null) or the platform
 * admin — see api/school-network.ts. A scoped campus/department admin can't
 * change a restriction that applies to the whole school. */
export async function updateSchoolAllowedIpRanges(schoolId: string, allowedIpRanges: string[]): Promise<School> {
  const { data, error } = await supabaseAdmin
    .from("schools")
    .update({ allowed_ip_ranges: allowedIpRanges })
    .eq("id", schoolId)
    .select()
    .single();
  if (error) throw error;
  return toSchool(data);
}

/** Matches an email's domain against every school's allowed domains — used
 * both at student self-registration and to disambiguate which school an
 * établissement code belongs to. */
export async function findSchoolsByEmailDomain(email: string): Promise<School[]> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return [];
  const { data, error } = await supabaseAdmin.from("schools").select().contains("email_domains", [domain]);
  if (error) throw error;
  return (data ?? []).map(toSchool);
}

export async function createPerimeter(
  schoolId: string,
  parentId: string | null,
  name: string,
  kind: PerimeterKind
): Promise<Perimeter> {
  const joinCode = kind === "classe" ? generateJoinCode() : null;
  const { data, error } = await supabaseAdmin
    .from("perimeters")
    .insert({ school_id: schoolId, parent_id: parentId, name, kind, join_code: joinCode })
    .select()
    .single();
  if (error) throw error;
  return toPerimeter(data);
}

export async function getPerimeterById(id: string): Promise<Perimeter | null> {
  const { data, error } = await supabaseAdmin.from("perimeters").select().eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toPerimeter(data) : null;
}

export async function getPerimeterByJoinCode(joinCode: string): Promise<Perimeter | null> {
  const { data, error } = await supabaseAdmin
    .from("perimeters")
    .select()
    .eq("join_code", joinCode.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data ? toPerimeter(data) : null;
}

export async function listPerimetersForSchool(schoolId: string): Promise<Perimeter[]> {
  const { data, error } = await supabaseAdmin
    .from("perimeters")
    .select()
    .eq("school_id", schoolId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toPerimeter);
}

/** Walks a perimeter's ancestor chain (leaf to root) — used to decide
 * whether a target perimeter falls within an admin's assigned scope. */
async function getAncestorChain(perimeterId: string): Promise<Perimeter[]> {
  const chain: Perimeter[] = [];
  let currentId: string | null = perimeterId;
  while (currentId) {
    const node: Perimeter | null = await getPerimeterById(currentId);
    if (!node) break;
    chain.push(node);
    currentId = node.parentId;
  }
  return chain;
}

/** null scope = whole school (always in scope). Otherwise true only if
 * scopePerimeterId is the target itself or one of its ancestors. */
export async function isWithinScope(
  scopePerimeterId: string | null,
  targetPerimeterId: string
): Promise<boolean> {
  if (scopePerimeterId === null) return true;
  const chain = await getAncestorChain(targetPerimeterId);
  return chain.some((node) => node.id === scopePerimeterId);
}

export async function createMembership(params: {
  userId: string;
  schoolId: string;
  role: MembershipRole;
  adminPerimeterId?: string | null;
  classPerimeterId?: string | null;
  validUntil: string;
}): Promise<SchoolMembership> {
  const { data, error } = await supabaseAdmin
    .from("school_memberships")
    .insert({
      user_id: params.userId,
      school_id: params.schoolId,
      role: params.role,
      admin_perimeter_id: params.adminPerimeterId ?? null,
      class_perimeter_id: params.classPerimeterId ?? null,
      valid_until: params.validUntil,
    })
    .select()
    .single();
  if (error) throw error;
  return toMembership(data);
}

export async function getMembership(userId: string, schoolId: string): Promise<SchoolMembership | null> {
  const { data, error } = await supabaseAdmin
    .from("school_memberships")
    .select()
    .eq("user_id", userId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data ? toMembership(data) : null;
}

export async function getMembershipById(id: string): Promise<SchoolMembership | null> {
  const { data, error } = await supabaseAdmin.from("school_memberships").select().eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toMembership(data) : null;
}

export async function listMembershipsForUser(userId: string): Promise<SchoolMembership[]> {
  const { data, error } = await supabaseAdmin.from("school_memberships").select().eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map(toMembership);
}

export async function listMembershipsForSchool(schoolId: string): Promise<SchoolMembership[]> {
  const { data, error } = await supabaseAdmin
    .from("school_memberships")
    .select()
    .eq("school_id", schoolId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toMembership);
}

export async function renewMembership(membershipId: string, validUntil: string): Promise<SchoolMembership | null> {
  const { data, error } = await supabaseAdmin
    .from("school_memberships")
    .update({ valid_until: validUntil, status: "active" })
    .eq("id", membershipId)
    .select()
    .single();
  if (error) throw error;
  return data ? toMembership(data) : null;
}

/** Change an existing membership's role and/or scope — promote/demote,
 * reassign a scoped admin's perimeter, or fix a student's class. Reserved
 * for a full-school admin or the platform admin (see api/update-membership.ts). */
export async function updateMembershipRole(
  membershipId: string,
  updates: { role?: MembershipRole; adminPerimeterId?: string | null; classPerimeterId?: string | null }
): Promise<SchoolMembership | null> {
  const patch: Record<string, unknown> = {};
  if (updates.role !== undefined) patch.role = updates.role;
  if (updates.adminPerimeterId !== undefined) patch.admin_perimeter_id = updates.adminPerimeterId;
  if (updates.classPerimeterId !== undefined) patch.class_perimeter_id = updates.classPerimeterId;

  const { data, error } = await supabaseAdmin
    .from("school_memberships")
    .update(patch)
    .eq("id", membershipId)
    .select()
    .single();
  if (error) throw error;
  return data ? toMembership(data) : null;
}

/** Called by the daily cleanup job when an expired membership crosses into
 * "pending_renewal" (informational only — deletion after the grace period
 * is a separate step, see lifecycleService.ts). */
export async function markPendingRenewal(membershipId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("school_memberships")
    .update({ status: "pending_renewal" })
    .eq("id", membershipId);
  if (error) throw error;
}

export async function deleteMembership(membershipId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("school_memberships").delete().eq("id", membershipId);
  if (error) throw error;
}

export async function assignIntervenantClass(membershipId: string, perimeterId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("intervenant_classes")
    .insert({ membership_id: membershipId, perimeter_id: perimeterId });
  if (error && error.code !== "23505") throw error; // ignore duplicate assignment
}

export async function removeIntervenantClass(membershipId: string, perimeterId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("intervenant_classes")
    .delete()
    .eq("membership_id", membershipId)
    .eq("perimeter_id", perimeterId);
  if (error) throw error;
}

export async function listIntervenantClasses(membershipId: string): Promise<Perimeter[]> {
  const { data, error } = await supabaseAdmin
    .from("intervenant_classes")
    .select("perimeter_id, perimeters(*)")
    .eq("membership_id", membershipId);
  if (error) throw error;
  return (data ?? []).map((row: any) => toPerimeter(row.perimeters));
}

/** Invites an intervenant by email (Supabase Auth sends the activation
 * link — see the note in api/intervenants.ts about SMTP volume limits) and
 * creates their membership right away, referencing the new auth user id. */
export async function inviteIntervenant(params: {
  schoolId: string;
  email: string;
  adminPerimeterId: string | null;
  classPerimeterIds: string[];
  validUntil: string;
}): Promise<SchoolMembership> {
  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(params.email);
  if (inviteError || !invited.user) {
    throw inviteError ?? new Error("invite failed: no user returned");
  }

  const membership = await createMembership({
    userId: invited.user.id,
    schoolId: params.schoolId,
    role: "intervenant",
    validUntil: params.validUntil,
  });

  for (const perimeterId of params.classPerimeterIds) {
    await assignIntervenantClass(membership.id, perimeterId);
  }

  return membership;
}

/** Invites a school_admin by email — same activation-link mechanism as
 * inviteIntervenant. adminPerimeterId null means full-school scope. */
export async function inviteSchoolAdmin(params: {
  schoolId: string;
  email: string;
  adminPerimeterId: string | null;
  validUntil: string;
}): Promise<SchoolMembership> {
  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(params.email);
  if (inviteError || !invited.user) {
    throw inviteError ?? new Error("invite failed: no user returned");
  }

  return createMembership({
    userId: invited.user.id,
    schoolId: params.schoolId,
    role: "school_admin",
    adminPerimeterId: params.adminPerimeterId,
    validUntil: params.validUntil,
  });
}
