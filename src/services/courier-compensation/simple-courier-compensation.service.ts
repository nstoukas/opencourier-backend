import { Injectable, Logger } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { ICourierCompensationService } from './interfaces/ICourierCompensationService'
import { ICourierCompensationForDeliveryInput } from './interfaces/ICourierCompensationForDeliveryInput'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryQuoteRepository } from 'src/persistence/repositories/delivery-quote.repository'
import { applyMinimumCourierPay } from './utils/minimum-courier-pay.util'

@Injectable()
export class SimpleCourierCompensationService implements ICourierCompensationService {
  private readonly logger = new Logger(SimpleCourierCompensationService.name)

  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly courierRepository: CourierRepository,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryQuoteRepository: DeliveryQuoteRepository
  ) {}

  async calculateCourierCompensation(input: ICourierCompensationForDeliveryInput): Promise<number> {
    this.logger.log('Calculating courier compensation')

    return Promise.resolve(1)
  }

  async calculateCourierCompensationForDelivery(input: ICourierCompensationForDeliveryInput): Promise<number> {
    this.logger.log('Calculating courier compensation for delivery')
    const { courierId, deliveryId } = input

    const courier = await this.courierRepository.findById(courierId)
    if (!courier) {
      this.logger.error(`Courier not found: ${courierId}`)
      return Promise.reject(new Error(`Courier not found: ${courierId}`))
    }

    const delivery = await this.deliveryRepository.findById(deliveryId)
    if (!delivery) {
      this.logger.error(`Delivery not found: ${deliveryId}`)
      return Promise.reject(new Error(`Delivery not found: ${deliveryId}`))
    }

    const deliveryQuote = await this.deliveryQuoteRepository.findById(delivery.deliveryQuoteId)
    if (!deliveryQuote) {
      this.logger.error(`Delivery quote not found: ${delivery.deliveryQuoteId}`)
      return Promise.reject(new Error(`Delivery quote not found: ${delivery.deliveryQuoteId}`))
    }

    const minimumCourierPay = await this.configDomainService.instanceConfig.getDefaultMinimumCourierPay()
    const compensation = applyMinimumCourierPay(deliveryQuote.quoteRangeFrom, minimumCourierPay)

    if (compensation > deliveryQuote.quoteRangeFrom) {
      // The customer was quoted less than the floor. The difference is the instance's to absorb,
      // so it is logged per delivery rather than left to be inferred from two tables.
      this.logger.warn(
        `Minimum courier pay applied to delivery ${deliveryId}: quote ${deliveryQuote.quoteRangeFrom} ` +
          `raised to ${compensation} (defaultMinimumCourierPay=${minimumCourierPay}). ` +
          `The instance absorbs the difference of ${compensation - deliveryQuote.quoteRangeFrom}.`
      )
    }

    return compensation
  }
}
