import { Email } from "@prisma/client";
import { esClient, EMAIL_INDEX } from "./client";
import { logger } from "../../utils/logger";

/**
 * Upserts a single email's searchable fields into Elasticsearch. Postgres is
 * always the source of truth; this call is best-effort and MUST NOT throw in
 * a way that breaks scheduling or sending if Elasticsearch happens to be
 * down -- callers wrap this in a `.catch()` and only log a warning.
 */
export async function indexEmail(email: Email): Promise<void> {
  await esClient.index({
    index: EMAIL_INDEX,
    id: email.id,
    document: {
      emailId: email.id,
      userId: email.userId,
      senderId: email.senderId,
      recipient: email.recipient,
      subject: email.subject,
      status: email.status,
      scheduledAt: email.scheduledAt,
      sentAt: email.sentAt,
      createdAt: email.createdAt,
    },
  });
}

export async function deleteEmailFromIndex(emailId: string): Promise<void> {
  try {
    await esClient.delete({ index: EMAIL_INDEX, id: emailId });
  } catch (err) {
    logger.debug({ err, emailId }, "ES delete no-op (doc may not exist)");
  }
}

export interface SearchParams {
  userId: string;
  query?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Full text + filtered search across scheduled AND sent emails. Falls back
 * to returning an explicit "unavailable" marker rather than throwing, so the
 * API can degrade gracefully (e.g. tell the frontend to fall back to the
 * plain Postgres-backed tables) when Elasticsearch is down.
 */
export async function searchEmails(params: SearchParams) {
  const { userId, query, status, page = 1, pageSize = 20 } = params;

  const filters: Record<string, unknown>[] = [{ term: { userId } }];
  if (status) filters.push({ term: { status } });

  const must = query
    ? [{ multi_match: { query, fields: ["subject", "recipient"] } }]
    : [{ match_all: {} }];

  const result = await esClient.search({
    index: EMAIL_INDEX,
    from: (page - 1) * pageSize,
    size: pageSize,
    sort: [{ scheduledAt: { order: "desc" } }],
    query: {
      bool: { must, filter: filters },
    },
  });

  return {
    total:
      typeof result.hits.total === "number" ? result.hits.total : result.hits.total?.value ?? 0,
    items: result.hits.hits.map((h) => h._source),
  };
}
