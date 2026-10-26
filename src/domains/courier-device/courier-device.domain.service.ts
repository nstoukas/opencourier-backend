import { Injectable } from '@nestjs/common'
import { EnumDevicePlatform } from '@prisma/types'
import { CourierDeviceRepository } from 'src/persistence/repositories/courier-device.repository'

// A rider's phones, for offer push (spec 0003, AC-1). The app registers its token after login and
// whenever Firebase gives it a new one, and unregisters it on logout.
@Injectable()
export class CourierDeviceDomainService {
  constructor(private readonly courierDeviceRepository: CourierDeviceRepository) {}

  async register(courierId: string, token: string, platform: EnumDevicePlatform): Promise<void> {
    await this.courierDeviceRepository.upsertForCourier(courierId, token, platform)
  }

  async unregister(courierId: string, token: string): Promise<void> {
    await this.courierDeviceRepository.deleteForCourier(courierId, token)
  }
}
