import {
  CreateProviderBody,
  ListProvidersQueryParams,
  UpdateProviderBody,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { parseWith } from "../lib/validate";
import { actorOf } from "../middlewares/requireOperator";
import { discoverProvider } from "../services/discovery";
import {
  createProvider,
  deleteProvider,
  getPortUsage,
  getProvider,
  listProviders,
  requireProviderRow,
  runConnectivityCheck,
  updateProvider,
} from "../services/providers";

const router: IRouter = Router();

router.get("/providers", async (req, res) => {
  const q = parseWith(ListProvidersQueryParams, req.query, "query");
  res.json(await listProviders({ page: q.page, pageSize: q.pageSize, offset: (q.page - 1) * q.pageSize }, { kind: q.kind }));
});

router.post("/providers", async (req, res) => {
  const body = parseWith(CreateProviderBody, req.body);
  res.status(201).json(await createProvider(body, actorOf(req)));
});

router.get("/providers/:providerId", async (req, res) => {
  res.json(await getProvider(req.params.providerId));
});

router.patch("/providers/:providerId", async (req, res) => {
  const body = parseWith(UpdateProviderBody, req.body);
  res.json(await updateProvider(req.params.providerId, body, actorOf(req)));
});

router.delete("/providers/:providerId", async (req, res) => {
  await deleteProvider(req.params.providerId, actorOf(req));
  res.status(204).end();
});

router.post("/providers/:providerId/connectivity-checks", async (req, res) => {
  const row = await requireProviderRow(req.params.providerId);
  res.json(await runConnectivityCheck(row, actorOf(req)));
});

router.post("/providers/:providerId/discoveries", async (req, res) => {
  const row = await requireProviderRow(req.params.providerId);
  res.json(await discoverProvider(row, actorOf(req)));
});

router.get("/providers/:providerId/port-usage", async (req, res) => {
  res.json(await getPortUsage(req.params.providerId));
});

export default router;
