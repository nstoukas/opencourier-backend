-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- DropIndex
DROP INDEX "User_apiKey_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "apiKey",
ADD COLUMN     "apiKeyCreatedAt" TIMESTAMP(3),
ADD COLUMN     "apiKeyHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKeyHash_key" ON "User"("apiKeyHash");

