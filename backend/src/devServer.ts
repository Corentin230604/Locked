import path from "path";
import express, { Request, Response } from "express";
import cors from "cors";
import type { VercelRequest, VercelResponse } from "./lib/httpTypes";

import roomsHandler from "../api/rooms";
import joinHandler from "../api/join";
import sessionsHandler from "../api/sessions";
import sessionHandler from "../api/session";
import eventsHandler from "../api/events";
import heartbeatHandler from "../api/heartbeat";
import excludeHandler from "../api/exclude";
import screenshotHandler from "../api/screenshot";

/**
 * Local-only dev server: mounts the exact same handler functions Vercel runs
 * in production, so there's a single source of truth for the API logic.
 * Express's req/res are structurally compatible with VercelRequest/Response
 * for the subset of members these handlers use (method, query, body,
 * status/json).
 */
const PORT = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // screenshots arrive as base64 JSON
app.use("/", express.static(path.join(__dirname, "..", "public")));

function mount(route: string, handler: (req: VercelRequest, res: VercelResponse) => Promise<void>) {
  app.all(route, (req: Request, res: Response) => {
    handler(req as unknown as VercelRequest, res as unknown as VercelResponse).catch((err) => {
      console.error(`Error in ${route}:`, err);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    });
  });
}

mount("/api/rooms", roomsHandler);
mount("/api/join", joinHandler);
mount("/api/sessions", sessionsHandler);
mount("/api/session", sessionHandler);
mount("/api/events", eventsHandler);
mount("/api/heartbeat", heartbeatHandler);
mount("/api/exclude", excludeHandler);
mount("/api/screenshot", screenshotHandler);

app.listen(PORT, () => {
  console.log(`Locked dev server listening on http://localhost:${PORT}`);
});
