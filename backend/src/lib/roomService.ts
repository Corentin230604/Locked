import { supabaseAdmin } from "./supabaseAdmin";

export interface ScreenshotConfig {
  enabled: boolean;
  intervalMode: "fixed" | "random";
  intervalSeconds: number;
  jitterSeconds: number;
}

export interface RoomConfig {
  examTitle: string;
  countdownSeconds: number;
  screenshot: ScreenshotConfig;
}

export interface Room {
  id: string;
  code: string;
  teacherName: string;
  config: RoomConfig;
  status: "open" | "closed";
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
}

export type ViolationType =
  | "focus_lost"
  | "focus_returned"
  | "excluded"
  | "screenshot"
  | "ai_flag"
  | "joined"
  | "disconnected";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function generateRoomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function toRoom(row: any): Room {
  return {
    id: row.id,
    code: row.code,
    teacherName: row.teacher_name,
    status: row.status,
    createdAt: row.created_at,
    config: {
      examTitle: row.exam_title,
      countdownSeconds: row.countdown_seconds,
      screenshot: {
        enabled: row.screenshot_enabled,
        intervalMode: row.screenshot_interval_mode,
        intervalSeconds: row.screenshot_interval_seconds,
        jitterSeconds: row.screenshot_jitter_seconds,
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
  };
}

export async function createRoom(
  teacherName: string,
  partialConfig: Partial<RoomConfig> = {}
): Promise<Room> {
  const config: RoomConfig = {
    examTitle: partialConfig.examTitle ?? "Examen",
    countdownSeconds: partialConfig.countdownSeconds ?? 15,
    screenshot: {
      enabled: partialConfig.screenshot?.enabled ?? true,
      intervalMode: partialConfig.screenshot?.intervalMode ?? "random",
      intervalSeconds: partialConfig.screenshot?.intervalSeconds ?? 20,
      jitterSeconds: partialConfig.screenshot?.jitterSeconds ?? 5,
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
        screenshot_interval_mode: config.screenshot.intervalMode,
        screenshot_interval_seconds: config.screenshot.intervalSeconds,
        screenshot_jitter_seconds: config.screenshot.jitterSeconds,
      })
      .select()
      .single();

    if (!error) return toRoom(data);
    if (error.code !== "23505") throw error; // not a unique-violation, don't retry
  }
  throw new Error("Could not generate a unique room code after 5 attempts.");
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

/** Teacher-triggered exclusion from the dashboard. */
export async function excludeSession(sessionId: string): Promise<Session | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  await updateSessionStatus(sessionId, "excluded");
  await recordViolation(sessionId, session.roomId, "excluded", {
    reason: "manual_teacher_action",
  });
  return session;
}
