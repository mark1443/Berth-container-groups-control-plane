import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import { errorHandler, notFoundHandler } from "./lib/errors";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
