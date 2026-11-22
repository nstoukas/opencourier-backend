import { Global, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Bucket, Storage } from '@google-cloud/storage'
import { Readable } from 'stream'
import { GCP_BUCKET_NAME, GCP_PROJECT_NAME } from '../../constants'
import { StorageProvider, StoredFileNotFoundError } from '../../services/storage/models/StorageProvider'

// Upstream's Google Cloud storage, not wired into any module (app.module.ts keeps it commented out).
// Spec 0052 moved it to the put / getStream / delete contract the MinIO storage implements, and
// dropped its public URL methods, which nothing called: stored files are never handed out by URL.
@Global()
@Injectable()
export class GcpStorageService extends StorageProvider {
  private readonly bucket: Bucket

  constructor(protected readonly configService: ConfigService) {
    super()

    const projectName = this.configService.get(GCP_PROJECT_NAME)
    const bucketName = this.configService.get(GCP_BUCKET_NAME)

    if (!projectName || !bucketName) {
      throw new Error('Project or bucket name is missing for Cloud Storage')
    }

    const storage = new Storage({
      projectId: projectName,
    })
    this.bucket = storage.bucket(bucketName)
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.bucket.file(key).save(data, { contentType })
  }

  async getStream(key: string): Promise<Readable> {
    const file = this.bucket.file(key)
    const [exists] = await file.exists()
    if (!exists) throw new StoredFileNotFoundError(key)
    return file.createReadStream()
  }

  async delete(key: string) {
    await this.bucket.file(key).delete({ ignoreNotFound: true })
  }
}
