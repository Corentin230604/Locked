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
 * Express entrypoint mounting the same handler functions Vercel's serverless
 * runtime would run — single source of truth for the API logic. Used for
 * local dev (`npm run dev`, via ts-node-dev) and as the production server on
 * any platform that runs a persistent process instead of serverless
 * functions (Fly.io, Railway, Render, ...). Express's req/res are
 * structurally compatible with VercelRequest/Response for the subset of
 * members these handlers use (method, query, body, status/json).
 */
const PORT = Number(process.env.PORT ?? 4000);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // screenshots arrive as base64 JSON
// process.cwd() (not __dirname) so this resolves the same way whether run
// via ts-node-dev on src/devServer.ts or as compiled dist/src/devServer.js —
// both are started with the backend/ directory as the working directory.
app.use("/", express.static(path.join(process.cwd(), "public")));

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
