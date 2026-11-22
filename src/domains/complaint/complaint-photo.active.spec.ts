import sharp from 'sharp'
import {
  COMPLAINT_PHOTO_CONTENT_TYPE,
  COMPLAINT_PHOTO_MAX_BYTES,
  COMPLAINT_PHOTO_MAX_SIDE,
  photoKindOf,
  reencodeComplaintPhoto,
} from './complaint-photo'

describe('ComplaintPhoto (Spec 0052, AC-2, AC-9, cross check 4)', () => {
  describe('photoKindOf', () => {
    it('detects JPEG from magic bytes (0xff, 0xd8, 0xff)', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
      expect(photoKindOf(jpegBuffer)).toBe('jpeg')
    })

    it('detects PNG from magic bytes (89 50 4E 47 0D 0A 1A 0A)', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      expect(photoKindOf(pngBuffer)).toBe('png')
    })

    it('returns null for other formats like GIF, WebP, PDF or random text', () => {
      // GIF89a
      expect(photoKindOf(Buffer.from('GIF89a'))).toBeNull()
      // WebP (RIFF....WEBP)
      expect(photoKindOf(Buffer.from('RIFF1234WEBP'))).toBeNull()
      // PDF (%PDF)
      expect(photoKindOf(Buffer.from('%PDF-1.4'))).toBeNull()
      // Plain text or empty
      expect(photoKindOf(Buffer.from('hello world'))).toBeNull()
      expect(photoKindOf(Buffer.alloc(0))).toBeNull()
      expect(photoKindOf(Buffer.from([0xff, 0xd8]))).toBeNull() // truncated
    })
  })

  describe('reencodeComplaintPhoto', () => {
    it('re-encodes a JPEG and strips metadata while producing a valid JPEG', async () => {
      // Create a test JPEG with EXIF metadata
      const rawImage = await sharp({
        create: {
          width: 200,
          height: 150,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .withMetadata({
          exif: {
            IFD0: {
              Artist: 'Secret Photographer',
              Make: 'PhoneCameraModel',
            },
          },
        })
        .jpeg()
        .toBuffer()

      expect(photoKindOf(rawImage)).toBe('jpeg')

      const reencoded = await reencodeComplaintPhoto(rawImage)
      expect(photoKindOf(reencoded)).toBe('jpeg')

      // Verify metadata is stripped: artist should not be present
      const metadata = await sharp(reencoded).metadata()
      expect(metadata.format).toBe('jpeg')
      expect(metadata.width).toBe(200)
      expect(metadata.height).toBe(150)
      expect(metadata.exif).toBeUndefined()
    })

    it('converts a transparent PNG into a JPEG with flattened background', async () => {
      // Create a 100x100 transparent PNG
      const pngBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer()

      expect(photoKindOf(pngBuffer)).toBe('png')

      const reencoded = await reencodeComplaintPhoto(pngBuffer)
      // Must be transformed to JPEG
      expect(photoKindOf(reencoded)).toBe('jpeg')

      const metadata = await sharp(reencoded).metadata()
      expect(metadata.format).toBe('jpeg')
      expect(metadata.channels).toBe(3) // JPEG has no alpha
      expect(metadata.width).toBe(100)
      expect(metadata.height).toBe(100)
    })

    it('resizes images larger than COMPLAINT_PHOTO_MAX_SIDE (1600px) down preserving aspect ratio', async () => {
      // 2000x1000 image
      const largeImage = await sharp({
        create: {
          width: 2000,
          height: 1000,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .jpeg()
        .toBuffer()

      const reencoded = await reencodeComplaintPhoto(largeImage)
      const metadata = await sharp(reencoded).metadata()

      expect(metadata.width).toBe(COMPLAINT_PHOTO_MAX_SIDE)
      expect(metadata.height).toBe(800) // 1000 * (1600 / 2000)
    })

    it('does not enlarge images smaller than COMPLAINT_PHOTO_MAX_SIDE', async () => {
      const smallImage = await sharp({
        create: {
          width: 300,
          height: 200,
          channels: 3,
          background: { r: 50, g: 50, b: 50 },
        },
      })
        .jpeg()
        .toBuffer()

      const reencoded = await reencodeComplaintPhoto(smallImage)
      const metadata = await sharp(reencoded).metadata()

      expect(metadata.width).toBe(300)
      expect(metadata.height).toBe(200)
    })

    it('throws when passed corrupt or non-image bytes', async () => {
      const corruptBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33])
      await expect(reencodeComplaintPhoto(corruptBytes)).rejects.toThrow()
    })
  })

  describe('constants', () => {
    it('sets COMPLAINT_PHOTO_MAX_BYTES to 5 MB', () => {
      expect(COMPLAINT_PHOTO_MAX_BYTES).toBe(5 * 1024 * 1024)
    })

    it('sets COMPLAINT_PHOTO_CONTENT_TYPE to image/jpeg', () => {
      expect(COMPLAINT_PHOTO_CONTENT_TYPE).toBe('image/jpeg')
    })
  })
})
