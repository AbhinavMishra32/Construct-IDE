import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as {
  constructPrisma?: PrismaClient;
};

export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.constructPrisma) {
    globalForPrisma.constructPrisma = new PrismaClient();
  }

  return globalForPrisma.constructPrisma;
}
