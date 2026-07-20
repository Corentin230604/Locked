import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import { getRoomById, getSession, setExamFile } from "../src/lib/roomService";
import { sanitizeFilename } from "../src/lib/sanitizeFilename";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * POST: teacher uploads the workbook students will work from, at room
 * creation or any time before the exam starts.
 * GET: the Windows agent asks for a short-lived download link for its
 * room's exam file (never given direct Storage credentials — see
 * supabaseAdmin.ts's comment on why the service-role key stays server-side).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const { roomId, fileBase64, filename } = req.body ?? {};
    if (!roomId || !fileBase64) {
      res.status(400).json({ error: "roomId and fileBase64 are required" });
      return;
    }

    const room = await getRoomById(roomId);
    if (!room) {
      res.status(404).json({ error: "room not found" });
      return;
    }

    const buffer = Buffer.from(fileBase64, "base64");
    const path = `${roomId}/${sanitizeFilename(filename ?? "classeur.xlsx")}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("exam-files")
      .upload(path, buffer, { upsert: true });
    if (uploadError) {
      res.status(500).json({ error: `upload failed: ${uploadError.message}` });
      return;
    }

    await setExamFile(roomId, path);
    res.status(201).json({ ok: true });
    return;
  }

  if (req.method === "GET") {
    const sessionId = String(req.query.sessionId ?? "");
    if (!sessionId) {
      res.status(400).json({ error: "sessionId query param is required" });
      return;
    }
    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const room = await getRoomById(session.roomId);
    if (!room?.examFilePath) {
      res.status(404).json({ error: "no exam file for this room" });
      return;
    }

    const { data, error } = await supabaseAdmin.storage
      .from("exam-files")
      .createSignedUrl(room.examFilePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      res.status(500).json({ error: `could not sign url: ${error?.message}` });
      return;
    }

    res.status(200).json({ url: data.signedUrl, filename: room.examFilePath.split("/").pop() });
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
