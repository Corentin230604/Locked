import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import { getRoomById, getSession, listRoomCoOrganizerIds } from "../src/lib/roomService";
import { getMembership, getMembershipById, getPerimeterById, getSchoolById } from "../src/lib/schoolService";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * The panel opened by clicking a student's name in the participants table:
 * their école/promo (via membershipId, when the join wasn't anonymous), a
 * signed link to their submitted copy if any, and a count of screenshots so
 * the dashboard knows whether to show the "captures" shortcut at all. Same
 * access rule as room-violations.ts/room-screenshots.ts.
 */
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

  const sessionId = String(req.query.sessionId ?? "");
  if (!sessionId) {
    res.status(400).json({ error: "sessionId query param is required" });
    return;
  }

  const session = await getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  const room = await getRoomById(session.roomId);
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  if (!(await isPlatformAdmin(caller.userId)) && room.schoolId) {
    const membership = await getMembership(caller.userId, room.schoolId);
    const isCreator = membership && membership.id === room.createdByMembershipId;
    const coOrganizerIds = await listRoomCoOrganizerIds(room.id);
    const isCoOrganizer = coOrganizerIds.includes(caller.userId);
    if (!isCreator && !isCoOrganizer) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }

  let schoolName: string | null = null;
  let className: string | null = null;
  if (session.membershipId) {
    const studentMembership = await getMembershipById(session.membershipId);
    if (studentMembership) {
      const school = await getSchoolById(studentMembership.schoolId);
      schoolName = school?.name ?? null;
      className = studentMembership.classPerimeterId
        ? (await getPerimeterById(studentMembership.classPerimeterId))?.name ?? null
        : null;
    }
  }

  let submissionUrl: string | null = null;
  if (session.submissionPath) {
    const { data } = await supabaseAdmin.storage
      .from("submissions")
      .createSignedUrl(session.submissionPath, SIGNED_URL_TTL_SECONDS);
    submissionUrl = data?.signedUrl ?? null;
  }

  const { count: screenshotCount } = await supabaseAdmin
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("type", "screenshot");

  res.status(200).json({
    session,
    schoolName,
    className,
    submissionUrl,
    screenshotCount: screenshotCount ?? 0,
  });
}
