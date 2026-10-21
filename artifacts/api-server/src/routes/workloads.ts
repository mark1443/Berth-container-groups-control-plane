import { ListWorkloadsQueryParams } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { ValidationError } from "../lib/errors";
import { parseWith } from "../lib/validate";
import { getWorkload, listWorkloads } from "../services/workloads";

const router: IRouter = Router();

router.get("/workloads", async (req, res) => {
  const q = parseWith(ListWorkloadsQueryParams, req.query, "query");
  res.json(
    await listWorkloads(
      { page: q.page, pageSize: q.pageSize, offset: (q.page - 1) * q.pageSize },
      {
        providerId: q.providerId,
        status: q.status,
        managed: readBoolean(req.query.managed),
        search: q.search?.trim() || undefined,
      },
    ),
  );
});

router.get("/workloads/:workloadId", async (req, res) => {
  res.json(await getWorkload(req.params.workloadId));
});

/** `zod.coerce.boolean()` turns the string "false" into true; read the flag by hand. */
function readBoolean(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "true" || raw === true) return true;
  if (raw === "false" || raw === false) return false;
  throw new ValidationError("managed must be true or false", { managed: raw });
}

export default router;
