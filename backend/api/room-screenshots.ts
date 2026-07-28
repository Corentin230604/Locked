import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller, isPlatformAdmin } from "../src/lib/authContext";
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import { getRoomById, getViolationsForRoom, listRoomCoOrganizerIds } from "../src/lib/roomService";
import { getMembership } from "../src/lib/schoolService";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * Every screenshot captured for a room (optionally filtered to one student),
 * each with a short-lived signed URL — the "répertoire des captures IA" the
 * teacher can browse at any time, not just when an AI flag fires. AI-flagged
 * ones carry the flag's reason/confidence alongside the same image, so a
 * flag can be verified visually before excluding anyone. Same access rule as
 * room-violations.ts: reserved for the room's creator, a co-organizer, or
 * the platform admin.
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

  const roomId = String(req.query.roomId ?? "");
  if (!roomId) {
    res.status(400).json({ error: "roomId query param is required" });
    return;
  }

  const room = await getRoomById(roomId);
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  if (!(await isPlatformAdmin(caller.userId)) && room.schoolId) {
    const membership = await getMembership(caller.userId, room.schoolId);
    const isCreator = membership && membership.id === room.createdByMembershipId;
    const coOrganizerIds = await listRoomCoOrganizerIds(roomId);
    const isCoOrganizer = coOrganizerIds.includes(caller.userId);
    if (!isCreator && !isCoOrganizer) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }

  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
  const violations = (await getViolationsForRoom(roomId)).filter(
    (v) => (v.type === "screenshot" || v.type === "ai_flag") && (!sessionId || v.sessionId === sessionId)
  );

  const paths = violations.map((v) => v.payload?.path as string | undefined).filter((p): p is string => Boolean(p));
  const { data: signed, error: signError } =
    paths.length > 0
      ? await supabaseAdmin.storage.from("screenshots").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
      : { data: [], error: null };
  if (signError) {
    res.status(500).json({ error: `could not sign urls: ${signError.message}` });
    return;
  }
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const screenshots = violations.map((v) => {
    const path = v.payload?.path as string | undefined;
    return {
      id: v.id,
      sessionId: v.sessionId,
      type: v.type,
      createdAt: v.createdAt,
      url: path ? urlByPath.get(path) ?? null : null,
      reason: v.type === "ai_flag" ? (v.payload?.reason as string | undefined) ?? null : null,
      confidence: v.type === "ai_flag" ? (v.payload?.confidence as number | undefined) ?? null : null,
    };
  });

  res.status(200).json({ screenshots });
}
