import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "../queues/emailQueue";
import { reconciliationQueue } from "../queues/reconciliationQueue";
import { config } from "../config";

/**
 * A real, live Bull Board dashboard backed directly by the same BullMQ Queue
 * instances the API and worker use -- it reflects actual queue state
 * (waiting/delayed/active/completed/failed jobs), not a mock UI.
 *
 * Protected with HTTP Basic Auth (BULL_BOARD_USER / BULL_BOARD_PASSWORD) so
 * it isn't left wide open even in a local demo.
 */
export function buildBullBoardRouter(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [new BullMQAdapter(emailQueue) as any, new BullMQAdapter(reconciliationQueue) as any],
    serverAdapter,
  });

  const router = Router();

  router.use((req, res, next) => {
    const header = req.headers.authorization;
    const expected =
      "Basic " + Buffer.from(`${config.bullBoard.user}:${config.bullBoard.password}`).toString("base64");

    if (header === expected) {
      next();
      return;
    }

    res.set("WWW-Authenticate", 'Basic realm="Bull Board"');
    res.status(401).send("Authentication required");
  });

  router.use("/", serverAdapter.getRouter());
  return router;
}
