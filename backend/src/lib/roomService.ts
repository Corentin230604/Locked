import { supabaseAdmin } from "./supabaseAdmin";

export interface ScreenshotConfig {
  enabled: boolean;
  /** 1-60: how many captures to take per minute, at random moments within
   * each 60-second window (not evenly spaced) — see screenshotAnalyzer.ts's
   * caller in the Windows agent for the scheduling logic. */
  perMinute: number;
}

export interface RoomConfig {
  examTitle: string;
  countdownSeconds: number;
  screenshot: ScreenshotConfig;
}

/** Derived from scheduled_start_at / started_at / ended_at — never stored
 * directly, always recomputed from the raw timestamps so a scheduled start
 * time doesn't need a cron job to "flip" anything. */
export type RoomLifecycle = "waiting" | "started" | "ended";

export interface Room {
  id: string;
  code: string;
  teacherName: string;
  config: RoomConfig;
  status: "open" | "closed";
  lifecycle: RoomLifecycle;
  scheduledStartAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  examFilePath: string | null;
  /** All restrictions apply exactly as in a real exam, but the Windows agent
   * shows a floating "Quitter le test" button so testers aren't locked out
   * of their own PC. */
  isTest: boolean;
  /** null = standalone room, not tied to any school (the original,
   * pre-multi-tenant flow keeps working unchanged). */
  schoolId: string | null;
  createdByMembershipId: string | null;
  /** Distinct from `code` (the student join code) — lets another
   * intervenant join as a ponctual co-organizer, see api/join-organizer.ts.
   * Only generated for school-scoped rooms. */
  coOrganizerCode: string | null;
  createdAt: string;
}

export type SessionStatus = "active" | "excluded" | "disconnected" | "left";

/** Set together with `leftAt` the moment a session reaches a terminal state
 * — "completed" is the only non-anomalous one (room ended while the student
 * was still present); every other value pairs with a specific `status`. */
export type ExitReason =
  | "completed"
  | "manual_exclusion"
  | "focus_timeout"
  | "heartbeat_timeout"
  | "test_exit";

export interface Session {
  id: string;
  roomId: string;
  studentName: string;
  status: SessionStatus;
  joinedAt: string;
  lastSeen: string;
  /** Null while the student is still in the room. */
  leftAt: string | null;
  exitReason: ExitReason | null;
  /** Client IP at join time (see lib/network.ts) — informational once a
   * room has no network restriction configured, enforced otherwise. */
  joinIp: string | null;
  submissionPath: string | null;
  membershipId: string | null;
}

export type ViolationType =
  | "focus_lost"
  | "focus_returned"
  | "excluded"
  | "screenshot"
  | "ai_flag"
  | "joined"
  | "submitted"
  | "disconnected"
  | "test_exit";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function generateRoomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function computeLifecycle(row: any): RoomLifecycle {
  if (row.ended_at) return "ended";
  if (row.started_at) return "started";
  if (row.scheduled_start_at && new Date(row.scheduled_start_at).getTime() <= Date.now()) {
    return "started";
  }
  return "waiting";
}

function toRoom(row: any): Room {
  return {
    id: row.id,
    code: row.code,
    teacherName: row.teacher_name,
    status: row.status,
    lifecycle: computeLifecycle(row),
    scheduledStartAt: row.scheduled_start_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    examFilePath: row.exam_file_path,
    isTest: Boolean(row.is_test),
    schoolId: row.school_id,
    createdByMembershipId: row.created_by_membership_id,
    coOrganizerCode: row.co_organizer_code,
    createdAt: row.created_at,
    config: {
      examTitle: row.exam_title,
      countdownSeconds: row.countdown_seconds,
      screenshot: {
        enabled: row.screenshot_enabled,
        perMinute: row.screenshot_per_minute,
      },
    },
  };
}

function toSession(row: any): Session {
  return {
    id: row.id,
    roomId: row.room_id,
    studentName: row.student_name,
    status: row.status,
    joinedAt: row.joined_at,
    lastSeen: row.last_seen,
    leftAt: row.left_at,
    exitReason: row.exit_reason,
    joinIp: row.join_ip,
    submissionPath: row.submission_path,
    membershipId: row.membership_id,
  };
}

