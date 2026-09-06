import { buildApp } from "./app";
import { config } from "./config";
import { logger } from "./utils/logger";
import { ensureEmailIndex } from "./integrations/elasticsearch/client";
import { prisma } from "./db/prisma";
async function main() {
  void ensureEmailIndex().catch(() => undefined);

  const app = buildApp();

  const server = app.listen(config.port, () => {
    logger.info(`API server listening on http://localhost:${config.port}`);
    logger.info(`Bull Board dashboard: http://localhost:${config.port}/admin/queues`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down API server");
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal error starting API server");
  process.exit(1);
});
