-- Row 126: a reply an admin entered for a deactivated rider (from a phone call) stays marked as entered
-- for the rider after that admin's account is deleted. `replyEnteredByUserId` is ON DELETE SET NULL, so
-- the flag is kept apart from the id. Generated with `prisma migrate diff`, then the backfill and the
-- CHECK were added by hand.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "replyEnteredForRider" BOOLEAN NOT NULL DEFAULT false;

-- Hand written backfill: every reply an admin entered so far (its admin still named) is marked.
-- Replies whose admin was already deleted before this migration cannot be told apart from a rider's
-- own and stay unmarked.
UPDATE "Complaint" SET "replyEnteredForRider" = true WHERE "replyEnteredByUserId" IS NOT NULL;

-- Hand written: an admin named as having entered the reply always means the flag is set.
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_reply_entered_by_marks_flag" CHECK (
  "replyEnteredByUserId" IS NULL OR "replyEnteredForRider"
);
