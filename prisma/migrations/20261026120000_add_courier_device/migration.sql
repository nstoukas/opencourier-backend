-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "EnumDevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateTable
CREATE TABLE "CourierDevice" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "EnumDevicePlatform" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "courierId" TEXT NOT NULL,

    CONSTRAINT "CourierDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierDevice_token_key" ON "CourierDevice"("token");

-- CreateIndex
CREATE INDEX "CourierDevice_courierId_idx" ON "CourierDevice"("courierId");

-- AddForeignKey
ALTER TABLE "CourierDevice" ADD CONSTRAINT "CourierDevice_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

