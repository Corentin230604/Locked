export type ScreenshotIntervalMode = "fixed" | "random";

export interface ScreenshotConfig {
  enabled: boolean;
  intervalMode: ScreenshotIntervalMode;
  intervalSeconds: number;
  /** Only used when intervalMode === "random": actual interval is intervalSeconds +/- jitterSeconds */
  jitterSeconds: number;
}

export interface RoomConfig {
  examTitle: string;
  /** Seconds the student has to return to Excel before auto-exclusion */
  countdownSeconds: number;
  screenshot: ScreenshotConfig;
}

export type RoomStatus = "open" | "closed";

export interface Room {
  id: string;
  code: string;
  teacherName: string;
  config: RoomConfig;
  status: RoomStatus;
  createdAt: string;
}

export type SessionStatus = "active" | "excluded" | "disconnected" | "left";

export interface StudentSession {
  id: string;
  roomId: string;
  studentName: string;
  status: SessionStatus;
  joinedAt: string;
  lastSeen: string;
  socketId?: string;
}

export type ViolationType =
  | "focus_lost"
  | "focus_returned"
  | "excluded"
  | "screenshot"
  | "ai_flag"
  | "joined"
  | "disconnected";

export interface ViolationEvent {
  id: string;
  sessionId: string;
  type: ViolationType;
  timestamp: string;
  payload?: Record<string, unknown>;
}
