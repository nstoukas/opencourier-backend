import { Readable } from 'stream'

// Spec 0052, cross check 9: where private files are kept. An `abstract class` is a contract: it lists
// the methods every storage must have, and Nest's DI hands out whichever implementation a module binds
// to it (MinIO for complaint photos; production storage is row 45's choice behind the same contract).
// Each implementation is bound to one private bucket. Files are read back only as a stream, through a
// route that checked who is asking: never as a public URL.
export abstract class StorageProvider {
  // Stores `data` under `key`, replacing anything there. Throws when the storage cannot take it.
  abstract put(key: string, data: Buffer, contentType: string): Promise<void>

  // Opens the file for reading. Throws `StoredFileNotFoundError` when no file has that key.
  abstract getStream(key: string): Promise<Readable>

  // Removes the file. A missing file is not an error.
  abstract delete(key: string): Promise<void>
}

// Thrown by getStream for a key with no file, so a route can answer 404 rather than 503.
export class StoredFileNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored file for key ${key}`)
    this.name = 'StoredFileNotFoundError'
  }
}

// Thrown when the storage is not set up on this server (for MinIO: no MINIO_ENDPOINT).
export class StorageNotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured on this server`)
    this.name = 'StorageNotConfiguredError'
  }
}
