import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'
import { Readable } from 'stream'
import {
  StorageNotConfiguredError,
  StoredFileNotFoundError,
} from 'src/services/storage/models/StorageProvider'
import {
  MINIO_BUCKET_COMPLAINTS,
  MINIO_ENDPOINT,
  MINIO_PASSWORD,
  MINIO_USER,
} from 'src/constants'
import {
  MinioStorageService,
  minioOptionsFrom,
} from './minioStorage.service'

describe('MinioStorageService (Spec 0052, AC-9, cross check 9)', () => {
  describe('minioOptionsFrom', () => {
    it('parses http URL with explicit port', () => {
      const opts = minioOptionsFrom('http://localhost:9000', 'admin', 'password')
      expect(opts).toEqual({
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
        accessKey: 'admin',
        secretKey: 'password',
      })
    })

    it('parses https URL with default 443 port', () => {
      const opts = minioOptionsFrom('https://storage.coop.gr', 'user', 'pass')
      expect(opts).toEqual({
        endPoint: 'storage.coop.gr',
        port: 443,
        useSSL: true,
        accessKey: 'user',
        secretKey: 'pass',
      })
    })

    it('parses http URL without explicit port defaulting to 80', () => {
      const opts = minioOptionsFrom('http://storage.internal', 'user', 'pass')
      expect(opts).toEqual({
        endPoint: 'storage.internal',
        port: 80,
        useSSL: false,
        accessKey: 'user',
        secretKey: 'pass',
      })
    })
  })

  describe('MinioStorageService operations', () => {
    let mockClient: jest.Mocked<Partial<Client>>
    let mockConfigService: jest.Mocked<ConfigService>

    beforeEach(() => {
      mockClient = {
        bucketExists: jest.fn().mockResolvedValue(true),
        makeBucket: jest.fn().mockResolvedValue(undefined),
        getBucketPolicy: jest.fn().mockRejectedValue({ code: 'NoSuchBucketPolicy' }),
        putObject: jest.fn().mockResolvedValue({ etag: '123' } as any),
        getObject: jest.fn().mockResolvedValue(Readable.from(['file-data'])),
        removeObject: jest.fn().mockResolvedValue(undefined),
      }

      mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === MINIO_ENDPOINT) return 'http://localhost:9000'
          if (key === MINIO_BUCKET_COMPLAINTS) return 'complaints'
          if (key === MINIO_USER) return 'miniouser'
          if (key === MINIO_PASSWORD) return 'miniopass'
          return null
        }),
      } as unknown as jest.Mocked<ConfigService>
    })

    function createServiceWithClient(client: any): MinioStorageService {
      const svc = new MinioStorageService(mockConfigService)
      ;(svc as any).client = client
      return svc
    }

    it('put ensures private bucket and stores object with content type', async () => {
      const service = createServiceWithClient(mockClient)
      const data = Buffer.from('photo-bytes')

      await service.put('photo-key.jpg', data, 'image/jpeg')

      expect(mockClient.bucketExists).toHaveBeenCalledWith('complaints')
      expect(mockClient.putObject).toHaveBeenCalledWith(
        'complaints',
        'photo-key.jpg',
        data,
        data.length,
        { 'Content-Type': 'image/jpeg' }
      )
    })

    it('refuses to store photos if bucket carries a public access policy (AC-9, cross check 9)', async () => {
      // Return non-empty bucket policy string indicating it is public
      mockClient.getBucketPolicy = jest.fn().mockResolvedValue('{"Statement":[{"Effect":"Allow","Principal":"*"}]}')
      const service = createServiceWithClient(mockClient)

      await expect(
        service.put('photo-key.jpg', Buffer.from('data'), 'image/jpeg')
      ).rejects.toThrow('has an access policy; complaint photos must stay private')

      expect(mockClient.putObject).not.toHaveBeenCalled()
    })

    it('creates bucket if it does not exist at startup or on first put', async () => {
      mockClient.bucketExists = jest.fn().mockResolvedValue(false)
      const service = createServiceWithClient(mockClient)

      await service.put('photo-key.jpg', Buffer.from('data'), 'image/jpeg')

      expect(mockClient.makeBucket).toHaveBeenCalledWith('complaints')
      expect(mockClient.putObject).toHaveBeenCalled()
    })

    it('caches private bucket check for 5 minutes without querying MinIO on each upload', async () => {
      const service = createServiceWithClient(mockClient)
      const data = Buffer.from('photo-bytes')
      const baseTime = 1700000000000
      jest.spyOn(Date, 'now').mockReturnValue(baseTime)

      // First upload checks bucket and policy
      await service.put('photo-1.jpg', data, 'image/jpeg')
      expect(mockClient.bucketExists).toHaveBeenCalledTimes(1)
      expect(mockClient.getBucketPolicy).toHaveBeenCalledTimes(1)

      // Second upload 4 minutes later reuses the cached check
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 4 * 60 * 1000)
      await service.put('photo-2.jpg', data, 'image/jpeg')
      expect(mockClient.bucketExists).toHaveBeenCalledTimes(1)
      expect(mockClient.getBucketPolicy).toHaveBeenCalledTimes(1)

      jest.spyOn(Date, 'now').mockRestore()
    })

    it('rechecks bucket policy after 5 minutes and refuses upload if a policy was added (ruling 2026-11-22)', async () => {
      const service = createServiceWithClient(mockClient)
      const data = Buffer.from('photo-bytes')
      const baseTime = 1700000000000
      jest.spyOn(Date, 'now').mockReturnValue(baseTime)

      // First upload passes with private bucket
      await service.put('photo-1.jpg', data, 'image/jpeg')
      expect(mockClient.putObject).toHaveBeenCalledWith('complaints', 'photo-1.jpg', expect.anything(), expect.anything(), expect.anything())

      // Someone makes bucket public in MinIO during operation
      mockClient.getBucketPolicy = jest.fn().mockResolvedValue('{"Statement":[{"Effect":"Allow","Principal":"*"}]}')

      // 5 minutes and 1 second later: next upload rechecks and catches the public policy
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 5 * 60 * 1000 + 1000)
      await expect(
        service.put('photo-2.jpg', data, 'image/jpeg')
      ).rejects.toThrow('has an access policy; complaint photos must stay private')

      // photo-2.jpg is never stored
      expect(mockClient.putObject).not.toHaveBeenCalledWith('complaints', 'photo-2.jpg', expect.anything(), expect.anything(), expect.anything())

      jest.spyOn(Date, 'now').mockRestore()
    })

    it('rechecks bucket policy after 5 minutes and succeeds when bucket remains private', async () => {
      const service = createServiceWithClient(mockClient)
      const data = Buffer.from('photo-bytes')
      const baseTime = 1700000000000
      jest.spyOn(Date, 'now').mockReturnValue(baseTime)

      // First upload
      await service.put('photo-1.jpg', data, 'image/jpeg')
      expect(mockClient.getBucketPolicy).toHaveBeenCalledTimes(1)

      // 6 minutes later: rechecks policy, still private, succeeds
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 6 * 60 * 1000)
      await service.put('photo-2.jpg', data, 'image/jpeg')
      expect(mockClient.getBucketPolicy).toHaveBeenCalledTimes(2)

      jest.spyOn(Date, 'now').mockRestore()
    })

    it('getStream returns readable stream for stored photo', async () => {
      const service = createServiceWithClient(mockClient)
      const stream = await service.getStream('photo-key.jpg')

      expect(mockClient.getObject).toHaveBeenCalledWith('complaints', 'photo-key.jpg')
      expect(stream).toBeDefined()
    })

    it('getStream throws StoredFileNotFoundError on NoSuchKey or NotFound code', async () => {
      mockClient.getObject = jest.fn().mockRejectedValue({ code: 'NoSuchKey' })
      const service = createServiceWithClient(mockClient)

      await expect(service.getStream('missing.jpg')).rejects.toThrow(StoredFileNotFoundError)

      mockClient.getObject = jest.fn().mockRejectedValue({ code: 'NotFound' })
      await expect(service.getStream('missing.jpg')).rejects.toThrow(StoredFileNotFoundError)
    })

    it('delete removes object from bucket', async () => {
      const service = createServiceWithClient(mockClient)
      await service.delete('photo-key.jpg')

      expect(mockClient.removeObject).toHaveBeenCalledWith('complaints', 'photo-key.jpg')
    })

    it('throws StorageNotConfiguredError when MINIO_ENDPOINT is unset', async () => {
      mockConfigService.get.mockReturnValue(null)
      const service = new MinioStorageService(mockConfigService)

      await expect(
        service.put('photo.jpg', Buffer.from('data'), 'image/jpeg')
      ).rejects.toThrow(StorageNotConfiguredError)

      await expect(service.getStream('photo.jpg')).rejects.toThrow(StorageNotConfiguredError)
      await expect(service.delete('photo.jpg')).rejects.toThrow(StorageNotConfiguredError)
    })
  })
})
