import { Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { AxiosResponse } from 'axios'
import { EnumDeliveryEventType, EnumDeliveryStatus } from '@prisma/types'
import { PartnerWebhookService } from './partner-webhooks.service'
import { PartnerWebhookEventType } from './enums/partner-webhook-event-type.enum'
import { DeliveryRepository } from 'src/persistence/repositories/delivery.repository'
import { PartnerRepository } from 'src/persistence/repositories/partner.repository'
import { CourierRepository } from 'src/persistence/repositories/courier.repository'
import { DeliveryStatusUpdateEvent } from 'src/shared-types/index'

describe('PartnerWebhookService (Spec 0016 AC-12, Decision 31.18: webhook logs ids only)', () => {
  let service: PartnerWebhookService
  let partnerRepository: jest.Mocked<PartnerRepository>
  let deliveryRepository: jest.Mocked<DeliveryRepository>
  let courierRepository: jest.Mocked<CourierRepository>
  let httpService: { axiosRef: { post: jest.Mock } }

  let consoleLogSpy: jest.SpyInstance
  let loggerLogSpy: jest.SpyInstance
  let loggerErrorSpy: jest.SpyInstance
  let loggerWarnSpy: jest.SpyInstance

  const sampleDelivery = {
    id: 'del-100',
    partnerId: 'partner-200',
    courierId: 'courier-300',
    dropoffName: 'Eleni Papadopoulou',
    dropoffPhoneNumber: '+306912345678',
    dropoffFloor: '3rd Floor Apt 4B',
    dropoffDoorbell: 'Papadopoulou',
    dropoffNotes: 'Floor: 3rd Floor Apt 4B · Doorbell: Papadopoulou · Ring twice',
    dropoffSellerNotes: 'Ring twice',
  }

  const samplePartner = {
    id: 'partner-200',
    name: 'Nosh Grill House',
    webhookUrl: 'https://nosh.example.com/api/webhooks/delivery',
  }

  const sampleCourier = {
    id: 'courier-300',
    name: 'Alexandros Courier',
  }

  const sampleEvent: DeliveryStatusUpdateEvent = {
    deliveryId: 'del-100',
    oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
    status: EnumDeliveryStatus.ACCEPTED,
    event: {
      id: 'event-1',
      deliveryId: 'del-100',
      type: EnumDeliveryEventType.ACCEPTED,
      actor: 'COURIER',
      occurredAt: new Date('2026-11-02T03:00:00.000Z'),
      createdAt: new Date('2026-11-02T03:00:00.000Z'),
    } as any,
  }

  beforeEach(() => {
    // Spy on console.log and Nest Logger methods to verify personal data is never printed
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})

    partnerRepository = {
      findById: jest.fn().mockResolvedValue(samplePartner),
    } as any

    deliveryRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue(sampleDelivery),
    } as any

    courierRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue(sampleCourier),
    } as any

    httpService = {
      axiosRef: {
        post: jest.fn().mockResolvedValue({
          status: 200,
          data: { received: true },
        } as AxiosResponse),
      },
    }

    service = new PartnerWebhookService(
      partnerRepository,
      deliveryRepository,
      courierRepository,
      httpService as unknown as HttpService
    )
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    loggerLogSpy.mockRestore()
    loggerErrorSpy.mockRestore()
    loggerWarnSpy.mockRestore()
  })

  // Helper to stringify all logged items across console and Nest logger for personal data audit
  function getAllLogs(): string {
    const allCalls = [
      ...consoleLogSpy.mock.calls,
      ...loggerLogSpy.mock.calls,
      ...loggerErrorSpy.mock.calls,
      ...loggerWarnSpy.mock.calls,
    ]
    return allCalls
      .flat()
      .map((arg) => (typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : String(arg)))
      .join('\n')
  }

  describe('Happy path: delivery status change webhook', () => {
    test('sends full payload to partner webhookUrl and logs partner id, delivery id and statuses only', async () => {
      await service.sendDeliveryUpdatePartnerWebhook(sampleEvent)

      // 1. POST still sends the full payload (delivery included) to partner's webhookUrl
      expect(httpService.axiosRef.post).toHaveBeenCalledTimes(1)
      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        samplePartner.webhookUrl,
        expect.objectContaining({
          eventType: PartnerWebhookEventType.DELIVERY_STATUS_CHANGED,
          event: EnumDeliveryEventType.ACCEPTED,
          deliveryId: 'del-100',
          partnerId: 'partner-200',
          oldStatus: EnumDeliveryStatus.ASSIGNING_COURIER,
          newStatus: EnumDeliveryStatus.ACCEPTED,
          delivery: sampleDelivery,
          courier: sampleCourier,
        })
      )

      // 2. What it logs names partner id, delivery id and the two statuses (and response status)
      const allLogs = getAllLogs()
      expect(allLogs).toContain('partner-200')
      expect(allLogs).toContain('del-100')
      expect(allLogs).toContain(EnumDeliveryStatus.ASSIGNING_COURIER)
      expect(allLogs).toContain(EnumDeliveryStatus.ACCEPTED)
      expect(allLogs).toContain('200')

      // 3. AC-12: Nothing it logs contains customer's name, phone, floor, doorbell or notes
      expect(allLogs).not.toContain(sampleDelivery.dropoffName)
      expect(allLogs).not.toContain(sampleDelivery.dropoffPhoneNumber)
      expect(allLogs).not.toContain(sampleDelivery.dropoffFloor)
      expect(allLogs).not.toContain(sampleDelivery.dropoffDoorbell)
      expect(allLogs).not.toContain('Ring twice')
      expect(allLogs).not.toContain('Floor: 3rd Floor Apt 4B')
    })

    test('omits courier lookup when delivery has no courierId and sends courier null in payload', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...sampleDelivery,
        courierId: null,
      } as any)

      await service.sendDeliveryUpdatePartnerWebhook(sampleEvent)

      expect(courierRepository.findByIdOrThrow).not.toHaveBeenCalled()
      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        samplePartner.webhookUrl,
        expect.objectContaining({
          courier: null,
        })
      )

      const allLogs = getAllLogs()
      expect(allLogs).not.toContain(sampleDelivery.dropoffName)
      expect(allLogs).not.toContain(sampleDelivery.dropoffPhoneNumber)
      expect(allLogs).not.toContain(sampleDelivery.dropoffFloor)
      expect(allLogs).not.toContain(sampleDelivery.dropoffDoorbell)
    })
  })

  describe('Edge and failure cases', () => {
    test('logs error and skips webhook POST when delivery has no partnerId', async () => {
      deliveryRepository.findByIdOrThrow.mockResolvedValue({
        ...sampleDelivery,
        partnerId: null,
      } as any)

      await service.sendDeliveryUpdatePartnerWebhook(sampleEvent)

      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Delivery del-100 has no partner'))
      expect(httpService.axiosRef.post).not.toHaveBeenCalled()

      const allLogs = getAllLogs()
      expect(allLogs).not.toContain(sampleDelivery.dropoffName)
      expect(allLogs).not.toContain(sampleDelivery.dropoffPhoneNumber)
      expect(allLogs).not.toContain(sampleDelivery.dropoffFloor)
      expect(allLogs).not.toContain(sampleDelivery.dropoffDoorbell)
    })

    test('logs error and skips webhook POST when partner is not found in database', async () => {
      partnerRepository.findById.mockResolvedValue(null)

      await service.sendDeliveryUpdatePartnerWebhook(sampleEvent)

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Partner partner-200 not found for delivery del-100')
      )
      expect(httpService.axiosRef.post).not.toHaveBeenCalled()

      const allLogs = getAllLogs()
      expect(allLogs).not.toContain(sampleDelivery.dropoffName)
      expect(allLogs).not.toContain(sampleDelivery.dropoffPhoneNumber)
    })

    test('logs error and skips webhook POST when partner has no webhookUrl', async () => {
      partnerRepository.findById.mockResolvedValue({
        ...samplePartner,
        webhookUrl: '',
      } as any)

      await service.sendDeliveryUpdatePartnerWebhook(sampleEvent)

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Partner partner-200 has no webhook URL')
      )
      expect(httpService.axiosRef.post).not.toHaveBeenCalled()

      const allLogs = getAllLogs()
      expect(allLogs).not.toContain(sampleDelivery.dropoffName)
      expect(allLogs).not.toContain(sampleDelivery.dropoffPhoneNumber)
    })
  })
})
