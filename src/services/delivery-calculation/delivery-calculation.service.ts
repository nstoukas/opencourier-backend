import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { addMinutes } from 'src/core/utils/time'
import { QuoteCalculationService } from '../quote-calculation/quote-calculation.service'
import { GeoCalculationService } from '../geo-calculation/geo-calculation.service'
import { IDeliveryCalculationsInput } from './interfaces/IDeliveryCalculationsInput'
import { DeliveryDurationCalculationService } from '../duration-calculation/delivery-duration-calculation.service'
import { IDeliveryQuoteDropoffEtaCalculationInput } from './interfaces/IDeliveryQuoteDropoffEtaCalculationInput'
import { IDeliveryCalculationService } from './interfaces/IDeliveryCalculationService'
import { DeliveryQuoteAmountResult } from '../quote-calculation/types/delivery-quote-amount-result.type'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { IDeliveryAmountsCalculationsInput } from './interfaces/IDeliveryAmountsCalculationsInput'
import { CourierCompensationService } from '../courier-compensation/courier-compensation.service'
import { IDeliveryAmountsCalculationsResult } from './interfaces/IDeliveryAmountsCalculationsResult'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { DeliveryQuoteRepository } from 'src/persistence/repositories/delivery-quote.repository'
import { roundMoney } from 'src/core/utils/money'

interface DeliveryQuoteAmountResultWithFeePercentage extends DeliveryQuoteAmountResult {
  feePercentage: number
}

@Injectable()
export class DeliveryCalculationService implements IDeliveryCalculationService {
  private readonly logger = new Logger(DeliveryCalculationService.name)

  constructor(
    private readonly configDomainService: ConfigDomainService,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryQuoteRepository: DeliveryQuoteRepository,
    private readonly geoCalculationService: GeoCalculationService,
    private readonly quoteCalculationService: QuoteCalculationService,
    private readonly courierCompensationService: CourierCompensationService,
    private readonly deliveryDurationCalculationModule: DeliveryDurationCalculationService
  ) {}

  async calculateDeliveryQuoteDistance(input: IDeliveryCalculationsInput) {
    const { pickupLocation, dropoffLocation } = input

    return Promise.resolve(
      this.geoCalculationService.calculateDistance({
        fromLocation: pickupLocation,
        toLocation: dropoffLocation,
      })
    )
  }

  async calculateDeliveryQuoteAmount(
    input: IDeliveryCalculationsInput
  ): Promise<DeliveryQuoteAmountResultWithFeePercentage> {
    const { pickupLocation, dropoffLocation, pickupReadyAt } = input

    const quote = await this.quoteCalculationService.calculateDeliveryQuote({
      pickupLocation: pickupLocation,
      dropoffLocation: dropoffLocation,
      pickupReadyAt: pickupReadyAt,
    })

    // Spec 0001: the customer price is built from the two parts the rider is paid, plus the
    // co-op fee, added once on top. The price services' own totals are not used here.
    const { baseFee, distanceFee } = quote
    const riderPay = baseFee + distanceFee

    const feePercentage = await this.configDomainService.instanceConfig.getFeePercentageAmount()
    const coopFee = this.calculateCoopFee(riderPay, feePercentage)
    const customerPrice = riderPay + coopFee

    return {
      quoteRangeFrom: customerPrice,
      quoteRangeTo: customerPrice,
      baseFee,
      distanceFee,
      feePercentage: feePercentage,
    }
  }

  async calculateDeliveryAmountsForMatchedCourier(
    input: IDeliveryAmountsCalculationsInput
  ): Promise<IDeliveryAmountsCalculationsResult> {
    const { deliveryId } = input

    const delivery = await this.deliveryRepository.findById(deliveryId)

    if (!delivery) {
      this.logger.error(`Delivery not found: ${deliveryId}`)
      throw new BadRequestException('Delivery not found')
    }

    if (!delivery.matchedCourierId) {
      this.logger.error(`Delivery has no matched courier: ${deliveryId}`)
      throw new BadRequestException('Delivery not found')
    }

    // The rider's pay: the quote's base fee plus distance fee, with no fee inside it.
    const courierCompensation = await this.courierCompensationService.calculateCourierCompensationForDelivery({
      courierId: delivery.matchedCourierId,
      deliveryId: deliveryId,
    })

    // Everything else comes from the stored quote too, never from today's settings, so a fee %
    // changed after the quote was made cannot change what this delivery costs or pays.
    const quote = await this.deliveryQuoteRepository.findById(delivery.deliveryQuoteId)
    if (!quote) {
      this.logger.error(`Delivery quote not found: ${delivery.deliveryQuoteId}`)
      throw new BadRequestException('Delivery quote not found')
    }

    return {
      deliveryId: deliveryId,
      totalCompensation: courierCompensation,
      totalCost: quote.quoteRangeFrom,
      fee: quote.quoteRangeFrom - (quote.baseFee + quote.distanceFee),
      feePercentage: quote.feePercentage,
    }
  }

  async calculateDeliveryQuoteExpiration(input: IDeliveryCalculationsInput) {
    const quoteExpirationMinutes = await this.configDomainService.instanceConfig.getQuoteExpirationMinutes()

    if (!quoteExpirationMinutes) {
      throw new BadRequestException('Missing quote expiration minutes configuration')
    }

    return Promise.resolve(addMinutes(new Date(), quoteExpirationMinutes))
  }

  async calculateDeliveryQuoteDeliveryDuration(input: IDeliveryCalculationsInput) {
    const { pickupLocation, dropoffLocation } = input

    return Promise.resolve(
      this.deliveryDurationCalculationModule.calculateDeliveryDuration({
        pickupLocation: pickupLocation,
        dropoffLocation: dropoffLocation,
      })
    )
  }

  async calculateDeliveryQuoteDeliveryPickupDuration(input: IDeliveryCalculationsInput) {
    const { pickupLocation, dropoffLocation } = input

    return Promise.resolve(
      this.deliveryDurationCalculationModule.calculateDeliveryDuration({
        pickupLocation: pickupLocation,
        dropoffLocation: dropoffLocation,
      })
    )
  }

  async calculateDropoffEta(input: IDeliveryQuoteDropoffEtaCalculationInput) {
    const { pickupReadyAt, duration } = input

    if (!pickupReadyAt || !duration) {
      this.logger.warn('pickupReadyAt and duration are required to calculate dropoff')
      return null
    }

    const dropoffEta = new Date(new Date(pickupReadyAt).getTime() + duration * 60000)

    return Promise.resolve(dropoffEta)
  }

  // The co-op's share, in whole cents, charged to the customer on top of the rider's pay.
  // Worked example from spec 0001: rider pay 307 at 10% gives round(30.7) = 31.
  private calculateCoopFee(riderPay: number, feePercentage: number): number {
    if (riderPay <= 0 || feePercentage <= 0) {
      return 0
    }

    return roundMoney((riderPay * feePercentage) / 100)
  }
}
