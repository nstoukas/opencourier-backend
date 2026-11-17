import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { EnumDeliveryIssueReason } from '@prisma/types'
import {
  DeliveryIssueForAdmin,
  DeliveryIssueRepository,
  DeliveryIssueWithCourier,
} from 'src/persistence/repositories/delivery-issue.repository'
import { ChatDomainService } from 'src/domains/chat/chat.domain.service'
import { DELIVERY_ISSUE_REASON_TO_HUMAN } from 'src/shared-types/delivery-issue'

// Riders' reports about a delivery (decision 66.11). Not a DeliveryEvent: a report changes no
// status, pay or assignment; it is a note for the admin, kept with its rider and time.
@Injectable()
export class DeliveryIssueDomainService {
  private readonly logger = new Logger(DeliveryIssueDomainService.name)

  constructor(
    private readonly deliveryIssueRepository: DeliveryIssueRepository,
    private readonly chatDomainService: ChatDomainService
  ) {}

  async report(input: {
    deliveryId: string
    courierId: string
    reason: EnumDeliveryIssueReason
    note?: string | null
  }): Promise<DeliveryIssueWithCourier> {
    // An empty or blank note is stored as no note.
    const note = input.note?.trim() ? input.note.trim() : null
    const issue = await this.deliveryIssueRepository.create({ ...input, note })
    await this.addChatLine(issue)
    return issue
  }

  // Spec 0034 (chat), AC-16: the report also appears in the rider's thread with dispatch, tagged with the
  // delivery, in the same words the board uses. The report is already saved: if this fails, the report
  // still succeeds and the failure is logged by id.
  private async addChatLine(issue: DeliveryIssueWithCourier): Promise<void> {
    const words = `Reported: ${DELIVERY_ISSUE_REASON_TO_HUMAN[issue.reason]}`
    try {
      await this.chatDomainService.addSystemLine(issue.courierId, issue.deliveryId, issue.note ? `${words}\n${issue.note}` : words)
    } catch (error) {
      this.logger.error(`Could not add report ${issue.id} to the rider's chat: ${error}`)
    }
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
