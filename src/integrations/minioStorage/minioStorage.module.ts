import { Module } from '@nestjs/common'
import { useProvideClass } from 'src/core/utils/provider'
import { StorageProvider } from 'src/services/storage/models/StorageProvider'
import { MinioStorageService } from './minioStorage.service'

// Spec 0052: binds the StorageProvider contract to MinIO's complaints bucket. Not global on purpose:
// only the complaint module imports it, so nothing else can reach the photos by injecting a storage.
@Module({
  providers: [useProvideClass(StorageProvider, MinioStorageService)],
  exports: [StorageProvider],
})
export class MinioStorageModule {}
