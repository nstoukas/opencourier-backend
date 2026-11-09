import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import {
  EnumDeliveryEventSource,
  EnumDeliveryEventType,
  EnumDeliveryStatus,
  EnumEventActor,
  EnumProductReportKind,
  EnumProductReportSource,
} from '@prisma/types'
import { NotFoundException } from 'src/errors'
import {
  ProductReportRepository,
  ProductReportState,
} from 'src/persistence/repositories/product-report.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'

export const COURIER_REPORT_STATUSES: EnumDeliveryStatus[] = [
  EnumDeliveryStatus.COURIER_ARRIVED_AT_DROPOFF_LOCATION,
  EnumDeliveryStatus.DROPPED_OFF,
]

const ACTOR_OF: Record<EnumProductReportSource, EnumEventActor> = {
  COURIER: EnumEventActor.COURIER,
  PARTNER: EnumEventActor.PARTNER,
  ADMIN: EnumEventActor.ADMIN,
}

export type ProductReportInput = {
  kind: EnumProductReportKind
  itemName?: string | null
  note?: string | null
}

const cleaned = (value: string | null | undefined): string | null => (value?.trim() ? value.trim() : null)

// Spec 0032: a wrong or missing product, reported by a rider, a restaurant or an admin. A report
// changes no pay and no status (AC-8): it is one row and one event.
@Injectable()
export class ProductReportDomainService {
  constructor(
    private readonly productReportRepository: ProductReportRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryEventService: DeliveryEventService
  ) {}

  async report(
    delivery: { id: string; status: EnumDeliveryStatus },
    source: EnumProductReportSource,
    reporterUserId: string,
    input: ProductReportInput,
    courierId?: string
  ) {
    const itemName = cleaned(input.itemName)
    const note = cleaned(input.note)
    if (!itemName && !note) {
      throw new BadRequestException('Name the item or add a note.')
    }
    const report = await this.productReportRepository.create({
      deliveryId: delivery.id,
      kind: input.kind,
      source,
      reporterUserId,
      itemName,
      note,
    })
    // The note stays on the report: the event is read more widely (decision 15.3).
    const event = {
      deliveryId: delivery.id,
      type: EnumDeliveryEventType.PRODUCT_REPORTED,
      actor: ACTOR_OF[source],
      source: source === 'PARTNER' ? EnumDeliveryEventSource.PARTNER_APP : EnumDeliveryEventSource.OPENCOURIER,
      message: `Reported ${input.kind}${itemName ? `: ${itemName}` : ''} (${source})`,
      ...(courierId ? { courierId } : {}),
    }
    await this.deliveryEventService.recordProductReportEvent(event, delivery.status)
    return report
  }

  async listForDelivery(deliveryId: string) {
    return this.productReportRepository.findForDelivery(deliveryId)
  }

  async listPage(state: ProductReportState, page?: number, perPage?: number) {
    return this.productReportRepository.findPage(state, page, perPage)
  }

  // Resolving twice answers the report unchanged and records nothing (AC-7).
  async resolve(id: string, adminUserId: string, resolution?: string | null) {
    const report = await this.productReportRepository.findById(id)
    if (!report) throw new NotFoundException('Product report not found')
    const written = await this.productReportRepository.resolveIfOpen(id, adminUserId, cleaned(resolution))
    if (written) {
      const delivery = await this.deliveryRepository.findByIdOrThrow(report.deliveryId)
      await this.deliveryEventService.recordProductReportEvent(
        {
          deliveryId: report.deliveryId,
          type: EnumDeliveryEventType.PRODUCT_REPORT_RESOLVED,
          actor: EnumEventActor.ADMIN,
          source: EnumDeliveryEventSource.OPENCOURIER,
          message: `Report resolved (${report.kind})`,
        },
        delivery.status
      )
    }
    return this.productReportRepository.findById(id)
  }

  refuseUnlessCourierMayReport(status: EnumDeliveryStatus): void {
    if (!COURIER_REPORT_STATUSES.includes(status)) {
      throw new ConflictException('You can report this once you are at the customer.')
    }
  }

  refuseUnlessPartnerMayReport(status: EnumDeliveryStatus): void {
    if (status !== EnumDeliveryStatus.DROPPED_OFF) {
      throw new ConflictException('You can report this once the order is delivered.')
    }
  }
}
