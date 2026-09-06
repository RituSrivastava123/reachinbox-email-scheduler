import { Router } from "express";
import { authRouter } from "../controllers/authController";
import { emailRouter } from "../controllers/emailController";
import { senderRouter } from "../controllers/senderController";
import { slackRouter } from "../controllers/slackController";
import { requireAuth } from "../middleware/auth";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/emails", requireAuth, emailRouter);
apiRouter.use("/senders", requireAuth, senderRouter);
apiRouter.use("/slack", slackRouter);
