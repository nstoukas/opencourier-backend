-- Spec 0052 (row 83), slice 2: the photo a rider may attach to a complaint. Only its random key in
-- the private MinIO `complaints` bucket is stored, never a URL.
-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "photoKey" VARCHAR(100);

-- Hand written: only a rider's filing carries a photo (AC-2: restaurants and admins file text only).
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_photo_only_from_rider" CHECK (
  "photoKey" IS NULL OR "filedBy" = 'RIDER'
);
