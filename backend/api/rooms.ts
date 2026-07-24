import type { VercelRequest, VercelResponse } from "../src/lib/httpTypes";
import { getCaller } from "../src/lib/authContext";
import {
  addRoomCoOrganizers,
  createRoom,
  getRoomByCode,
  setRoomTargetClasses,
} from "../src/lib/roomService";
import { getMembership, isWithinScope, listIntervenantClasses } from "../src/lib/schoolService";

/**
 * POST without schoolId: legacy standalone room, unchanged from before
 * multi-tenant existed — no auth required, anyone with the dashboard can
 * create it, no class restriction on joining.
 *
 * POST with schoolId: the caller must be authenticated and have an
 * intervenant or school_admin membership there. An intervenant may only
 * target classes assigned to them (schoolService.ts's intervenant_classes);
 * a school_admin may target anything within their own perimeter scope.
 * coOrganizerUserIds grants other intervenants ponctual access to *this*
 * room only, for multi-class partiels — see roomService.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const {
      teacherName,
      config,
      scheduledStartAt,
      isTest,
      schoolId,
      targetClassPerimeterIds,
      coOrganizerUserIds,
    } = req.body ?? {};
    if (!teacherName) {
      res.status(400).json({ error: "teacherName is required" });
      return;
    }

    const classIds: string[] = Array.isArray(targetClassPerimeterIds) ? targetClassPerimeterIds : [];
    let createdByMembershipId: string | undefined;

    if (schoolId) {
      const caller = await getCaller(req);
      if (!caller) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      const membership = await getMembership(caller.userId, schoolId);
      if (!membership || (membership.role !== "intervenant" && membership.role !== "school_admin")) {
        res.status(403).json({ error: "forbidden" });
        return;
      }

      if (membership.role === "intervenant") {
        const allowedClasses = new Set((await listIntervenantClasses(membership.id)).map((c) => c.id));
        for (const classId of classIds) {
          if (!allowedClasses.has(classId)) {
            res.status(403).json({ error: `class ${classId} is not one of your assigned classes` });
            return;
          }
        }
      } else {
        for (const classId of classIds) {
          if (!(await isWithinScope(membership.adminPerimeterId, classId))) {
            res.status(403).json({ error: `class ${classId} is outside your scope` });
            return;
          }
        }
      }
      createdByMembershipId = membership.id;
    }

    const room = await createRoom(
      teacherName,
      config ?? {},
      scheduledStartAt ?? undefined,
      Boolean(isTest),
      schoolId ?? undefined,
      createdByMembershipId
    );

    if (classIds.length > 0) {
      await setRoomTargetClasses(room.id, classIds);
    }
    if (Array.isArray(coOrganizerUserIds) && coOrganizerUserIds.length > 0) {
      await addRoomCoOrganizers(room.id, coOrganizerUserIds);
    }

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
