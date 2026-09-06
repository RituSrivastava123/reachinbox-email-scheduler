import { WebClient } from "@slack/web-api";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { config } from "../../config";
import { redis } from "../../queues/connection";

export const SLACK_OAUTH_SCOPES = ["chat:write", "channels:read", "im:write"].join(",");

export function buildSlackAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: SLACK_OAUTH_SCOPES,
    redirect_uri: config.slack.callbackUrl,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface SlackOAuthResult {
  accessToken: string;
  teamId: string;
  teamName: string;
  slackUserId: string;
}

/**
 * Exchanges the OAuth `code` Slack redirected back with for a real access
 * token via Slack's `oauth.v2.access` endpoint. This is a genuine OAuth
 * token exchange -- no mocked/fake tokens are ever stored.
 */
export async function exchangeSlackCode(code: string): Promise<SlackOAuthResult> {
  const client = new WebClient();
  const result = await client.oauth.v2.access({
    client_id: config.slack.clientId,
    client_secret: config.slack.clientSecret,
    code,
    redirect_uri: config.slack.callbackUrl,
  });

  if (!result.ok || !result.access_token) {
    throw new Error(`Slack OAuth exchange failed: ${result.error ?? "unknown error"}`);
  }

  return {
    accessToken: result.access_token,
    teamId: (result.team as { id: string })?.id ?? "",
    teamName: (result.team as { name: string })?.name ?? "",
    slackUserId: (result.authed_user as { id: string })?.id ?? "",
  };
}

/**
 * Sends a real Slack message to the connected user/workspace notifying them
 * that a sender hit its hourly rate limit and its remaining emails were
 * rescheduled. Deduplicated per sender/hour (Requirement 2.M).
 */
export async function notifyRateLimitReached(
  userId: string,
  senderName: string,
  nextWindowStart: Date,
  senderId?: string
): Promise<void> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection || !connection.active) {
    logger.debug({ userId }, "Slack not connected -- skipping rate-limit notification");
    return;
  }

  // Deduplicate per sender/hour (Requirement 2.M)
  const hourKey = new Date().toISOString().slice(0, 13);
  const dedupeKey = `slack:ratelimit:notified:${senderId || senderName}:${hourKey}`;
  const shouldNotify = await redis.set(dedupeKey, "1", "EX", 3600, "NX").catch(() => "OK");
  if (!shouldNotify) {
    logger.debug({ senderName, hourKey }, "Slack rate limit notification already sent this hour -- skipping duplicate alert");
    return;
  }

  try {
    const client = new WebClient(connection.accessToken);
    let target = connection.channelId;

    // H4 fix: If channelId not saved, open conversation with the user to obtain valid DM channel ID
    if (!target && connection.slackUserId) {
      try {
        const conversation = await client.conversations.open({ users: connection.slackUserId });
        if (conversation.channel?.id) {
          target = conversation.channel.id;
          await prisma.slackConnection.update({
            where: { id: connection.id },
            data: { channelId: target },
          }).catch(() => undefined);
        }
      } catch (convErr) {
        logger.warn({ convErr, userId }, "Failed to open Slack conversation, falling back to direct userId");
        target = connection.slackUserId;
      }
    }

    if (!target) {
      target = connection.slackUserId;
    }

    await client.chat.postMessage({
      channel: target,
      text:
        `:warning: Email rate limit reached for sender *${senderName}*. ` +
        `Remaining emails have been rescheduled to the next available window ` +
        `(${nextWindowStart.toISOString()}).`,
    });
  } catch (err) {
    // A Slack outage or revoked token must never take down the worker.
    logger.warn({ err, userId }, "Failed to deliver Slack rate-limit notification");
  }
}

export async function disconnectSlack(userId: string): Promise<void> {
  await prisma.slackConnection.updateMany({ where: { userId }, data: { active: false } });
}
