import sharp from 'sharp'

// Spec 0052 (row 83, slice 2), AC-2 and cross check 4: the one photo a rider may attach to a complaint.
// The app already sends a JPEG at most 1600 px wide; the server trusts none of that. It reads the first
// bytes (JPEG or PNG only, whatever the request claims), then decodes the picture and encodes a fresh
// JPEG, so nothing of the original file survives but its pixels: no EXIF (where the phone keeps the
// place the photo was taken), no XMP, no comments, no embedded thumbnail.

// The multipart limit, checked by multer before the file reaches the service (larger is 413).
export const COMPLAINT_PHOTO_MAX_BYTES = 5 * 1024 * 1024
// The longest side kept, matching what the app asks of the picker.
export const COMPLAINT_PHOTO_MAX_SIDE = 1600
// Every stored photo is a JPEG, whatever was sent.
export const COMPLAINT_PHOTO_CONTENT_TYPE = 'image/jpeg'
// A decoded picture larger than this is refused before it is drawn: a small file can unpack into a
// huge image (a "decompression bomb"). 40 million pixels is far above any phone photo.
const MAX_INPUT_PIXELS = 40_000_000

export const COMPLAINT_PHOTO_TYPE_MESSAGE = 'The photo must be a JPEG or PNG image.'
export const COMPLAINT_PHOTO_UNREADABLE_MESSAGE = 'The photo could not be read. Try another one.'

export type ComplaintPhotoKind = 'jpeg' | 'png'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// What the file's first bytes say it is, or null for anything else (HEIC, WebP, GIF, a PDF...).
export function photoKindOf(data: Buffer): ComplaintPhotoKind | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg'
  if (data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => data[i] === byte)) return 'png'
  return null
}

// Decodes and re-encodes the photo. Throws when the bytes do not decode as an image.
// - rotate() with no angle turns the pixels the way the EXIF orientation says, so a portrait photo
//   stays upright once that EXIF is gone.
// - sharp writes no metadata unless asked (withMetadata / keepMetadata), so the output carries none.
// - flatten() paints a PNG's transparent parts white, since a JPEG has no transparency.
export async function reencodeComplaintPhoto(data: Buffer): Promise<Buffer> {
  return sharp(data, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize({
      width: COMPLAINT_PHOTO_MAX_SIDE,
      height: COMPLAINT_PHOTO_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer()
}
