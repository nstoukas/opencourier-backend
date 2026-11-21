import { StreamableFile } from '@nestjs/common'
import type { Response } from 'express'
import { StatementFile } from 'src/services/statement/statement.service'

// Spec 0050 (cross check 15): a statement file as the answer. The PDF opens in place, the CSV downloads; never
// cached. `StreamableFile` sends the bytes as they are, past the JSON wrapper (it only wraps res.json).
export function statementResponse(res: Response, file: StatementFile): StreamableFile {
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `${file.disposition}; filename="${file.filename}"`,
    'Cache-Control': 'no-store',
  })
  return new StreamableFile(file.body)
}
