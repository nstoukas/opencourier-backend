import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common'
import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryStatus,
} from '@prisma/types'
import { NotFoundException } from 'src/errors'
import {
  ComplaintService,
  COMPLAINT_NO_PHOTO,
  COMPLAINT_PHOTO_READ_DOWN,
  COMPLAINT_PHOTO_STORAGE_DOWN,
  COMPLAINT_PICK_RIDER,
} from './complaint.service'
import {
  COMPLAINT_ABOUT_NOT_ALLOWED,
  COMPLAINT_ALREADY_OPEN,
  COMPLAINT_ALREADY_REPLIED,
  COMPLAINT_AWAITING_REPLY,
  COMPLAINT_CATEGORY_MISMATCH,
  COMPLAINT_CLOSED,
  COMPLAINT_NO_RIDER,
  COMPLAINT_NOT_FOUND,
  COMPLAINT_ORDER_NOT_ENDED,
  COMPLAINT_OUTCOME_MESSAGE,
  COMPLAINT_REPLY_MESSAGE,
  COMPLAINT_RIDER_CAN_REPLY,
  COMPLAINT_RIDER_NOT_ON_ORDER,
  COMPLAINT_TEXT_MESSAGE,
  COMPLAINT_WITHDRAW_REASON_MESSAGE,
} from 'src/domains/complaint/complaint-rules'
import { ComplaintRecord, ComplaintRepository } from 'src/persistence/repositories/complaint.repository'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { OfferPushService } from 'src/services/pushNotification/offer-push.service'
import { StorageProvider, StoredFileNotFoundError } from 'src/services/storage/models/StorageProvider'
import { Readable } from 'stream'
import sharp from 'sharp'

