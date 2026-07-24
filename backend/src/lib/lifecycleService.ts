import { supabaseAdmin } from "./supabaseAdmin";
import { computeEffectiveStatus, getSchoolById } from "./schoolService";

/**
 * Daily sweep: flips memberships whose valid_until has passed into
 * "pending_renewal" (so admins see it), and deletes the ones whose grace
 * period has also elapsed and were never renewed. This only deletes the
 * `school_memberships` row, never the underlying auth.users identity — the
 * person can still log in, they just have no active membership anywhere
 * until a school creates/renews one for them.
 *
 * Run from devServer.ts on a timer — this only works because it's a
 * persistent process (Render, Fly.io, ...). It would silently never fire on
 * a serverless deploy (Vercel) without an external cron hitting an endpoint
 * instead.
 */
export async function runLifecycleSweep(): Promise<{ updated: number; deleted: number }> {
  const { data, error } = await supabaseAdmin.from("school_memberships").select();
  if (error) throw error;

  let updated = 0;
  let deleted = 0;
  const gracePeriodBySchool = new Map<string, number>();

  for (const row of data ?? []) {
    let gracePeriodDays = gracePeriodBySchool.get(row.school_id);
    if (gracePeriodDays === undefined) {
      const school = await getSchoolById(row.school_id);
      gracePeriodDays = school?.defaultGracePeriodDays ?? 60;
      gracePeriodBySchool.set(row.school_id, gracePeriodDays);
    }

    const effective = computeEffectiveStatus(row.valid_until, gracePeriodDays);

    if (effective === "expired") {
      await supabaseAdmin.from("school_memberships").delete().eq("id", row.id);
      deleted++;
    } else if (effective === "pending_renewal" && row.status !== "pending_renewal") {
      await supabaseAdmin.from("school_memberships").update({ status: "pending_renewal" }).eq("id", row.id);
      updated++;
    }
  }

  return { updated, deleted };
}
