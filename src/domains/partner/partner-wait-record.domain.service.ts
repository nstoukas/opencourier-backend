import { Injectable } from '@nestjs/common'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { PartnerEntity } from './entities/partner.entity'
import { waitRecordOf } from './wait-record'

const DAY_MS = 24 * 60 * 60 * 1000

// Spec 0030: the rolling period is counted back from the server's clock, as partnerHistoryCutoff does.
@Injectable()
export class PartnerWaitRecordDomainService {
  constructor(private readonly deliveryRepository: DeliveryRepository) {}

  async getWaitRecord(partner: PartnerEntity, days: number, now: Date) {
    const since = new Date(now.getTime() - days * DAY_MS)
    const deliveries = await this.deliveryRepository.findForWaitRecord(partner.id, since)
    return { days, ...waitRecordOf(deliveries, partner.usualPrepMinutes) }
  }
}
