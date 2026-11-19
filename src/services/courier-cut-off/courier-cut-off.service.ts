import { Injectable, Logger } from '@nestjs/common'
import { EnumCourierStatus } from '@prisma/types'
import { CourierDomainService } from 'src/domains/courier/courier.domain.service'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { CourierDeviceRepository } from 'src/persistence/repositories/courier-device.repository'
import { DeliveryEventService } from 'src/services/delivery-event/delivery-event.service'
import { WebsocketDispatcher } from 'src/services/websocket/models/WebsocketDispatcher'

// What happens to a rider's phones after their password changes (spec 0013, AC-5 b, c, d), shared
// by an admin setting a new password and a rider's own reset by email (row 17, spec 0039, AC-10).
// Moved here from CourierAdminRestApiService unchanged, so both paths cut a phone off the same way.
@Injectable()
export class CourierCutOffService {
  private readonly logger = new Logger(CourierCutOffService.name)

  constructor(
    private readonly websocketDispatcher: WebsocketDispatcher,
    private readonly courierDeviceRepository: CourierDeviceRepository,
    private readonly courierDomainService: CourierDomainService,
    private readonly deliveryEventService: DeliveryEventService
  ) {}

  // After the password is saved, the old phone is cut off beyond its tokens: its live connection,
  // its offer pushes, and its Online status. Each step is tried on its own; a failure is logged and
  // does not undo the password, which already stops the phone at its next request.
  async cutOff(courier: CourierEntity): Promise<void> {
    try {
      await this.websocketDispatcher.disconnectUser(courier.userId)
    } catch (error) {
      this.logger.error(`Could not close the connections of courier ${courier.id}`, error as Error)
    }

    try {
      await this.courierDeviceRepository.deleteAllForCourier(courier.id)
    } catch (error) {
      this.logger.error(`Could not remove the devices of courier ${courier.id}`, error as Error)
    }

    try {
      // The same path as an admin setting a rider Offline (the PATCH route): open offers end. A
      // delivery the rider holds stays theirs.
      await this.courierDomainService.update(courier.id, { status: EnumCourierStatus.OFFLINE })
      await this.deliveryEventService.handleCourierStatusChanged(courier.id, EnumCourierStatus.OFFLINE)
    } catch (error) {
      this.logger.error(`Could not set courier ${courier.id} Offline`, error as Error)
    }
  }
}
