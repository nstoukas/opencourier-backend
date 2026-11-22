import { StreamableFile } from '@nestjs/common'
import type { Response } from 'express'
import { ComplaintPhoto } from 'src/services/complaint/complaint.service'

// Spec 0052 (slice 2), AC-9: a complaint photo as the answer, streamed from the private bucket through
// a route that checked who is asking. Shown in place, never cached (by the phone, the browser or a
// proxy), and `nosniff` tells the browser to treat it only as the image type it says it is.
// `StreamableFile` sends the bytes as they are, past the JSON wrapper (the statement routes do the same).
export function complaintPhotoResponse(res: Response, photo: ComplaintPhoto): StreamableFile {
  res.set({
    'Content-Type': photo.contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  return new StreamableFile(photo.stream)
}
