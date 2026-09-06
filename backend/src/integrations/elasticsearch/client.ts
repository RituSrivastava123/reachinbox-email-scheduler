import { Client } from "@elastic/elasticsearch";
import { config } from "../../config";
import { logger } from "../../utils/logger";

export const EMAIL_INDEX = "emails";

export const esClient = new Client({ node: config.elasticsearchUrl });

export async function ensureEmailIndex(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: EMAIL_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: EMAIL_INDEX,
        mappings: {
          properties: {
            emailId: { type: "keyword" },
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            recipient: { type: "keyword" },
            senderEmail: { type: "keyword" },
            subject: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            createdAt: { type: "date" },
          },
        },
      });
      logger.info("Created Elasticsearch 'emails' index");
    }
  } catch (err) {
    // Elasticsearch may be temporarily unavailable, e.g. still booting. This
    // must never crash the API/worker -- Postgres remains the source of
    // truth, ES is a best-effort search index on top of it.
    logger.warn({ err }, "Could not ensure Elasticsearch index (will retry lazily)");
  }
}
