import { PrismaClient } from "@prisma/client";

// A single shared Prisma client for the whole process (API server or worker).
// Prisma multiplexes queries over an internal connection pool, so one client
// instance per process is the recommended pattern.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
