import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { createRoom, getRoomByCode } from "../src/lib/roomService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const { teacherName, config, scheduledStartAt, isTest } = req.body ?? {};
    if (!teacherName) {
      res.status(400).json({ error: "teacherName is required" });
      return;
    }
    const room = await createRoom(
      teacherName,
      config ?? {},
      scheduledStartAt ?? undefined,
      Boolean(isTest)
    );
    res.status(201).json(room);
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
    res.status(200).json(room);
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}
