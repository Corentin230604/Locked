import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller } from "../src/lib/authContext";
import { getRoomByCode, getRoomTargetClassIds, joinRoom } from "../src/lib/roomService";
import { computeEffectiveStatus, getMembership, getSchoolById } from "../src/lib/schoolService";

/**
 * A room with no target classes (the legacy/standalone flow) accepts anyone
 * with the code, exactly as before — no login required. A room that DOES
 * target specific classes requires the joining student to be authenticated
 * and to belong to one of those classes: code + wrong class = refused, even
 * though the code itself was valid (see the design discussion on why this
 * matters even without a "cheating incentive" — leaked subject content,
 * dashboard noise).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { code, studentName } = req.body ?? {};
  if (!code || !studentName) {
    res.status(400).json({ error: "code and studentName are required" });
    return;
  }

  const room = await getRoomByCode(code);
  if (!room) {
    res.status(404).json({ error: "room not found or closed" });
    return;
  }

  let membershipId: string | undefined;
  const targetClassIds = room.schoolId ? await getRoomTargetClassIds(room.id) : [];

  if (targetClassIds.length > 0) {
    const caller = await getCaller(req);
    if (!caller) {
      res.status(401).json({ error: "cette room est réservée à une classe précise — connectez-vous" });
      return;
    }

    const membership = await getMembership(caller.userId, room.schoolId!);
    if (!membership || membership.role !== "etudiant" || !membership.classPerimeterId) {
      res.status(403).json({ error: "vous n'êtes pas inscrit dans une classe de cet établissement" });
      return;
    }
    if (!targetClassIds.includes(membership.classPerimeterId)) {
      res.status(403).json({ error: "cette room n'est pas destinée à votre classe" });
      return;
    }

    const school = await getSchoolById(room.schoolId!);
    const effectiveStatus = computeEffectiveStatus(membership.validUntil, school?.defaultGracePeriodDays ?? 60);
    if (effectiveStatus !== "active") {
      res.status(402).json({
        error:
          "Votre abonnement n'est plus actif. Contactez l'administrateur de votre établissement pour le renouveler.",
        code: "no_active_subscription",
        effectiveStatus,
      });
      return;
    }

    membershipId = membership.id;
  }

  const result = await joinRoom(code, studentName, membershipId);
  if (!result) {
    res.status(404).json({ error: "room not found or closed" });
    return;
  }

  res.status(201).json({
    sessionId: result.session.id,
    roomId: result.room.id,
    config: result.room.config,
    lifecycle: result.room.lifecycle,
    examFileAvailable: Boolean(result.room.examFilePath),
    isTest: result.room.isTest,
  });
}
