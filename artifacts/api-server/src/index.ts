import app from "./app";
import { ensureDemoProvider } from "./demo";
import { logger } from "./lib/logger";
import { discoverAll } from "./services/discovery";
import { recoverStaleOperations } from "./services/operations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const DISCOVERY_INTERVAL_MS = Number(process.env.BERTH_DISCOVERY_INTERVAL_MS ?? 30_000);

async function bootstrap() {
  await recoverStaleOperations();
  await ensureDemoProvider();
  startDiscoveryPoller();
}

function startDiscoveryPoller() {
  if (!(DISCOVERY_INTERVAL_MS > 0)) return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await discoverAll();
    } catch (err) {
      logger.error({ err }, "Discovery poll failed");
    } finally {
      running = false;
    }
  }, DISCOVERY_INTERVAL_MS);
  timer.unref();
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  bootstrap().catch((bootErr) => {
    logger.error({ err: bootErr }, "Bootstrap failed; API is up but background work did not start");
  });
});
