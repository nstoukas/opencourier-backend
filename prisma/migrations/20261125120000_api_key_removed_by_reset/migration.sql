-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "apiKeyRemovedByResetAt" TIMESTAMP(3);

