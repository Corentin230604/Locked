import { randomUUID } from "crypto";
import {
  Room,
  RoomConfig,
  StudentSession,
  ViolationEvent,
  ViolationType,
} from "./types";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid ambiguity

function generateRoomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * In-memory store for the MVP. Swap for a real database (Postgres/Prisma)
 * once the core loop (room -> join -> events -> exclusion) is validated.
 */
class Store {
  private rooms = new Map<string, Room>(); // key: room code
  private sessions = new Map<string, StudentSession>(); // key: session id
  private sessionsByRoom = new Map<string, Set<string>>(); // roomId -> session ids
  private violations = new Map<string, ViolationEvent[]>(); // sessionId -> events

  createRoom(teacherName: string, config: RoomConfig): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();

    const room: Room = {
      id: randomUUID(),
      code,
      teacherName,
      config,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    this.rooms.set(code, room);
    this.sessionsByRoom.set(room.id, new Set());
    return room;
  }

  getRoomByCode(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  joinRoom(code: string, studentName: string): { room: Room; session: StudentSession } | undefined {
    const room = this.getRoomByCode(code);
    if (!room || room.status !== "open") return undefined;

    const session: StudentSession = {
      id: randomUUID(),
      roomId: room.id,
      studentName,
      status: "active",
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    this.sessionsByRoom.get(room.id)!.add(session.id);
    this.violations.set(session.id, []);
    return { room, session };
  }

  getSession(sessionId: string): StudentSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsForRoom(roomId: string): StudentSession[] {
    const ids = this.sessionsByRoom.get(roomId);
    if (!ids) return [];
    return [...ids].map((id) => this.sessions.get(id)!).filter(Boolean);
  }

  updateSessionStatus(sessionId: string, status: StudentSession["status"]): void {
    const session = this.sessions.get(sessionId);
    if (session) session.status = status;
  }

  touchSession(sessionId: string, socketId?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastSeen = new Date().toISOString();
    if (socketId) session.socketId = socketId;
  }

  recordViolation(
    sessionId: string,
    type: ViolationType,
    payload?: Record<string, unknown>
  ): ViolationEvent {
    const event: ViolationEvent = {
      id: randomUUID(),
      sessionId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    const list = this.violations.get(sessionId) ?? [];
    list.push(event);
    this.violations.set(sessionId, list);
    return event;
  }

  getViolations(sessionId: string): ViolationEvent[] {
    return this.violations.get(sessionId) ?? [];
  }
}

export const store = new Store();
