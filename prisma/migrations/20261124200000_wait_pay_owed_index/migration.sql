-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateIndex
CREATE INDEX "Delivery_waitPayOwedAt_idx" ON "Delivery"("waitPayOwedAt");