export async function createRoom(
  teacherName: string,
  partialConfig: Partial<RoomConfig> = {},
  scheduledStartAt?: string,
  isTest = false,
  schoolId?: string,
  createdByMembershipId?: string
): Promise<Room> {
  const config: RoomConfig = {
    examTitle: partialConfig.examTitle ?? "Examen",
    countdownSeconds: partialConfig.countdownSeconds ?? 15,
    screenshot: {
      enabled: partialConfig.screenshot?.enabled ?? true,
      perMinute: clamp(partialConfig.screenshot?.perMinute ?? 10, 1, 60),
    },
  };

  // Retry on the rare code collision (unique constraint on `code` and, when
  // school-scoped, `co_organizer_code` too).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const coOrganizerCode = schoolId ? generateRoomCode(8) : null;
    const { data, error } = await supabaseAdmin
      .from("rooms")
      .insert({
        code,
        teacher_name: teacherName,
        exam_title: config.examTitle,
        countdown_seconds: config.countdownSeconds,
        screenshot_enabled: config.screenshot.enabled,
        screenshot_per_minute: config.screenshot.perMinute,
        scheduled_start_at: scheduledStartAt ?? null,
        is_test: isTest,
        school_id: schoolId ?? null,
        created_by_membership_id: createdByMembershipId ?? null,
        co_organizer_code: coOrganizerCode,
      })
      .select()
      .single();

    if (!error) return toRoom(data);
    if (error.code !== "23505") throw error; // not a unique-violation, don't retry
  }
  throw new Error("Could not generate a unique room code after 5 attempts.");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function getRoomByCode(code: string): Promise<Room | null> {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select()
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data ? toRoom(data) : null;
}

export async function getRoomById(roomId: string): Promise<Room | null> {
  const { data, error } = await supabaseAdmin.from("rooms").select().eq("id", roomId).maybeSingle();
  if (error) throw error;
  return data ? toRoom(data) : null;
}

