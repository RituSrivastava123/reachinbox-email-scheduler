import { Router } from "express";
import passport, { isGoogleAuthEnabled } from "../integrations/google/passport";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../db/prisma";
import {
  buildSlackAuthorizeUrl,
  exchangeSlackCode,
  disconnectSlack,
} from "../integrations/slack/slackClient";
import { randomUUID } from "crypto";
import { AuthenticatedUser } from "../types";

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

authRouter.get("/google", (req, res, next) => {
  if (!isGoogleAuthEnabled) {
    res.status(503).json({
      error: "Google OAuth is not configured on this server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env",
    });
    return;
  }
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

authRouter.get("/google/callback", (req, res, next) => {
  if (!isGoogleAuthEnabled) {
    res.redirect(`${config.frontendUrl}/login?error=oauth_unconfigured`);
    return;
  }
  passport.authenticate("google", { failureRedirect: `${config.frontendUrl}/login?error=google` })(req, res, () => {
    res.redirect(`${config.frontendUrl}/dashboard`);
  });
});

authRouter.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

authRouter.get("/me", (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: req.user as AuthenticatedUser });
});

/**
 * Dev / demo login to facilitate evaluation and local testing without Google OAuth keys
 */
authRouter.post("/dev-login", async (req, res, next) => {
  try {
    const devEmail = "demo@reachinbox.ai";
    let user = await prisma.user.findUnique({ where: { email: devEmail } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          googleId: "dev-demo-google-id",
          name: "Demo User",
          email: devEmail,
          avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=DemoUser",
        },
      });
    }

    const authUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };

    req.login(authUser, (err) => {
      if (err) return next(err);
      res.json({ user: authUser });
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Slack OAuth
// ---------------------------------------------------------------------------

// In-memory state->userId map is fine here: it only needs to survive the few
// seconds of the OAuth round trip, and is scoped to a single process. If you
// run multiple API instances behind a load balancer, back this with Redis.
const pendingSlackStates = new Map<string, string>();

authRouter.get("/slack", requireAuth, (req, res) => {
  const user = req.user as AuthenticatedUser;
  const state = randomUUID();
  pendingSlackStates.set(state, user.id);
  res.redirect(buildSlackAuthorizeUrl(state));
});

authRouter.get("/slack/callback", async (req, res) => {
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
    res.redirect(`${config.frontendUrl}/dashboard?slack=connected`);
  } catch (err) {
    res.redirect(`${config.frontendUrl}/dashboard?slack=error`);
  }
});

authRouter.post("/slack/disconnect", requireAuth, async (req, res) => {
  const user = req.user as AuthenticatedUser;
  await disconnectSlack(user.id);
  res.json({ ok: true });
});

authRouter.get("/slack/status", requireAuth, async (req, res) => {
  const user = req.user as AuthenticatedUser;
  const connection = await prisma.slackConnection.findUnique({ where: { userId: user.id } });
  res.json({
    connected: Boolean(connection?.active),
    teamName: connection?.teamName ?? null,
  });
});
