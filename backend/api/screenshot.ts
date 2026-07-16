import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import { getSession, recordViolation } from "../src/lib/roomService";
import { analyzeScreenshot } from "../src/screenshotAnalyzer";

const AI_FLAG_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Stores one screenshot and runs the AI consistency check. Serverless
 * functions don't keep running once the response is sent, so — unlike the
 * old Socket.IO version — the AI analysis is awaited here rather than
 * fired-and-forgotten; that adds a few seconds to this call, which is fine
 * since the agent uploads screenshots from a background timer, never from
 * something the student is waiting on.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { sessionId, imageBase64 } = req.body ?? {};
  if (!sessionId || !imageBase64) {
    res.status(400).json({ error: "sessionId and imageBase64 are required" });
    return;
  }

  const session = await getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const path = `${session.roomId}/${session.id}/${Date.now()}.png`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("screenshots")
    .upload(path, imageBuffer, { contentType: "image/png" });
  if (uploadError) {
    res.status(500).json({ error: `upload failed: ${uploadError.message}` });
    return;
  }

  await recordViolation(sessionId, session.roomId, "screenshot", { path });

  const analysis = await analyzeScreenshot(imageBuffer);
  if (analysis && analysis.anomaly && analysis.confidence >= AI_FLAG_CONFIDENCE_THRESHOLD) {
    await recordViolation(sessionId, session.roomId, "ai_flag", { ...analysis });
  }

  res.status(201).json({ ok: true });
}
