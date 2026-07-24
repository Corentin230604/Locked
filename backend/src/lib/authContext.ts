import { supabaseAdmin } from "./supabaseAdmin";
import type { VercelRequest } from "./httpTypes";

export interface Caller {
  userId: string;
  email: string | null;
}

/**
 * Resolves the logged-in caller from the `Authorization: Bearer <jwt>` header
 * the dashboard sends with its own Supabase Auth session token. Returns null
 * if missing/invalid — callers must then respond 401. This is the only place
 * a client-supplied JWT is trusted; every authorization decision downstream
 * (which school, which perimeter, which role) is re-derived server-side from
 * this verified user id, never taken from the request body.
 */
export async function getCaller(req: VercelRequest): Promise<Caller | null> {
  const header = req.headers["authorization"] ?? req.headers["Authorization"];
  const value = Array.isArray(header) ? header[0] : header;
  const token = value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null };
}

/** Cross-school access: provisions new schools, sees everything. Just you,
 * for now — see platform_admins table. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
