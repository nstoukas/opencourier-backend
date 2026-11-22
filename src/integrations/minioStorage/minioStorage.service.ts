import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client, ClientOptions } from 'minio'
import { Readable } from 'stream'
import { MINIO_BUCKET_COMPLAINTS, MINIO_ENDPOINT, MINIO_PASSWORD, MINIO_USER } from 'src/constants'
import {
  StorageNotConfiguredError,
  StorageProvider,
  StoredFileNotFoundError,
} from 'src/services/storage/models/StorageProvider'

const DEFAULT_COMPLAINTS_BUCKET = 'complaints'

// MinIO's answers for "no such file", checked on the error's `code`.
const NOT_FOUND_CODES = new Set(['NoSuchKey', 'NotFound'])

// Turns `http://localhost:9000` into the pieces the MinIO client wants. Exported for tests.
export function minioOptionsFrom(endpoint: string, accessKey: string, secretKey: string): ClientOptions {
  const url = new URL(endpoint)
  const useSSL = url.protocol === 'https:'
  return {
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : useSSL ? 443 : 80,
    useSSL,
    accessKey,
    secretKey,
  }
}

// Spec 0052 (row 83, slice 2), AC-9 and cross check 9: complaint photos in a private MinIO bucket.
// The bucket is `MINIO_BUCKET_COMPLAINTS` (default `complaints`), made at startup when missing, with no
// policy: MinIO then answers anonymous reads with 403, so a key alone opens nothing. A bucket that has a
// policy (someone made it public) is refused, and photos stay off until it is private again.
// With MINIO_ENDPOINT unset, or MinIO down, put throws; the complaint service turns that into a clear
// 503 and saves no complaint without its photo.
// `implements OnModuleInit` = Nest calls onModuleInit once, after the app's modules are built.
@Injectable()
export class MinioStorageService extends StorageProvider implements OnModuleInit {
  private readonly logger = new Logger(MinioStorageService.name)
  private readonly client: Client | null
  private readonly bucket: string
  private bucketReady = false

  constructor(configService: ConfigService) {
    super()
    const endpoint = configService.get<string>(MINIO_ENDPOINT)
    this.bucket = configService.get<string>(MINIO_BUCKET_COMPLAINTS) || DEFAULT_COMPLAINTS_BUCKET
    this.client = endpoint
      ? new Client(
          minioOptionsFrom(
            endpoint,
            configService.get<string>(MINIO_USER) ?? '',
            configService.get<string>(MINIO_PASSWORD) ?? ''
          )
        )
      : null
  }

  async onModuleInit() {
    if (!this.client) {
      this.logger.warn('MINIO_ENDPOINT is not set: complaint photos are off (a filing with a photo answers 503)')
      return
    }
    try {
      await this.ensureBucket()
      this.logger.log(`Complaint photos are kept in the private bucket "${this.bucket}"`)
    } catch (error) {
      // Startup goes on: complaints without a photo still work, and the next upload tries again.
      this.logger.warn(`MinIO is not ready, complaint photos will retry on the next upload: ${errorText(error)}`)
    }
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.ensureBucket()
    await this.requireClient().putObject(this.bucket, key, data, data.length, { 'Content-Type': contentType })
  }

  async getStream(key: string): Promise<Readable> {
    try {
      return await this.requireClient().getObject(this.bucket, key)
    } catch (error) {
      if (NOT_FOUND_CODES.has(errorCode(error))) throw new StoredFileNotFoundError(key)
      throw error
    }
  }

  async delete(key: string) {
    // MinIO answers a remove of a missing key with success, so a missing file is not an error here.
    await this.requireClient().removeObject(this.bucket, key)
  }

  // Makes the bucket if it is missing, and refuses one that carries a policy (a policy is how a bucket
  // is made readable by anyone). Remembered once it passed, so each upload does not ask again.
  private async ensureBucket() {
    if (this.bucketReady) return
    const client = this.requireClient()
    if (!(await client.bucketExists(this.bucket))) {
      try {
        await client.makeBucket(this.bucket)
      } catch (error) {
        // Another backend process made it a moment ago: fine.
        if (errorCode(error) !== 'BucketAlreadyOwnedByYou') throw error
      }
    }
    if (await this.hasPolicy(client)) {
      throw new Error(`Bucket "${this.bucket}" has an access policy; complaint photos must stay private`)
    }
    this.bucketReady = true
  }

  private async hasPolicy(client: Client): Promise<boolean> {
    try {
      const policy = await client.getBucketPolicy(this.bucket)
      return policy.trim().length > 0
    } catch (error) {
      if (errorCode(error) === 'NoSuchBucketPolicy') return false
      throw error
    }
  }

  private requireClient(): Client {
    if (!this.client) throw new StorageNotConfiguredError('Photo storage (MINIO_ENDPOINT)')
    return this.client
  }
}

// MinIO's errors carry an S3 `code` string; anything else has none.
function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
