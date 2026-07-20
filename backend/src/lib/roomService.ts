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
  createdAt: string;
}

export type SessionStatus = "active" | "excluded" | "disconnected" | "left";

export interface Session {
  id: string;
  roomId: string;
  studentName: string;
  status: SessionStatus;
  joinedAt: string;
  lastSeen: string;
  submissionPath: string | null;
}

export type ViolationType =
  | "focus_lost"
  | "focus_returned"
  | "excluded"
  | "screenshot"
  | "ai_flag"
  | "joined"
  | "submitted"
  | "disconnected";

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
    submissionPath: row.submission_path,
  };
}

export async function createRoom(
  teacherName: string,
  partialConfig: Partial<RoomConfig> = {},
  scheduledStartAt?: string
): Promise<Room> {
  const config: RoomConfig = {
    examTitle: partialConfig.examTitle ?? "Examen",
    countdownSeconds: partialConfig.countdownSeconds ?? 15,
    screenshot: {
      enabled: partialConfig.screenshot?.enabled ?? true,
      perMinute: clamp(partialConfig.screenshot?.perMinute ?? 10, 1, 60),
    },
  };

  // Retry on the rare code collision (unique constraint on `code`).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
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
  studentName: string
): Promise<{ room: Room; session: Session } | null> {
  const room = await getRoomByCode(code);
  if (!room || room.status !== "open") return null;

  const { data, error } = await supabaseAdmin
    .from("sessions")
    .insert({ room_id: room.id, student_name: studentName })
    .select()
    .single();
  if (error) throw error;

  const session = toSession(data);
  await recordViolation(session.id, room.id, "joined", { studentName });
  return { room, session };
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

export async function updateSessionStatus(
  sessionId: string,
  status: SessionStatus
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ status })
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
  await updateSessionStatus(sessionId, "excluded");
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
  return data ? toRoom(data) : null;
}

export async function setExamFile(roomId: string, path: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("rooms")
    .update({ exam_file_path: path })
    .eq("id", roomId);
  if (error) throw error;
}

export async function setSubmissionPath(sessionId: string, path: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ submission_path: path })
    .eq("id", sessionId);
  if (error) throw error;
}
