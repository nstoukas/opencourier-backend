-- Spec 0048 (row 80, slice 2, cross check 6): the order of a stack's four stops, on both deliveries.
-- Generated with `prisma migrate diff`. Nullable and additive: every existing delivery is a single one (null).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "stopSequence" JSONB;
