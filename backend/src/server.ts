import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import multer from "multer";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { store } from "./store";
import { RoomConfig } from "./types";

const PORT = Number(process.env.PORT ?? 4000);
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use("/", express.static(path.join(__dirname, "..", "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.params.code, req.params.sessionId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => cb(null, `${Date.now()}.png`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function defaultConfig(partial: Partial<RoomConfig> = {}): RoomConfig {
  return {
    examTitle: partial.examTitle ?? "Examen",
    countdownSeconds: partial.countdownSeconds ?? 15,
    screenshot: {
      enabled: partial.screenshot?.enabled ?? true,
      intervalMode: partial.screenshot?.intervalMode ?? "random",
      intervalSeconds: partial.screenshot?.intervalSeconds ?? 20,
      jitterSeconds: partial.screenshot?.jitterSeconds ?? 5,
    },
  };
}

// --- REST API ---

app.post("/api/rooms", (req, res) => {
  const { teacherName, config } = req.body ?? {};
  if (!teacherName) {
    return res.status(400).json({ error: "teacherName is required" });
  }
  const room = store.createRoom(teacherName, defaultConfig(config));
  res.status(201).json({ roomId: room.id, code: room.code, config: room.config });
});

app.get("/api/rooms/:code", (req, res) => {
  const room = store.getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "room not found" });
  res.json(room);
});

app.get("/api/rooms/:code/sessions", (req, res) => {
  const room = store.getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: "room not found" });
  const sessions = store.getSessionsForRoom(room.id).map((s) => ({
    ...s,
    violations: store.getViolations(s.id),
  }));
  res.json(sessions);
});

app.post("/api/rooms/:code/join", (req, res) => {
  const { studentName } = req.body ?? {};
  if (!studentName) {
    return res.status(400).json({ error: "studentName is required" });
  }
  const result = store.joinRoom(req.params.code, studentName);
  if (!result) return res.status(404).json({ error: "room not found or closed" });

  const { room, session } = result;
  store.recordViolation(session.id, "joined", { studentName });
  io.to(roomChannel(room.code)).emit("dashboard:event", {
    sessionId: session.id,
    studentName: session.studentName,
    type: "joined",
    timestamp: session.joinedAt,
  });

  res.status(201).json({ sessionId: session.id, roomId: room.id, config: room.config });
});

// Screenshot upload. Analysis is a stub for now: wire this handler up to a
// vision model call later; for the MVP it just persists the file and relays
// a "screenshot" event so the dashboard can show a thumbnail/counter.
app.post(
  "/api/rooms/:code/sessions/:sessionId/screenshot",
  upload.single("image"),
  (req, res) => {
    const { code, sessionId } = req.params;
    const room = store.getRoomByCode(code);
    const session = store.getSession(sessionId);
    if (!room || !session || session.roomId !== room.id) {
      return res.status(404).json({ error: "room or session not found" });
    }
    if (!req.file) return res.status(400).json({ error: "image file is required" });

    const event = store.recordViolation(sessionId, "screenshot", {
      file: req.file.filename,
    });
    io.to(roomChannel(room.code)).emit("dashboard:event", {
      sessionId,
      studentName: session.studentName,
      type: "screenshot",
      timestamp: event.timestamp,
      payload: { file: req.file.filename },
    });
    res.status(201).json({ ok: true });
  }
);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

function roomChannel(code: string): string {
  return `room:${code.toUpperCase()}`;
}

interface SocketData {
  code?: string;
  sessionId?: string;
  role?: "agent" | "dashboard";
}

io.on("connection", (socket: Socket<any, any, any, SocketData>) => {
  socket.on("agent:join", ({ code, sessionId }: { code: string; sessionId: string }) => {
    const room = store.getRoomByCode(code);
    const session = store.getSession(sessionId);
    if (!room || !session || session.roomId !== room.id) {
      socket.emit("agent:error", { error: "invalid room or session" });
      return;
    }
    socket.data.code = room.code;
    socket.data.sessionId = sessionId;
    socket.data.role = "agent";
    socket.join(roomChannel(room.code));
    store.touchSession(sessionId, socket.id);

    io.to(roomChannel(room.code)).emit("dashboard:presence", {
      sessionId,
      studentName: session.studentName,
      status: "active",
      lastSeen: session.lastSeen,
    });
  });

  socket.on("dashboard:join", ({ code }: { code: string }) => {
    const room = store.getRoomByCode(code);
    if (!room) {
      socket.emit("dashboard:error", { error: "room not found" });
      return;
    }
    socket.data.code = room.code;
    socket.data.role = "dashboard";
    socket.join(roomChannel(room.code));

    const sessions = store.getSessionsForRoom(room.id).map((s) => ({
      ...s,
      violations: store.getViolations(s.id),
    }));
    socket.emit("dashboard:state", { room, sessions });
  });

  socket.on(
    "agent:event",
    ({ type, payload }: { type: any; payload?: Record<string, unknown> }) => {
      const { sessionId, code } = socket.data;
      if (!sessionId || !code) return;
      const session = store.getSession(sessionId);
      if (!session) return;

      const event = store.recordViolation(sessionId, type, payload);
      if (type === "excluded") {
        store.updateSessionStatus(sessionId, "excluded");
      }

      io.to(roomChannel(code)).emit("dashboard:event", {
        sessionId,
        studentName: session.studentName,
        type,
        timestamp: event.timestamp,
        payload,
      });
    }
  );

  socket.on("agent:heartbeat", () => {
    const { sessionId, code } = socket.data;
    if (!sessionId || !code) return;
    store.touchSession(sessionId);
    const session = store.getSession(sessionId);
    if (!session) return;
    io.to(roomChannel(code)).emit("dashboard:presence", {
      sessionId,
      studentName: session.studentName,
      status: session.status,
      lastSeen: session.lastSeen,
    });
  });

  socket.on("dashboard:exclude", ({ sessionId }: { sessionId: string }) => {
    const { code } = socket.data;
    if (!code) return;
    const session = store.getSession(sessionId);
    if (!session) return;

    store.updateSessionStatus(sessionId, "excluded");
    const event = store.recordViolation(sessionId, "excluded", { reason: "manual_teacher_action" });

    if (session.socketId) {
      io.to(session.socketId).emit("agent:command", { type: "exclude" });
    }
    io.to(roomChannel(code)).emit("dashboard:event", {
      sessionId,
      studentName: session.studentName,
      type: "excluded",
      timestamp: event.timestamp,
      payload: { reason: "manual_teacher_action" },
    });
  });

  socket.on("disconnect", () => {
    const { sessionId, code, role } = socket.data;
    if (role !== "agent" || !sessionId || !code) return;
    const session = store.getSession(sessionId);
    if (!session || session.status === "excluded") return;

    store.updateSessionStatus(sessionId, "disconnected");
    const event = store.recordViolation(sessionId, "disconnected");
    io.to(roomChannel(code)).emit("dashboard:event", {
      sessionId,
      studentName: session.studentName,
      type: "disconnected",
      timestamp: event.timestamp,
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Locked backend listening on http://localhost:${PORT}`);
});
