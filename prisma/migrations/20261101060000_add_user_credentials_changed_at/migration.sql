-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "credentialsChangedAt" TIMESTAMP(3);

