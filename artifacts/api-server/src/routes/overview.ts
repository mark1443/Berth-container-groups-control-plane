import { ListEventsQueryParams } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { parseWith } from "../lib/validate";
import { getOverview, listEvents } from "../services/overview";

const router: IRouter = Router();

router.get("/overview", async (_req, res) => {
  res.json(await getOverview());
});

router.get("/events", async (req, res) => {
  const q = parseWith(ListEventsQueryParams, req.query, "query");
  res.json(
    await listEvents(
      { page: q.page, pageSize: q.pageSize, offset: (q.page - 1) * q.pageSize },
      { groupId: q.groupId, providerId: q.providerId },
    ),
  );
});

export default router;
