-- CreateIndex
CREATE INDEX "DeliveryEvent_courierId_type_idx" ON "DeliveryEvent"("courierId", "type");

-- CreateIndex
CREATE INDEX "DeliveryEvent_deliveryId_idx" ON "DeliveryEvent"("deliveryId");
