-- AlterTable
ALTER TABLE "SplitRequest" ADD COLUMN     "waitOwedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SplitRequest_waitOwedAt_idx" ON "SplitRequest"("waitOwedAt");

