-- When each event happened, beside when the server received it (createdAt). Spec 0009.
ALTER TABLE "DeliveryEvent" ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Every event stored before this change happened when it arrived, so past earnings stay on their day.
UPDATE "DeliveryEvent" SET "occurredAt" = "createdAt";

-- The earnings queries filter on both.
CREATE INDEX "DeliveryEvent_newStatus_occurredAt_idx" ON "DeliveryEvent"("newStatus", "occurredAt");