describe('ComplaintService (Spec 0052, AC-1 to AC-7, AC-9, AC-10)', () => {
  let service: ComplaintService
  let mockComplaintRepository: jest.Mocked<ComplaintRepository>
  let mockConfigDomainService: jest.Mocked<ConfigDomainService>
  let mockOfferPushService: jest.Mocked<OfferPushService>
  let mockStorageProvider: jest.Mocked<StorageProvider>
  let validTestJpeg: Buffer

  const courierId = 'courier-c1'
  const partnerId = 'partner-p1'
  const adminUserId = 'admin-u1'
  const deliveryId = 'del-101'
  const complaintId = 'comp-1'

  beforeAll(async () => {
    validTestJpeg = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer()
  })

  // Helper to build a sample complaint record
  function makeComplaintRecord(overrides: Partial<ComplaintRecord> = {}): ComplaintRecord {
    return {
      id: complaintId,
      filedBy: EnumComplaintFiledBy.RIDER,
      about: EnumComplaintAbout.RESTAURANT,
      category: EnumComplaintCategory.LONG_WAIT,
      text: 'Waited 30 minutes for food',
      status: EnumComplaintStatus.OPEN,
      createdAt: new Date(),
      openFor: `RIDER:${courierId}:${deliveryId}:RESTAURANT`,
      photoKey: null,
      deliveryId,
      filerCourierId: courierId,
      filerPartnerId: null,
      filerAdminId: null,
      aboutCourierId: null,
      riderReply: null,
      repliedAt: null,
      replyEnteredByUserId: null,
      outcome: null,
      decidedAt: null,
      decidedByUserId: null,
      withdrawnReason: null,
      withdrawnAt: null,
      withdrawnByUserId: null,
      delivery: {
        id: deliveryId,
        pickupBusinessName: 'Test Tavern',
        createdAt: new Date(),
        status: EnumDeliveryStatus.DROPPED_OFF,
      },
      filerCourier: { id: courierId, firstName: 'Nikos', lastName: 'Rider' },
      filerPartner: null,
      filerAdmin: null,
      aboutCourier: null,
      replyEnteredBy: null,
      decidedBy: null,
      withdrawnBy: null,
      ...overrides,
    } as ComplaintRecord
  }

  beforeEach(() => {
    mockComplaintRepository = {
      findDeliveryFacts: jest.fn(),
      findAcceptTimes: jest.fn(),
      findRidersWhoAccepted: jest.fn(),
      findRiderNames: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      reply: jest.fn(),
      decide: jest.fn(),
      withdraw: jest.fn(),
      findPageForCourier: jest.fn(),
      findPageForPartner: jest.fn(),
      findPageForAdmin: jest.fn(),
    } as unknown as jest.Mocked<ComplaintRepository>

    mockConfigDomainService = {
      instanceConfig: {
        getRestaurantHistoryDays: jest.fn().mockResolvedValue(30),
      },
    } as unknown as jest.Mocked<ConfigDomainService>

    mockOfferPushService = {
      complaintNeedsReply: jest.fn(),
    } as unknown as jest.Mocked<OfferPushService>

    mockStorageProvider = {
      put: jest.fn().mockResolvedValue(undefined),
      getStream: jest.fn().mockResolvedValue(Readable.from(['photo-bytes'])),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<StorageProvider>

    service = new ComplaintService(
      mockComplaintRepository,
      mockConfigDomainService,
      mockOfferPushService,
      mockStorageProvider
    )
  })

  // --------------------------------------------------------------------------
  // AC-2: Rider Filing
  // --------------------------------------------------------------------------
  describe('fileByRider (AC-2)', () => {
    const validRiderInput = {
      deliveryId,
      about: EnumComplaintAbout.RESTAURANT,
      category: EnumComplaintCategory.LONG_WAIT,
      text: 'Restaurant delayed food by 40 minutes.',
    }

    it('successfully files a complaint about a restaurant with status OPEN', async () => {
      // Recent accept within reach
      mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
      const createdRecord = makeComplaintRecord()
      mockComplaintRepository.create.mockResolvedValue(createdRecord)

      const result = await service.fileByRider(courierId, validRiderInput)

      expect(result).toBe(createdRecord)
      expect(mockComplaintRepository.create).toHaveBeenCalledWith({
        deliveryId,
        filedBy: EnumComplaintFiledBy.RIDER,
        filerCourierId: courierId,
        about: EnumComplaintAbout.RESTAURANT,
        category: EnumComplaintCategory.LONG_WAIT,
        text: 'Restaurant delayed food by 40 minutes.',
        status: EnumComplaintStatus.OPEN,
        openFor: `RIDER:${courierId}:${deliveryId}:RESTAURANT`,
        photoKey: null,
      })
      // AC-10: No delivery event emitted
      // AC-4: No push notification when rider files about restaurant
      expect(mockOfferPushService.complaintNeedsReply).not.toHaveBeenCalled()
    })

    it('successfully files a complaint about a customer', async () => {
      mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
      const customerRecord = makeComplaintRecord({
        about: EnumComplaintAbout.CUSTOMER,
        category: EnumComplaintCategory.ABUSE_OR_THREAT,
        openFor: `RIDER:${courierId}:${deliveryId}:CUSTOMER`,
      })
      mockComplaintRepository.create.mockResolvedValue(customerRecord)

      const result = await service.fileByRider(courierId, {
        deliveryId,
        about: EnumComplaintAbout.CUSTOMER,
        category: EnumComplaintCategory.ABUSE_OR_THREAT,
        text: 'Customer threatened at door.',
      })

      expect(result).toBe(customerRecord)
      expect(mockComplaintRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          about: EnumComplaintAbout.CUSTOMER,
          category: EnumComplaintCategory.ABUSE_OR_THREAT,
          status: EnumComplaintStatus.OPEN,
        })
      )
    })

    it('rejects if rider was never on delivery or last accept older than Earnings reach (NotFound)', async () => {
      // Empty accept times
      mockComplaintRepository.findAcceptTimes.mockResolvedValue([])

      await expect(
        service.fileByRider(courierId, validRiderInput)
      ).rejects.toThrow(new NotFoundException('Delivery not found'))

      // Accept older than 2 months
      const oldDate = new Date('2020-01-01T00:00:00Z')
      mockComplaintRepository.findAcceptTimes.mockResolvedValue([oldDate])

      await expect(
        service.fileByRider(courierId, validRiderInput)
      ).rejects.toThrow(new NotFoundException('Delivery not found'))
    })

    it('rejects if rider tries to complain about another rider (BadRequest)', async () => {
      await expect(
        service.fileByRider(courierId, {
          deliveryId,
          about: EnumComplaintAbout.RIDER,
          category: EnumComplaintCategory.LATE,
          text: 'Another rider was rude.',
        })
      ).rejects.toThrow(new BadRequestException(COMPLAINT_ABOUT_NOT_ALLOWED))
    })

    it('rejects if category does not fit the party (BadRequest)', async () => {
      await expect(
        service.fileByRider(courierId, {
          deliveryId,
          about: EnumComplaintAbout.RESTAURANT,
          category: EnumComplaintCategory.ABUSE_OR_THREAT, // customer only
          text: 'Wrong category for restaurant.',
        })
      ).rejects.toThrow(new BadRequestException(COMPLAINT_CATEGORY_MISMATCH))
    })

    it('rejects empty or whitespace-only text (BadRequest)', async () => {
      await expect(
        service.fileByRider(courierId, {
          deliveryId,
          about: EnumComplaintAbout.RESTAURANT,
          category: EnumComplaintCategory.LONG_WAIT,
          text: '   ',
        })
      ).rejects.toThrow(new BadRequestException(COMPLAINT_TEXT_MESSAGE))
    })

    it('rejects text over 1000 characters (BadRequest)', async () => {
      await expect(
        service.fileByRider(courierId, {
          deliveryId,
          about: EnumComplaintAbout.RESTAURANT,
          category: EnumComplaintCategory.LONG_WAIT,
          text: 'a'.repeat(1001),
        })
      ).rejects.toThrow(new BadRequestException(COMPLAINT_TEXT_MESSAGE))
    })

    it('rejects duplicate open complaint with 409 Conflict', async () => {
      mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
      mockComplaintRepository.create.mockResolvedValue(null) // unique constraint failure on openFor

      await expect(
        service.fileByRider(courierId, validRiderInput)
      ).rejects.toThrow(new ConflictException(COMPLAINT_ALREADY_OPEN))
    })

    describe('with photo upload (AC-2, AC-9, cross check 4)', () => {
      it('cleans photo, stores in StorageProvider, and saves complaint with photoKey', async () => {
        mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
        const recordWithPhoto = makeComplaintRecord({ photoKey: 'uuid-1.jpg' })
        mockComplaintRepository.create.mockResolvedValue(recordWithPhoto)

        const result = await service.fileByRider(courierId, validRiderInput, validTestJpeg)

        expect(result).toBe(recordWithPhoto)
        expect(mockStorageProvider.put).toHaveBeenCalledWith(
          expect.stringMatching(/^[a-f0-9-]+\.jpg$/),
          expect.any(Buffer),
          'image/jpeg'
        )
      })

      it('rejects photo that is not a JPEG or PNG with 400 (AC-2, cross check 4)', async () => {
        mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
        const gifBuffer = Buffer.from('GIF89a...')

        await expect(
          service.fileByRider(courierId, validRiderInput, gifBuffer)
        ).rejects.toThrow(new BadRequestException('The photo must be a JPEG or PNG image.'))

        expect(mockStorageProvider.put).not.toHaveBeenCalled()
      })

      it('rejects corrupt photo bytes with 400 (AC-2, cross check 4)', async () => {
        mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
        const corruptJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22])

        await expect(
          service.fileByRider(courierId, validRiderInput, corruptJpeg)
        ).rejects.toThrow(new BadRequestException('The photo could not be read. Try another one.'))

        expect(mockStorageProvider.put).not.toHaveBeenCalled()
      })

      it('throws 503 if StorageProvider.put fails and does not create complaint', async () => {
        mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
        mockStorageProvider.put.mockRejectedValue(new Error('MinIO connection refused'))

        await expect(
          service.fileByRider(courierId, validRiderInput, validTestJpeg)
        ).rejects.toThrow(new ServiceUnavailableException(COMPLAINT_PHOTO_STORAGE_DOWN))

        expect(mockComplaintRepository.create).not.toHaveBeenCalled()
      })

      it('cleans up stored photo if complaint row creation fails (e.g. duplicate 409)', async () => {
        mockComplaintRepository.findAcceptTimes.mockResolvedValue([new Date()])
        mockComplaintRepository.create.mockResolvedValue(null) // unique conflict

        await expect(
          service.fileByRider(courierId, validRiderInput, validTestJpeg)
        ).rejects.toThrow(new ConflictException(COMPLAINT_ALREADY_OPEN))

        // Must clean up the stored photo from the bucket
        expect(mockStorageProvider.delete).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9-]+\.jpg$/))
      })
    })
  })

  // --------------------------------------------------------------------------
  // AC-3: Restaurant Filing
  // --------------------------------------------------------------------------
  describe('fileByRestaurant (AC-3)', () => {
    const validPartnerInput = {
      deliveryId,
      category: EnumComplaintCategory.LATE,
      text: 'Rider was 45 minutes late.',
    }

    it('successfully files complaint about rider on a delivered order, starting at AWAITING_REPLY', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId,
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue([courierId])
      const partnerComplaintRecord = makeComplaintRecord({
        filedBy: EnumComplaintFiledBy.RESTAURANT,
        filerCourierId: null,
        filerPartnerId: partnerId,
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        category: EnumComplaintCategory.LATE,
        status: EnumComplaintStatus.AWAITING_REPLY,
        openFor: `RESTAURANT:${partnerId}:${deliveryId}:RIDER`,
      })
      mockComplaintRepository.create.mockResolvedValue(partnerComplaintRecord)

      const result = await service.fileByRestaurant(partnerId, validPartnerInput)

      expect(result).toBe(partnerComplaintRecord)
      expect(mockComplaintRepository.create).toHaveBeenCalledWith({
        deliveryId,
        filedBy: EnumComplaintFiledBy.RESTAURANT,
        filerPartnerId: partnerId,
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        category: EnumComplaintCategory.LATE,
        text: 'Rider was 45 minutes late.',
        status: EnumComplaintStatus.AWAITING_REPLY,
        openFor: `RESTAURANT:${partnerId}:${deliveryId}:RIDER`,
      })

      // AC-4: Sends quiet push to rider
      expect(mockOfferPushService.complaintNeedsReply).toHaveBeenCalledWith(courierId, complaintId)
    })

    it('allows filing on a CANCELED order and uses the last rider who accepted it (cross check 3)', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.CANCELED,
        createdAt: new Date(),
        courierId: null, // cancelled order may have had courierId unlinked
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue(['courier-prev'])
      const record = makeComplaintRecord({
        filedBy: EnumComplaintFiledBy.RESTAURANT,
        aboutCourierId: 'courier-prev',
        status: EnumComplaintStatus.AWAITING_REPLY,
      })
      mockComplaintRepository.create.mockResolvedValue(record)

      await service.fileByRestaurant(partnerId, validPartnerInput)

      expect(mockComplaintRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          aboutCourierId: 'courier-prev',
          status: EnumComplaintStatus.AWAITING_REPLY,
        })
      )
      expect(mockOfferPushService.complaintNeedsReply).toHaveBeenCalledWith('courier-prev', complaintId)
    })

    it('rejects if order has not ended (not delivered or cancelled) with 409', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.ON_THE_WAY,
        createdAt: new Date(),
        courierId,
      })

      await expect(
        service.fileByRestaurant(partnerId, validPartnerInput)
      ).rejects.toThrow(new ConflictException(COMPLAINT_ORDER_NOT_ENDED))
    })

    it('rejects if delivery belongs to another restaurant with 404', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId: 'other-partner',
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId,
      })

      await expect(
        service.fileByRestaurant(partnerId, validPartnerInput)
      ).rejects.toThrow(new NotFoundException('Delivery not found'))
    })

    it('rejects if order had no rider with 409', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.CANCELED,
        createdAt: new Date(),
        courierId: null,
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue([])

      await expect(
        service.fileByRestaurant(partnerId, validPartnerInput)
      ).rejects.toThrow(new ConflictException(COMPLAINT_NO_RIDER))
    })

    it('rejects duplicate open complaint with 409', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId,
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue([courierId])
      mockComplaintRepository.create.mockResolvedValue(null) // unique openFor conflict

      await expect(
        service.fileByRestaurant(partnerId, validPartnerInput)
      ).rejects.toThrow(new ConflictException(COMPLAINT_ALREADY_OPEN))
    })
  })

  // --------------------------------------------------------------------------
  // AC-3: Admin Filing
  // --------------------------------------------------------------------------
  describe('fileByAdmin (AC-3)', () => {
    it('successfully files complaint about rider on behalf of caller with openFor: null', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.ON_THE_WAY, // Admin can file at any status
        createdAt: new Date(),
        courierId,
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue([courierId])
      const adminComplaintRecord = makeComplaintRecord({
        filedBy: EnumComplaintFiledBy.ADMIN,
        filerCourierId: null,
        filerAdminId: adminUserId,
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        status: EnumComplaintStatus.AWAITING_REPLY,
        openFor: null,
      })
      mockComplaintRepository.create.mockResolvedValue(adminComplaintRecord)

      const result = await service.fileByAdmin(adminUserId, {
        deliveryId,
        category: EnumComplaintCategory.RUDE,
        text: 'Customer Maria phoned in: rider was rude.',
      })

      expect(result).toBe(adminComplaintRecord)
      expect(mockComplaintRepository.create).toHaveBeenCalledWith({
        deliveryId,
        filedBy: EnumComplaintFiledBy.ADMIN,
        filerAdminId: adminUserId,
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        category: EnumComplaintCategory.RUDE,
        text: 'Customer Maria phoned in: rider was rude.',
        status: EnumComplaintStatus.AWAITING_REPLY,
        openFor: null,
      })
      // AC-4: Sends push notification to the rider
      expect(mockOfferPushService.complaintNeedsReply).toHaveBeenCalledWith(courierId, complaintId)
    })

    it('auto-picks the only rider if multiple were not involved', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId: 'courier-single',
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue(['courier-single'])
      mockComplaintRepository.create.mockResolvedValue(makeComplaintRecord({ aboutCourierId: 'courier-single' }))

      await service.fileByAdmin(adminUserId, {
        deliveryId,
        category: EnumComplaintCategory.FOOD_DAMAGED,
        text: 'Caller said box was crushed.',
      })

      expect(mockComplaintRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ aboutCourierId: 'courier-single' })
      )
    })

    it('requires aboutCourierId when multiple riders accepted order (BadRequest)', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId: 'courier-2',
      })
      // Two riders accepted
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue(['courier-2', 'courier-1'])

      await expect(
        service.fileByAdmin(adminUserId, {
          deliveryId,
          category: EnumComplaintCategory.RUDE,
          text: 'Caller complained about rider.',
          aboutCourierId: undefined, // not specified
        })
      ).rejects.toThrow(new BadRequestException(COMPLAINT_PICK_RIDER))
    })

    it('rejects if specified aboutCourierId was never on the order with 409', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId,
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue([courierId])

      await expect(
        service.fileByAdmin(adminUserId, {
          deliveryId,
          category: EnumComplaintCategory.RUDE,
          text: 'Caller complained about rider.',
          aboutCourierId: 'random-other-courier',
        })
      ).rejects.toThrow(new ConflictException(COMPLAINT_RIDER_NOT_ON_ORDER))
    })
  })

  // --------------------------------------------------------------------------
  // AC-5: Rider Reply
  // --------------------------------------------------------------------------
  describe('reply (AC-5)', () => {
    it('stores reply once and advances status from AWAITING_REPLY to OPEN', async () => {
      const awaitingRecord = makeComplaintRecord({
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        status: EnumComplaintStatus.AWAITING_REPLY,
        riderReply: null,
      })
      const openRecord = makeComplaintRecord({
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        status: EnumComplaintStatus.OPEN,
        riderReply: 'The packaging was already opened when restaurant handed it over.',
        repliedAt: new Date(),
      })

      mockComplaintRepository.findById
        .mockResolvedValueOnce(awaitingRecord)
        .mockResolvedValueOnce(openRecord)
      mockComplaintRepository.reply.mockResolvedValue(true)

      const result = await service.reply(
        courierId,
        complaintId,
        'The packaging was already opened when restaurant handed it over.'
      )

      expect(result).toBe(openRecord)
      expect(mockComplaintRepository.reply).toHaveBeenCalledWith(
        complaintId,
        'The packaging was already opened when restaurant handed it over.',
        null
      )
    })

    it('rejects reply if not the rider the complaint is about (NotFound)', async () => {
      const record = makeComplaintRecord({ aboutCourierId: 'other-rider' })
      mockComplaintRepository.findById.mockResolvedValue(record)

      await expect(
        service.reply(courierId, complaintId, 'Not my complaint')
      ).rejects.toThrow(new NotFoundException(COMPLAINT_NOT_FOUND))
    })

    it('rejects if complaint already has a reply with 409', async () => {
      const alreadyReplied = makeComplaintRecord({
        aboutCourierId: courierId,
        status: EnumComplaintStatus.OPEN,
        riderReply: 'First reply',
      })
      mockComplaintRepository.findById.mockResolvedValue(alreadyReplied)
      mockComplaintRepository.reply.mockResolvedValue(false)

      await expect(
        service.reply(courierId, complaintId, 'Second reply')
      ).rejects.toThrow(new ConflictException(COMPLAINT_ALREADY_REPLIED))
    })

    it('rejects if complaint is already decided or withdrawn with 409', async () => {
      const decidedRecord = makeComplaintRecord({
        aboutCourierId: courierId,
        status: EnumComplaintStatus.DECIDED,
      })
      mockComplaintRepository.findById.mockResolvedValue(decidedRecord)
      mockComplaintRepository.reply.mockResolvedValue(false)

      await expect(
        service.reply(courierId, complaintId, 'Late reply')
      ).rejects.toThrow(new ConflictException(COMPLAINT_CLOSED))
    })
  })

  // --------------------------------------------------------------------------
  // AC-5 / cross check 2: Admin Reply for Deactivated Rider
  // --------------------------------------------------------------------------
  describe('replyForRider (cross check 2 & decision 83.3)', () => {
    it('allows admin to enter reply for deactivated rider', async () => {
      const deactivatedRiderComplaint = makeComplaintRecord({
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        status: EnumComplaintStatus.AWAITING_REPLY,
        aboutCourier: {
          id: courierId,
          firstName: 'Inactive',
          lastName: 'Rider',
          deactivatedAt: new Date('2026-10-01'),
        } as any,
      })
      const openRecord = makeComplaintRecord({
        status: EnumComplaintStatus.OPEN,
        riderReply: 'Rider called in and explained situation.',
        replyEnteredByUserId: adminUserId,
      })

      mockComplaintRepository.findById
        .mockResolvedValueOnce(deactivatedRiderComplaint)
        .mockResolvedValueOnce(openRecord)
      mockComplaintRepository.reply.mockResolvedValue(true)

      const result = await service.replyForRider(
        adminUserId,
        complaintId,
        'Rider called in and explained situation.'
      )

      expect(result).toBe(openRecord)
      expect(mockComplaintRepository.reply).toHaveBeenCalledWith(
        complaintId,
        'Rider called in and explained situation.',
        adminUserId
      )
    })

    it('refuses admin entry if rider account is still active with 409', async () => {
      const activeRiderComplaint = makeComplaintRecord({
        about: EnumComplaintAbout.RIDER,
        aboutCourierId: courierId,
        status: EnumComplaintStatus.AWAITING_REPLY,
        aboutCourier: {
          id: courierId,
          firstName: 'Active',
          lastName: 'Rider',
          deactivatedAt: null, // Active!
        } as any,
      })
      mockComplaintRepository.findById.mockResolvedValue(activeRiderComplaint)

      await expect(
        service.replyForRider(adminUserId, complaintId, 'Admin trying to reply')
      ).rejects.toThrow(new ConflictException(COMPLAINT_RIDER_CAN_REPLY))
    })
  })

  // --------------------------------------------------------------------------
  // AC-5: Admin Decision
  // --------------------------------------------------------------------------
  describe('decide (AC-5)', () => {
    it('cannot decide while complaint is AWAITING_REPLY (409)', async () => {
      const awaitingRecord = makeComplaintRecord({
        about: EnumComplaintAbout.RIDER,
        status: EnumComplaintStatus.AWAITING_REPLY,
      })
      mockComplaintRepository.findById.mockResolvedValue(awaitingRecord)

      await expect(
        service.decide(adminUserId, complaintId, 'Rider at fault.')
      ).rejects.toThrow(new ConflictException(COMPLAINT_AWAITING_REPLY))

      expect(mockComplaintRepository.decide).not.toHaveBeenCalled()
    })

    it('records outcome and marks DECIDED when complaint is OPEN', async () => {
      const openRecord = makeComplaintRecord({ status: EnumComplaintStatus.OPEN })
      const decidedRecord = makeComplaintRecord({
        status: EnumComplaintStatus.DECIDED,
        outcome: 'Restaurant agreed to improve packaging.',
        decidedByUserId: adminUserId,
        decidedAt: new Date(),
        openFor: null,
      })

      mockComplaintRepository.findById
        .mockResolvedValueOnce(openRecord)
        .mockResolvedValueOnce(decidedRecord)
      mockComplaintRepository.decide.mockResolvedValue(true)

      const result = await service.decide(adminUserId, complaintId, 'Restaurant agreed to improve packaging.')

      expect(result).toBe(decidedRecord)
      expect(mockComplaintRepository.decide).toHaveBeenCalledWith(
        complaintId,
        'Restaurant agreed to improve packaging.',
        adminUserId
      )
      // AC-10: No DeliveryEvent emitted
    })

    it('refuses if already DECIDED or WITHDRAWN with 409', async () => {
      const alreadyDecided = makeComplaintRecord({ status: EnumComplaintStatus.DECIDED })
      mockComplaintRepository.findById.mockResolvedValue(alreadyDecided)

      await expect(
        service.decide(adminUserId, complaintId, 'Second decision')
      ).rejects.toThrow(new ConflictException(COMPLAINT_CLOSED))
    })

    it('rejects empty outcome text with 400', async () => {
      await expect(
        service.decide(adminUserId, complaintId, '   ')
      ).rejects.toThrow(new BadRequestException(COMPLAINT_OUTCOME_MESSAGE))
    })
  })

  // --------------------------------------------------------------------------
  // AC-5 / cross check 6: Admin Withdrawal
  // --------------------------------------------------------------------------
  describe('withdraw (AC-5, cross check 6)', () => {
    it('withdraws complaint while AWAITING_REPLY with reason and no finding against rider', async () => {
      const awaitingRecord = makeComplaintRecord({ status: EnumComplaintStatus.AWAITING_REPLY })
      const withdrawnRecord = makeComplaintRecord({
        status: EnumComplaintStatus.WITHDRAWN,
        withdrawnReason: 'Caller withdrew complaint.',
        withdrawnByUserId: adminUserId,
      })

      mockComplaintRepository.findById
        .mockResolvedValueOnce(awaitingRecord)
        .mockResolvedValueOnce(withdrawnRecord)
      mockComplaintRepository.withdraw.mockResolvedValue(true)

      const result = await service.withdraw(adminUserId, complaintId, 'Caller withdrew complaint.')

      expect(result).toBe(withdrawnRecord)
      expect(mockComplaintRepository.withdraw).toHaveBeenCalledWith(
        complaintId,
        'Caller withdrew complaint.',
        adminUserId
      )
    })

    it('withdraws complaint while OPEN', async () => {
      const openRecord = makeComplaintRecord({ status: EnumComplaintStatus.OPEN })
      const withdrawnRecord = makeComplaintRecord({ status: EnumComplaintStatus.WITHDRAWN })

      mockComplaintRepository.findById
        .mockResolvedValueOnce(openRecord)
        .mockResolvedValueOnce(withdrawnRecord)
      mockComplaintRepository.withdraw.mockResolvedValue(true)

      const result = await service.withdraw(adminUserId, complaintId, 'Misunderstanding resolved.')

      expect(result).toBe(withdrawnRecord)
    })

    it('rejects if already DECIDED with 409', async () => {
      mockComplaintRepository.findById.mockResolvedValue(makeComplaintRecord({ status: EnumComplaintStatus.DECIDED }))
      mockComplaintRepository.withdraw.mockResolvedValue(false)

      await expect(
        service.withdraw(adminUserId, complaintId, 'Too late')
      ).rejects.toThrow(new ConflictException(COMPLAINT_CLOSED))
    })

    it('rejects empty withdrawal reason with 400', async () => {
      await expect(
        service.withdraw(adminUserId, complaintId, '')
      ).rejects.toThrow(new BadRequestException(COMPLAINT_WITHDRAW_REASON_MESSAGE))
    })
  })

  // --------------------------------------------------------------------------
  // AC-7 / AC-9: Photo Access
  // --------------------------------------------------------------------------
  describe('photo access (AC-7, AC-9)', () => {
    it('photoForCourier allows only the filer rider to read photo', async () => {
      const record = makeComplaintRecord({ filerCourierId: courierId, photoKey: 'photo-1.jpg' })
      mockComplaintRepository.findById.mockResolvedValue(record)

      const photo = await service.photoForCourier(courierId, complaintId)

      expect(photo.contentType).toBe('image/jpeg')
      expect(mockStorageProvider.getStream).toHaveBeenCalledWith('photo-1.jpg')
    })

    it('photoForCourier throws 404 if caller is not the filer rider', async () => {
      const record = makeComplaintRecord({ filerCourierId: 'other-rider', photoKey: 'photo-1.jpg' })
      mockComplaintRepository.findById.mockResolvedValue(record)

      await expect(
        service.photoForCourier(courierId, complaintId)
      ).rejects.toThrow(new NotFoundException(COMPLAINT_NO_PHOTO))
    })

    it('photoForCourier throws 404 if complaint has no photo', async () => {
      const record = makeComplaintRecord({ filerCourierId: courierId, photoKey: null })
      mockComplaintRepository.findById.mockResolvedValue(record)

      await expect(
        service.photoForCourier(courierId, complaintId)
      ).rejects.toThrow(new NotFoundException(COMPLAINT_NO_PHOTO))
    })

    it('photoForAdmin allows admin to read photo of any complaint with photo', async () => {
      const record = makeComplaintRecord({ photoKey: 'photo-admin.jpg' })
      mockComplaintRepository.findById.mockResolvedValue(record)

      const photo = await service.photoForAdmin(complaintId)

      expect(photo.contentType).toBe('image/jpeg')
      expect(mockStorageProvider.getStream).toHaveBeenCalledWith('photo-admin.jpg')
    })

    it('photoForAdmin throws 404 if complaint has no photo', async () => {
      const record = makeComplaintRecord({ photoKey: null })
      mockComplaintRepository.findById.mockResolvedValue(record)

      await expect(
        service.photoForAdmin(complaintId)
      ).rejects.toThrow(new NotFoundException(COMPLAINT_NO_PHOTO))
    })

    it('throws 503 if storage provider stream read fails unexpectedly', async () => {
      const record = makeComplaintRecord({ photoKey: 'photo-err.jpg' })
      mockComplaintRepository.findById.mockResolvedValue(record)
      mockStorageProvider.getStream.mockRejectedValue(new Error('Network error'))

      await expect(
        service.photoForAdmin(complaintId)
      ).rejects.toThrow(new ServiceUnavailableException(COMPLAINT_PHOTO_READ_DOWN))
    })

    it('throws 404 if storage provider reports StoredFileNotFoundError', async () => {
      const record = makeComplaintRecord({ photoKey: 'photo-missing.jpg' })
      mockComplaintRepository.findById.mockResolvedValue(record)
      mockStorageProvider.getStream.mockRejectedValue(new StoredFileNotFoundError('photo-missing.jpg'))

      await expect(
        service.photoForAdmin(complaintId)
      ).rejects.toThrow(new NotFoundException(COMPLAINT_NO_PHOTO))
    })
  })

  // --------------------------------------------------------------------------
  // ridersForAdmin (cross check 3)
  // --------------------------------------------------------------------------
  describe('ridersForAdmin (cross check 3)', () => {
    it('returns rider names for the delivery', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue({
        id: deliveryId,
        partnerId,
        status: EnumDeliveryStatus.DROPPED_OFF,
        createdAt: new Date(),
        courierId,
      })
      mockComplaintRepository.findRidersWhoAccepted.mockResolvedValue([courierId])
      mockComplaintRepository.findRiderNames.mockResolvedValue([{ id: courierId, name: 'Nikos Rider' }])

      const result = await service.ridersForAdmin(deliveryId)

      expect(result).toEqual([{ id: courierId, name: 'Nikos Rider' }])
      expect(mockComplaintRepository.findRiderNames).toHaveBeenCalledWith([courierId])
    })

    it('throws NotFound if delivery does not exist', async () => {
      mockComplaintRepository.findDeliveryFacts.mockResolvedValue(null)

      await expect(service.ridersForAdmin('del-missing')).rejects.toThrow(
        new NotFoundException('Delivery not found')
      )
    })
  })
})
