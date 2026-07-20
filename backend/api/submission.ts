import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import {
  getRoomByCode,
  getSession,
  getSessionsForRoom,
  recordViolation,
  setSubmissionPath,
} from "../src/lib/roomService";
import { sanitizeFilename } from "../src/lib/sanitizeFilename";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * POST: the Windows agent uploads its student's final workbook once the
 * teacher ends the exam (see api/end.ts and the agent's poll on api/session).
 * GET: the teacher dashboard lists every submitted copy for a room, each with
 * a short-lived signed download link — see api/exam-file.ts for why signed
 * URLs are used instead of proxying file bytes.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const { sessionId, fileBase64, filename } = req.body ?? {};
    if (!sessionId || !fileBase64) {
      res.status(400).json({ error: "sessionId and fileBase64 are required" });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }

    const buffer = Buffer.from(fileBase64, "base64");
    const name = sanitizeFilename(filename ?? `${session.studentName}.xlsx`);
    const path = `${session.roomId}/${session.id}-${name}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("submissions")
      .upload(path, buffer, { upsert: true });
    if (uploadError) {
      res.status(500).json({ error: `upload failed: ${uploadError.message}` });
      return;
    }

    await setSubmissionPath(sessionId, path);
    await recordViolation(sessionId, session.roomId, "submitted", { filename: name });
    res.status(201).json({ ok: true });
    return;
  }

  if (req.method === "GET") {
    const code = String(req.query.code ?? "");
    if (!code) {
      res.status(400).json({ error: "code query param is required" });
      return;
    }
    const room = await getRoomByCode(code);
    if (!room) {
      res.status(404).json({ error: "room not found" });
      return;
    }

    const sessions = await getSessionsForRoom(room.id);
    const submissions = await Promise.all(
      sessions
        .filter((s) => s.submissionPath)
        .map(async (s) => {
          const { data, error } = await supabaseAdmin.storage
            .from("submissions")
            .createSignedUrl(s.submissionPath as string, SIGNED_URL_TTL_SECONDS);
          return {
            sessionId: s.id,
            studentName: s.studentName,
            url: error || !data ? null : data.signedUrl,
          };
        })
    );

    res.status(200).json({ submissions });
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
