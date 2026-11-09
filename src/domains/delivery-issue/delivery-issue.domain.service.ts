import { Injectable, NotFoundException } from '@nestjs/common'
import { EnumDeliveryIssueReason } from '@prisma/types'
import {
  DeliveryIssueForAdmin,
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

  async listForDelivery(deliveryId: string): Promise<DeliveryIssueForAdmin[]> {
    return this.deliveryIssueRepository.findForDelivery(deliveryId)
  }

  // Spec 0034, AC-7. No DeliveryEvent: this touches neither pay nor assignment, and handledByUserId
  // is the record.
  async markHandled(deliveryId: string, issueId: string, userId: string): Promise<DeliveryIssueForAdmin> {
    const issue = await this.deliveryIssueRepository.markHandled(deliveryId, issueId, userId, new Date())
    if (!issue) {
      throw new NotFoundException(`Report ${issueId} not found on delivery ${deliveryId}`)
    }
    return issue
  }
}
