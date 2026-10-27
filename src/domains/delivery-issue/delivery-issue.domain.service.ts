import { Injectable } from '@nestjs/common'
import { EnumDeliveryIssueReason } from '@prisma/types'
import {
  DeliveryIssueRepository,
  DeliveryIssueWithCourier,
} from 'src/persistence/repositories/delivery-issue.repository'

// Riders' reports about a delivery (decision 66.11). Not a DeliveryEvent: a report changes no
// status, pay or assignment; it is a note for the admin, kept with its rider and time.
@Injectable()
export class DeliveryIssueDomainService {
  constructor(private readonly deliveryIssueRepository: DeliveryIssueRepository) {}

  async report(input: {
    deliveryId: string
    courierId: string
    reason: EnumDeliveryIssueReason
    note?: string | null
  }): Promise<DeliveryIssueWithCourier> {
    // An empty or blank note is stored as no note.
    const note = input.note?.trim() ? input.note.trim() : null
    return this.deliveryIssueRepository.create({ ...input, note })
  }

  async listForDelivery(deliveryId: string): Promise<DeliveryIssueWithCourier[]> {
    return this.deliveryIssueRepository.findForDelivery(deliveryId)
  }
}
