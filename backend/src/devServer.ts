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
import startHandler from "../api/start";
import endHandler from "../api/end";
import examFileHandler from "../api/exam-file";
import submissionHandler from "../api/submission";
import schoolsHandler from "../api/schools";
import perimetersHandler from "../api/perimeters";
import intervenantsHandler from "../api/intervenants";
import intervenantClassesHandler from "../api/intervenant-classes";
import registerStudentHandler from "../api/register-student";
import renewMembershipHandler from "../api/renew-membership";
import myMembershipsHandler from "../api/my-memberships";
import schoolStatsHandler from "../api/school-stats";
import schoolMembersHandler from "../api/school-members";
import joinOrganizerHandler from "../api/join-organizer";
import myRoomsHandler from "../api/my-rooms";
import mySessionsHandler from "../api/my-sessions";
import roomViolationsHandler from "../api/room-violations";
import { runLifecycleSweep } from "./lib/lifecycleService";

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
// express.static serves public/index.html for GET / by default.
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
mount("/api/start", startHandler);
mount("/api/end", endHandler);
mount("/api/exam-file", examFileHandler);
mount("/api/submission", submissionHandler);
mount("/api/schools", schoolsHandler);
mount("/api/perimeters", perimetersHandler);
mount("/api/intervenants", intervenantsHandler);
mount("/api/intervenant-classes", intervenantClassesHandler);
mount("/api/register-student", registerStudentHandler);
mount("/api/renew-membership", renewMembershipHandler);
mount("/api/my-memberships", myMembershipsHandler);
mount("/api/school-stats", schoolStatsHandler);
mount("/api/school-members", schoolMembersHandler);
mount("/api/join-organizer", joinOrganizerHandler);
mount("/api/my-rooms", myRoomsHandler);
mount("/api/my-sessions", mySessionsHandler);
mount("/api/room-violations", roomViolationsHandler);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
function scheduleLifecycleSweep() {
  runLifecycleSweep()
    .then(({ updated, deleted }) => {
      if (updated || deleted) {
        console.log(`Lifecycle sweep: ${updated} pending_renewal, ${deleted} deleted.`);
      }
    })
    .catch((err) => console.error("Lifecycle sweep failed:", err));
}
scheduleLifecycleSweep();
setInterval(scheduleLifecycleSweep, ONE_DAY_MS);

app.listen(PORT, () => {
  console.log(`Locked dev server listening on http://localhost:${PORT}`);
});
