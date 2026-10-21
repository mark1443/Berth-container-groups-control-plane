import {
  AddGroupMemberBody,
  CreateGroupApplyBody,
  CreateGroupApplyHeader,
  CreateGroupBody,
  ListGroupsQueryParams,
  PatchGroupConfigBody,
  PatchMemberConfigBody,
  UpdateGroupBody,
  UpdateGroupMemberBody,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { db } from "../lib/db";
import { parseWith } from "../lib/validate";
import { actorOf } from "../middlewares/requireOperator";
import { liveAllocations } from "../services/allocator";
import { getGroupConfig, getMemberConfig, getMemberEnv, patchGroupConfig, patchMemberConfig } from "../services/config";
import {
  addMember,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  loadGroupBundle,
  removeMember,
  updateGroup,
  updateMember,
} from "../services/groups";
import { createApply } from "../services/operations";
import { computePlan } from "../services/plan";

const router: IRouter = Router();

router.get("/groups", async (req, res) => {
  const q = parseWith(ListGroupsQueryParams, req.query, "query");
  res.json(
    await listGroups(
      { page: q.page, pageSize: q.pageSize, offset: (q.page - 1) * q.pageSize },
      { providerId: q.providerId, status: q.status },
    ),
  );
});

router.post("/groups", async (req, res) => {
  const body = parseWith(CreateGroupBody, req.body);
  res.status(201).json(await createGroup(body, actorOf(req)));
});

router.get("/groups/:groupId", async (req, res) => {
  res.json(await getGroup(req.params.groupId));
});

router.patch("/groups/:groupId", async (req, res) => {
  const body = parseWith(UpdateGroupBody, req.body);
  res.json(await updateGroup(req.params.groupId, body, actorOf(req)));
});

router.delete("/groups/:groupId", async (req, res) => {
  await deleteGroup(req.params.groupId, actorOf(req));
  res.status(204).end();
});

// Members -------------------------------------------------------------------

router.post("/groups/:groupId/members", async (req, res) => {
  const body = parseWith(AddGroupMemberBody, req.body);
  res.status(201).json(await addMember(req.params.groupId, body, actorOf(req)));
});

router.patch("/groups/:groupId/members/:memberId", async (req, res) => {
  const body = parseWith(UpdateGroupMemberBody, req.body);
  res.json(await updateMember(req.params.groupId, req.params.memberId, body, actorOf(req)));
});

router.delete("/groups/:groupId/members/:memberId", async (req, res) => {
  await removeMember(req.params.groupId, req.params.memberId, actorOf(req));
  res.status(204).end();
});

// Ports ---------------------------------------------------------------------

router.get("/groups/:groupId/ports", async (req, res) => {
  await loadGroupBundle(req.params.groupId);
  const rows = await liveAllocations(db, req.params.groupId);
  res.json({
    data: rows.map((a) => ({
      id: a.id,
      providerId: a.providerId,
      groupId: a.groupId,
      memberId: a.memberId,
      hostPort: a.hostPort,
      protocol: a.protocol,
      state: a.state,
      createdAt: a.createdAt,
      releasedAt: a.releasedAt,
    })),
  });
});

// Config --------------------------------------------------------------------

router.get("/groups/:groupId/config", async (req, res) => {
  res.json({ data: await getGroupConfig(req.params.groupId) });
});

router.patch("/groups/:groupId/config", async (req, res) => {
  const body = parseWith(PatchGroupConfigBody, req.body);
  res.json({ data: await patchGroupConfig(req.params.groupId, body, actorOf(req)) });
});

router.get("/groups/:groupId/members/:memberId/config", async (req, res) => {
  res.json({ data: await getMemberConfig(req.params.groupId, req.params.memberId) });
});

router.patch("/groups/:groupId/members/:memberId/config", async (req, res) => {
  const body = parseWith(PatchMemberConfigBody, req.body);
  res.json({ data: await patchMemberConfig(req.params.groupId, req.params.memberId, body, actorOf(req)) });
});

router.get("/groups/:groupId/members/:memberId/env", async (req, res) => {
  res.json(await getMemberEnv(req.params.groupId, req.params.memberId));
});

// Plan & apply --------------------------------------------------------------

router.get("/groups/:groupId/plan", async (req, res) => {
  const bundle = await loadGroupBundle(req.params.groupId);
  res.json((await computePlan(bundle)).plan);
});

router.post("/groups/:groupId/applies", async (req, res) => {
  const header = parseWith(
    CreateGroupApplyHeader,
    { "Idempotency-Key": req.get("Idempotency-Key") },
    "header",
  );
  const body = parseWith(CreateGroupApplyBody, req.body ?? {});
  const result = await createApply(req.params.groupId, header["Idempotency-Key"], body, actorOf(req));
  res.status(result.replayed ? 200 : 202).json(result.operation);
});

export default router;