export async function joinRoom(
  code: string,
  studentName: string,
  membershipId?: string,
  joinIp?: string | null
): Promise<{ room: Room; session: Session } | null> {
  const room = await getRoomByCode(code);
  if (!room || room.status !== "open") return null;

  const { data, error } = await supabaseAdmin
    .from("sessions")
    .insert({
      room_id: room.id,
      student_name: studentName,
      membership_id: membershipId ?? null,
      join_ip: joinIp ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const session = toSession(data);
  await recordViolation(session.id, room.id, "joined", { studentName });
  return { room, session };
}

/** Classes a room targets — empty means no class restriction (the
 * legacy/standalone behavior: anyone with the code can join). */
export async function getRoomTargetClassIds(roomId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("room_target_classes")
    .select("perimeter_id")
    .eq("room_id", roomId);
  if (error) throw error;
  return (data ?? []).map((row: any) => row.perimeter_id);
}

export async function setRoomTargetClasses(roomId: string, perimeterIds: string[]): Promise<void> {
  if (perimeterIds.length === 0) return;
  const rows = perimeterIds.map((perimeterId) => ({ room_id: roomId, perimeter_id: perimeterId }));
  const { error } = await supabaseAdmin.from("room_target_classes").insert(rows);
  if (error) throw error;
}

/** Intervenants added as ponctual co-surveillants of one specific room
 * (multi-class partiels), without touching their normal class assignments. */
export async function addRoomCoOrganizers(roomId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const rows = userIds.map((userId) => ({ room_id: roomId, user_id: userId }));
  const { error } = await supabaseAdmin.from("room_co_organizers").insert(rows);
  if (error) throw error;
}

export async function listRoomCoOrganizerIds(roomId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("room_co_organizers")
    .select("user_id")
    .eq("room_id", roomId);
  if (error) throw error;
  return (data ?? []).map((row: any) => row.user_id);
}

export async function getRoomByCoOrganizerCode(code: string): Promise<Room | null> {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select()
    .eq("co_organizer_code", code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data ? toRoom(data) : null;
}

/** Every room an intervenant either created or was added to as a ponctual
 * co-organizer, scoped to one school — feeds the intervenant space's
 * "Historique" view. */
export async function getRoomsForIntervenant(schoolId: string, membershipId: string, userId: string): Promise<Room[]> {
  const [createdResult, coOrganizedResult] = await Promise.all([
    supabaseAdmin
      .from("rooms")
      .select()
      .eq("school_id", schoolId)
      .eq("created_by_membership_id", membershipId),
    supabaseAdmin.from("room_co_organizers").select("room_id").eq("user_id", userId),
  ]);
  if (createdResult.error) throw createdResult.error;
  if (coOrganizedResult.error) throw coOrganizedResult.error;

  const coOrganizedRoomIds = (coOrganizedResult.data ?? []).map((row: any) => row.room_id);
  let coOrganizedRooms: any[] = [];
  if (coOrganizedRoomIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("rooms")
      .select()
      .eq("school_id", schoolId)
      .in("id", coOrganizedRoomIds);
    if (error) throw error;
    coOrganizedRooms = data ?? [];
  }

  const byId = new Map<string, any>();
  for (const row of [...(createdResult.data ?? []), ...coOrganizedRooms]) byId.set(row.id, row);
  return Array.from(byId.values())
    .map(toRoom)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** A student's own room history across every school they've ever joined a
 * room in — feeds the Windows agent's post-login dashboard. */
export async function getSessionHistoryForMemberships(
  membershipIds: string[]
): Promise<Array<Session & { room: Room }>> {
  if (membershipIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("*, rooms(*)")
    .in("membership_id", membershipIds)
    .order("joined_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...toSession(row), room: toRoom(row.rooms) }));
}

export interface Violation {
  id: string;
  sessionId: string;
  roomId: string;
  type: ViolationType;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

/** Full event log for one room — Realtime only delivers *new* violations, so
 * a finished room's history needs this REST snapshot instead. */
export async function getViolationsForRoom(roomId: string): Promise<Violation[]> {
  const { data, error } = await supabaseAdmin
    .from("violations")
    .select()
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    type: row.type,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select()
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? toSession(data) : null;
}

export async function getSessionsForRoom(roomId: string): Promise<Session[]> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select()
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toSession);
}

/** Every path that ends a student's participation (exclusion, disconnection,
 * test exit, room ending normally) goes through here so `leftAt`/`exitReason`
 * are always set together — this is what lets the history view render a
 * definitive, color-coded reason for every departure instead of just the
 * raw `status`. */
export async function finalizeSessionExit(
  sessionId: string,
  status: SessionStatus,
  exitReason: ExitReason
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ status, exit_reason: exitReason, left_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function touchSession(sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ last_seen: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function recordViolation(
  sessionId: string,
  roomId: string,
  type: ViolationType,
  payload?: Record<string, unknown>
): Promise<{ id: string; createdAt: string }> {
  const { data, error } = await supabaseAdmin
    .from("violations")
    .insert({ session_id: sessionId, room_id: roomId, type, payload: payload ?? null })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, createdAt: data.created_at };
}

/** Teacher-triggered exclusion from the dashboard "Exclure" button. */
export async function excludeSession(sessionId: string): Promise<Session | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  await finalizeSessionExit(sessionId, "excluded", "manual_exclusion");
  await recordViolation(sessionId, session.roomId, "excluded", {
    reason: "manual_teacher_action",
  });
  return session;
}

/** Teacher clicks "Démarrer l'examen" — flips every waiting student straight
 * to fullscreen + full monitoring on their next poll (see api/session.ts). */
export async function startRoom(roomId: string): Promise<Room | null> {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({ started_at: new Date().toISOString() })
    .eq("id", roomId)
    .select()
    .single();
  if (error) throw error;
  return data ? toRoom(data) : null;
}

/** Teacher clicks "Terminer l'examen" — closes the room to new joins and
 * signals every agent (via polling) to save and submit its workbook. */
export async function endRoom(roomId: string): Promise<Room | null> {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({ ended_at: new Date().toISOString(), status: "closed" })
    .eq("id", roomId)
    .select()
    .single();
  if (error) throw error;

  // Anyone still "active" made it to the end without incident — record that
  // explicitly (status stays "active", only leftAt/exitReason are set) so
  // the history view can tell "finished normally" apart from "still in
  // progress" without having to look at the room's own lifecycle too.
  const { error: closeError } = await supabaseAdmin
    .from("sessions")
    .update({ exit_reason: "completed", left_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("status", "active")
    .is("left_at", null);
  if (closeError) throw closeError;

  return data ? toRoom(data) : null;
}

export async function setExamFile(roomId: string, path: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("rooms")
    .update({ exam_file_path: path })
    .eq("id", roomId);
  if (error) throw error;
}

// Agents heartbeat every 15s (see BackendClient.cs/.swift) — 4 missed beats
// is a reliable "this agent is gone" signal without flagging a single
// dropped request as an exit. This closes a real gap: without it, a student
// who kills the agent process (rather than letting focus-loss/exclusion
// catch them) would stay "active" forever, with no exit reason ever
// recorded — an exploitable way to vanish from the room with no trace.
const HEARTBEAT_TIMEOUT_MS = 60_000;

/** Marks sessions whose agent has gone silent as "disconnected". Only
 * touches sessions that are still `active` and haven't already been closed
 * out (`leftAt` null) — a session a room's `endRoom()` already finalized as
 * "completed" keeps that reason even though its heartbeat naturally goes
 * stale right after (the agent quits once the exam ends). */
export async function runSessionTimeoutSweep(): Promise<{ disconnected: number }> {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, room_id")
    .eq("status", "active")
    .is("left_at", null)
    .lt("last_seen", cutoff);
  if (error) throw error;

  for (const row of data ?? []) {
    await finalizeSessionExit(row.id, "disconnected", "heartbeat_timeout");
    await recordViolation(row.id, row.room_id, "disconnected", { reason: "heartbeat_timeout" });
  }
  return { disconnected: (data ?? []).length };
}

export async function setSubmissionPath(sessionId: string, path: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ submission_path: path })
    .eq("id", sessionId);
  if (error) throw error;
}
