import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. " +
      "This key must never be exposed to the browser or the desktop agent — " +
      "it is used server-side only, here."
  );
}

/**
 * Service-role client: bypasses Row Level Security. Only ever imported by
 * the API handlers running on the server (Vercel functions / dev server),
 * never shipped to the dashboard or the Windows agent.
 */
export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
