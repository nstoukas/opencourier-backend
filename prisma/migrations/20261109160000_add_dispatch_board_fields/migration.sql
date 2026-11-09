-- AlterTable
ALTER TABLE "Courier" ADD COLUMN     "currentLocationAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DeliveryIssue" ADD COLUMN     "handledAt" TIMESTAMP(3),
ADD COLUMN     "handledByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_handledByUserId_fkey" FOREIGN KEY ("handledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

