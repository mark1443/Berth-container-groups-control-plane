import { ListOperationsQueryParams } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { parseWith } from "../lib/validate";
import { getOperation, listOperations } from "../services/operations";

const router: IRouter = Router();

router.get("/operations", async (req, res) => {
  const q = parseWith(ListOperationsQueryParams, req.query, "query");
  res.json(
    await listOperations(
      { page: q.page, pageSize: q.pageSize, offset: (q.page - 1) * q.pageSize },
      { groupId: q.groupId, state: q.state },
    ),
  );
});

router.get("/operations/:operationId", async (req, res) => {
  res.json(await getOperation(req.params.operationId));
});

export default router;
