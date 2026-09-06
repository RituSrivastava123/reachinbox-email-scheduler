import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { AuthenticatedUser } from "../types";
import { config } from "../config";
import { prisma } from "../db/prisma";
import {
  buildSlackAuthorizeUrl,
  exchangeSlackCode,
  disconnectSlack,
} from "../integrations/slack/slackClient";
import { logger } from "../utils/logger";

export const slackRouter = Router();

// In-memory or Redis-backed OAuth state store
export const pendingSlackStates = new Map<string, string>();

/**
 * GET /api/slack/connect (Requirement 4)
 * Initiates real Slack OAuth authorization
 */
slackRouter.get("/connect", requireAuth, (req, res) => {
  const user = req.user as AuthenticatedUser;
  const state = randomUUID();
  pendingSlackStates.set(state, user.id);
  res.redirect(buildSlackAuthorizeUrl(state));
});

/**
 * GET /api/slack/callback (Requirement 4)
 * Receives Slack OAuth callback, exchanges code, and saves connection
 */
slackRouter.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !pendingSlackStates.has(state)) {
    res.redirect(`${config.frontendUrl}/dashboard?slack=error`);
    return;
  }
  const userId = pendingSlackStates.get(state)!;
  pendingSlackStates.delete(state);

  try {
    const result = await exchangeSlackCode(code);
    await prisma.slackConnection.upsert({
      where: { userId },
      update: {
        accessToken: result.accessToken,
        teamId: result.teamId,
        teamName: result.teamName,
        slackUserId: result.slackUserId,
        active: true,
      },
      create: {
        userId,
        accessToken: result.accessToken,
        teamId: result.teamId,
        teamName: result.teamName,
        slackUserId: result.slackUserId,
        active: true,
      },
    });
    logger.info({ userId, teamName: result.teamName }, "Slack OAuth connection established");
    res.redirect(`${config.frontendUrl}/dashboard?slack=connected`);
  } catch (err) {
    logger.error({ err, userId }, "Slack OAuth exchange failed");
    res.redirect(`${config.frontendUrl}/dashboard?slack=error`);
  }
});

/**
 * POST /api/slack/disconnect (Requirement 4)
 * Disconnects the user's Slack workspace
 */
slackRouter.post("/disconnect", requireAuth, async (req, res) => {
  const user = req.user as AuthenticatedUser;
  await disconnectSlack(user.id);
  res.json({ ok: true });
});

/**
 * GET /api/slack/status (Requirement 4)
 * Returns connection status without exposing tokens
 */
slackRouter.get("/status", requireAuth, async (req, res) => {
  const user = req.user as AuthenticatedUser;
  const connection = await prisma.slackConnection.findUnique({ where: { userId: user.id } });
  res.json({
    connected: Boolean(connection?.active),
    teamName: connection?.active ? connection?.teamName ?? null : null,
  });
});
