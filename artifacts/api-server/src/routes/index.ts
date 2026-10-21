import { Router, type IRouter } from "express";
import { requireOperator } from "../middlewares/requireOperator";
import authRouter from "./auth";
import groupsRouter from "./groups";
import healthRouter from "./health";
import operationsRouter from "./operations";
import overviewRouter from "./overview";
import providersRouter from "./providers";
import workloadsRouter from "./workloads";

const router: IRouter = Router();

// Public: liveness and the sign-in flow itself.
router.use(healthRouter);
router.use(authRouter);

// Everything Berth does requires a signed-in operator (ADR-007).
router.use(requireOperator);
router.use(overviewRouter);
router.use(providersRouter);
router.use(workloadsRouter);
router.use(groupsRouter);
router.use(operationsRouter);

export default router;
