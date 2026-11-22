import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { EnumComplaintAbout, EnumComplaintCategory, EnumComplaintFiledBy, EnumComplaintStatus } from '@prisma/types'
import { PaginatedResult } from 'src/core/models/Pagination'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import {
  COMPLAINT_PHOTO_CONTENT_TYPE,
  COMPLAINT_PHOTO_TYPE_MESSAGE,
  COMPLAINT_PHOTO_UNREADABLE_MESSAGE,
  photoKindOf,
  reencodeComplaintPhoto,
} from 'src/domains/complaint/complaint-photo'
import {
  ABOUT_ALLOWED_FOR,
  COMPLAINT_ABOUT_NOT_ALLOWED,
  COMPLAINT_ALREADY_OPEN,
  COMPLAINT_ALREADY_REPLIED,
  COMPLAINT_AWAITING_REPLY,
  COMPLAINT_CATEGORY_MISMATCH,
  COMPLAINT_CLOSED,
  COMPLAINT_NOT_AWAITING_REPLY,
  COMPLAINT_NOT_FOUND,
  COMPLAINT_NO_RIDER,
  COMPLAINT_ORDER_NOT_ENDED,
  COMPLAINT_OUTCOME_MESSAGE,
  COMPLAINT_REPLY_MESSAGE,
  COMPLAINT_RIDER_CAN_REPLY,
  COMPLAINT_RIDER_NOT_ON_ORDER,
  COMPLAINT_TEXT_MESSAGE,
  COMPLAINT_WITHDRAW_REASON_MESSAGE,
  RESTAURANT_COMPLAINT_STATUSES,
  categoryFits,
  cleanText,
  openForKey,
  startingStatus,
} from 'src/domains/complaint/complaint-rules'
import { NotFoundException } from 'src/errors'
import {
  ComplaintDeliveryFacts,
  ComplaintRecord,
  ComplaintRepository,
} from 'src/persistence/repositories/complaint.repository'
import { refuseIfNotVisibleToPartner } from 'src/rest-api/delivery/partner/partner-history'
import { OfferPushService } from 'src/services/pushNotification/offer-push.service'
import { reachFromOf, todayIn } from 'src/services/time-worked/time-worked.service'
import { StorageProvider, StoredFileNotFoundError } from 'src/services/storage/models/StorageProvider'

export type RiderComplaintInput = {
  deliveryId: string
  about: EnumComplaintAbout
  category: EnumComplaintCategory
  text: string
}
export type RestaurantComplaintInput = { deliveryId: string; category: EnumComplaintCategory; text: string }
export type AdminComplaintInput = {
  deliveryId: string
  category: EnumComplaintCategory
  text: string
  // Which rider, on a job more than one rider accepted (cross check 3). Optional when only one did.
  aboutCourierId?: string | null
}
export type PageOptions = { page?: number; perPage?: number }

// A rider of a delivery, for the admin's picker when filing (cross check 3).
export type DeliveryRider = { id: string; name: string }

const DELIVERY_NOT_FOUND = 'Delivery not found'
export const COMPLAINT_NO_PHOTO = 'This complaint has no photo'
export const COMPLAINT_PHOTO_STORAGE_DOWN =
  "Photos can't be saved right now. Send the complaint without the photo, or try again later."
export const COMPLAINT_PHOTO_READ_DOWN = "The photo can't be shown right now. Try again later."

// A stored photo, opened for a route to stream back.
export type ComplaintPhoto = { stream: Readable; contentType: string }

export const COMPLAINT_PICK_RIDER =
  'More than one rider accepted this order: name the rider the complaint is about (aboutCourierId).'

// Spec 0052 (row 83): complaints both ways, with no ratings. Three doors to file (rider, restaurant,
// admin), the rider's reply before any decision about them, and an admin's decision or withdrawal.
// Every step is stored on the complaint row with who and when (AC-10); no DeliveryEvent is written,
// since a complaint changes no status, pay or assignment. Nothing here counts complaints per rider,
// and nothing that matches, pays or scores riders reads them (AC-8).
@Injectable()
export class ComplaintService {
  private readonly logger = new Logger(ComplaintService.name)

  constructor(
    private readonly complaintRepository: ComplaintRepository,
    private readonly configDomainService: ConfigDomainService,
    private readonly offerPushService: OfferPushService,
    // Slice 2: the private bucket for complaint photos (MinIO, bound in ComplaintModule).
    private readonly storageProvider: StorageProvider
  ) {}

  // --- Filing -------------------------------------------------------------------------------

  // AC-2: a rider files about the restaurant or the customer of one of their jobs in Earnings: a
  // delivery they accepted, last accepted within their Earnings reach (spec 0042, cross check 11). Any
  // other delivery is the plain 404, so a rider cannot learn which deliveries exist.
  // Slice 2: with an optional photo (the uploaded file's bytes), checked, cleaned and stored before the
  // row is written; the complaint is never saved without it (cross check 9).
  async fileByRider(courierId: string, input: RiderComplaintInput, photo?: Buffer | null): Promise<ComplaintRecord> {
    const text = this.checkFiling(EnumComplaintFiledBy.RIDER, input.about, input.category, input.text)

    const acceptTimes = await this.complaintRepository.findAcceptTimes(input.deliveryId, courierId)
    const lastAccept = acceptTimes[acceptTimes.length - 1]
    const now = new Date()
    if (!lastAccept || todayIn(lastAccept) < reachFromOf(todayIn(now))) {
      throw new NotFoundException(DELIVERY_NOT_FOUND)
    }

    const photoKey = photo ? await this.storePhoto(await this.cleanPhoto(photo)) : null
    try {
      return await this.create({
        deliveryId: input.deliveryId,
        filedBy: EnumComplaintFiledBy.RIDER,
        filerCourierId: courierId,
        about: input.about,
        category: input.category,
        text,
        openFor: openForKey({ kind: 'RIDER', id: courierId }, input.deliveryId, input.about),
        photoKey,
      })
    } catch (error) {
      // No complaint row (a 409 for an open one, or a database error): the photo goes too.
      if (photoKey) await this.forgetPhoto(photoKey)
      throw error
    }
  }

  // AC-3: a restaurant files about the rider of one of its own delivered or cancelled orders, within its
  // order history (spec 0017: another restaurant's order is the plain 404). The rider is the delivery's
  // rider now, else the last one who accepted it (cross check 3); none is 409.
  async fileByRestaurant(partnerId: string, input: RestaurantComplaintInput): Promise<ComplaintRecord> {
    const about = EnumComplaintAbout.RIDER
    const text = this.checkFiling(EnumComplaintFiledBy.RESTAURANT, about, input.category, input.text)

    const delivery = await this.complaintRepository.findDeliveryFacts(input.deliveryId)
    const historyDays = await this.configDomainService.instanceConfig.getRestaurantHistoryDays()
    refuseIfNotVisibleToPartner(delivery, partnerId, historyDays, new Date())
    // refuseIfNotVisibleToPartner threw for a missing delivery; this line only tells TypeScript so.
    if (!delivery) throw new NotFoundException(DELIVERY_NOT_FOUND)
    if (!RESTAURANT_COMPLAINT_STATUSES.includes(delivery.status)) throw new ConflictException(COMPLAINT_ORDER_NOT_ENDED)

    const riders = await this.ridersOf(delivery)
    const aboutCourierId = delivery.courierId ?? riders[0]
    if (!aboutCourierId) throw new ConflictException(COMPLAINT_NO_RIDER)

    return this.create({
      deliveryId: delivery.id,
      filedBy: EnumComplaintFiledBy.RESTAURANT,
      filerPartnerId: partnerId,
      about,
      aboutCourierId,
      category: input.category,
      text,
      openFor: openForKey({ kind: 'RESTAURANT', id: partnerId }, delivery.id, about),
    })
  }

  // AC-3: an admin files about a rider on behalf of anyone who called in (the text names who). Any
  // delivery status. On a job more than one rider accepted, the admin names which one (cross check 3).
  async fileByAdmin(adminUserId: string, input: AdminComplaintInput): Promise<ComplaintRecord> {
    const about = EnumComplaintAbout.RIDER
    const text = this.checkFiling(EnumComplaintFiledBy.ADMIN, about, input.category, input.text)

    const delivery = await this.complaintRepository.findDeliveryFacts(input.deliveryId)
    if (!delivery) throw new NotFoundException(DELIVERY_NOT_FOUND)
    const riders = await this.ridersOf(delivery)
    if (riders.length === 0) throw new ConflictException(COMPLAINT_NO_RIDER)

    // The named rider, else the only one; with several and none named, the admin must pick.
    const aboutCourierId = input.aboutCourierId || (riders.length === 1 ? riders[0] : undefined)
    if (!aboutCourierId) throw new BadRequestException(COMPLAINT_PICK_RIDER)
    if (!riders.includes(aboutCourierId)) throw new ConflictException(COMPLAINT_RIDER_NOT_ON_ORDER)

    return this.create({
      deliveryId: delivery.id,
      filedBy: EnumComplaintFiledBy.ADMIN,
      filerAdminId: adminUserId,
      about,
      aboutCourierId,
      category: input.category,
      text,
      // An admin files on behalf of whoever called in, so two calls about one order are two complaints.
      openFor: null,
    })
  }

  // Cross check 3: the riders an admin can pick from, for the filing form.
  async ridersForAdmin(deliveryId: string): Promise<DeliveryRider[]> {
    const delivery = await this.complaintRepository.findDeliveryFacts(deliveryId)
    if (!delivery) throw new NotFoundException(DELIVERY_NOT_FOUND)
    return this.complaintRepository.findRiderNames(await this.ridersOf(delivery))
  }

  // --- Reading ------------------------------------------------------------------------------

  async listForCourier(courierId: string, options: PageOptions): Promise<PaginatedResult<ComplaintRecord>> {
    return this.complaintRepository.findPageForCourier(courierId, options)
  }

  // Only the complaints this restaurant filed, optionally for one of its orders.
  async listForPartner(
    partnerId: string,
    options: PageOptions & { deliveryId?: string }
  ): Promise<PaginatedResult<ComplaintRecord>> {
    return this.complaintRepository.findPageForPartner(partnerId, options.deliveryId, options)
  }

  async listForAdmin(
    filters: { status?: EnumComplaintStatus; about?: EnumComplaintAbout },
    options: PageOptions
  ): Promise<PaginatedResult<ComplaintRecord>> {
    return this.complaintRepository.findPageForAdmin(filters, options)
  }

  async get(id: string): Promise<ComplaintRecord> {
    const complaint = await this.complaintRepository.findById(id)
    if (!complaint) throw new NotFoundException(COMPLAINT_NOT_FOUND)
    return complaint
  }

  // --- The photo (slice 2) ------------------------------------------------------------------

  // AC-9: only the rider who filed the complaint; anyone else's, or one with no photo, is the plain 404.
  async photoForCourier(courierId: string, id: string): Promise<ComplaintPhoto> {
    const complaint = await this.complaintRepository.findById(id)
    if (!complaint || complaint.filerCourierId !== courierId || !complaint.photoKey) {
      throw new NotFoundException(COMPLAINT_NO_PHOTO)
    }
    return this.openPhoto(complaint.photoKey)
  }

  // AC-6, AC-9: admins see every complaint's photo.
  async photoForAdmin(id: string): Promise<ComplaintPhoto> {
    const complaint = await this.get(id)
    if (!complaint.photoKey) throw new NotFoundException(COMPLAINT_NO_PHOTO)
    return this.openPhoto(complaint.photoKey)
  }

  // --- The rider's reply --------------------------------------------------------------------

  // AC-5: only the rider the complaint is about; anyone else's is the plain 404. Stored once.
  async reply(courierId: string, id: string, replyText: string): Promise<ComplaintRecord> {
    const reply = cleanText(replyText)
    if (!reply) throw new BadRequestException(COMPLAINT_REPLY_MESSAGE)
    const complaint = await this.complaintRepository.findById(id)
    if (!complaint || complaint.aboutCourierId !== courierId) throw new NotFoundException(COMPLAINT_NOT_FOUND)
    if (!(await this.complaintRepository.reply(id, reply, null))) this.refuseReply(await this.get(id))
    return this.get(id)
  }

  // Cross check 2: a deactivated rider cannot log in to reply, so an admin may enter a reply taken by
  // phone, or "the rider could not reply", marked as entered on the rider's behalf. Never for an active
  // rider: they reply themselves, and their say comes first (binding value 4).
  async replyForRider(adminUserId: string, id: string, replyText: string): Promise<ComplaintRecord> {
    const reply = cleanText(replyText)
    if (!reply) throw new BadRequestException(COMPLAINT_REPLY_MESSAGE)
    const complaint = await this.get(id)
    if (complaint.status !== EnumComplaintStatus.AWAITING_REPLY) this.refuseReply(complaint)
    if (!complaint.aboutCourier?.deactivatedAt) throw new ConflictException(COMPLAINT_RIDER_CAN_REPLY)
    if (!(await this.complaintRepository.reply(id, reply, adminUserId))) this.refuseReply(await this.get(id))
    return this.get(id)
  }

  // --- The admin's decision -----------------------------------------------------------------

  // AC-5: never before the rider's reply, with no deadline (409 "Waiting for the rider's reply").
  async decide(adminUserId: string, id: string, outcomeText: string): Promise<ComplaintRecord> {
    const outcome = cleanText(outcomeText)
    if (!outcome) throw new BadRequestException(COMPLAINT_OUTCOME_MESSAGE)
    const complaint = await this.get(id)
    this.refuseIfNotOpen(complaint.status)
    if (!(await this.complaintRepository.decide(id, outcome, adminUserId))) {
      this.refuseIfNotOpen((await this.get(id)).status)
      throw new ConflictException(COMPLAINT_CLOSED)
    }
    return this.get(id)
  }

  // AC-5, cross check 6: only admins, at any time while it is open, with a reason; no finding against
  // anyone.
  async withdraw(adminUserId: string, id: string, reasonText: string): Promise<ComplaintRecord> {
    const reason = cleanText(reasonText)
    if (!reason) throw new BadRequestException(COMPLAINT_WITHDRAW_REASON_MESSAGE)
    await this.get(id)
    if (!(await this.complaintRepository.withdraw(id, reason, adminUserId))) throw new ConflictException(COMPLAINT_CLOSED)
    return this.get(id)
  }

  // --- Helpers ------------------------------------------------------------------------------

  // The checks every door shares, before anything is read: the text, who it may be about, the category.
  private checkFiling(
    filedBy: EnumComplaintFiledBy,
    about: EnumComplaintAbout,
    category: EnumComplaintCategory,
    rawText: string
  ): string {
    const text = cleanText(rawText)
    if (!text) throw new BadRequestException(COMPLAINT_TEXT_MESSAGE)
    if (!ABOUT_ALLOWED_FOR[filedBy].includes(about)) throw new BadRequestException(COMPLAINT_ABOUT_NOT_ALLOWED)
    if (!categoryFits(about, category)) throw new BadRequestException(COMPLAINT_CATEGORY_MISMATCH)
    return text
  }

  // Cross check 4: the first bytes decide (JPEG or PNG), not the request's content type; then the
  // picture is decoded and encoded again, which drops every piece of metadata (EXIF location included).
  private async cleanPhoto(photo: Buffer): Promise<Buffer> {
    if (!photoKindOf(photo)) throw new BadRequestException(COMPLAINT_PHOTO_TYPE_MESSAGE)
    try {
      return await reencodeComplaintPhoto(photo)
    } catch (error) {
      this.logger.warn(`A complaint photo could not be decoded: ${error instanceof Error ? error.message : error}`)
      throw new BadRequestException(COMPLAINT_PHOTO_UNREADABLE_MESSAGE)
    }
  }

  // A random key, naming no rider, complaint or delivery (AC-9). Storage down or not set up: 503.
  private async storePhoto(photo: Buffer): Promise<string> {
    const key = `${randomUUID()}.jpg`
    try {
      await this.storageProvider.put(key, photo, COMPLAINT_PHOTO_CONTENT_TYPE)
    } catch (error) {
      this.logger.error(`Could not store a complaint photo: ${error instanceof Error ? error.message : error}`)
      throw new ServiceUnavailableException(COMPLAINT_PHOTO_STORAGE_DOWN)
    }
    return key
  }

  // Best effort: a photo left behind by a failed filing is an orphan in a private bucket, not a leak.
  private async forgetPhoto(key: string): Promise<void> {
    try {
      await this.storageProvider.delete(key)
    } catch (error) {
      this.logger.error(`Could not remove the photo ${key} of a complaint that was not saved: ${error}`)
    }
  }

  private async openPhoto(key: string): Promise<ComplaintPhoto> {
    try {
      return { stream: await this.storageProvider.getStream(key), contentType: COMPLAINT_PHOTO_CONTENT_TYPE }
    } catch (error) {
      if (error instanceof StoredFileNotFoundError) throw new NotFoundException(COMPLAINT_NO_PHOTO)
      this.logger.error(`Could not read the complaint photo ${key}: ${error instanceof Error ? error.message : error}`)
      throw new ServiceUnavailableException(COMPLAINT_PHOTO_READ_DOWN)
    }
  }

  // The riders who accepted the delivery, newest first, plus its rider now if no event names them.
  private async ridersOf(delivery: ComplaintDeliveryFacts): Promise<string[]> {
    const riders = await this.complaintRepository.findRidersWhoAccepted(delivery.id)
    if (delivery.courierId && !riders.includes(delivery.courierId)) riders.unshift(delivery.courierId)
    return riders
  }

  private async create(
    input: Omit<Parameters<ComplaintRepository['create']>[0], 'status'>
  ): Promise<ComplaintRecord> {
    const created = await this.complaintRepository.create({ ...input, status: startingStatus(input.about) })
    // The unique openFor refused it: this filer has an open complaint about this order already.
    if (!created) throw new ConflictException(COMPLAINT_ALREADY_OPEN)
    if (created.aboutCourierId) this.tellRider(created.aboutCourierId, created.id)
    return created
  }

  // AC-4: told at once, Online or not (a reply is not work). The push never fails the filing.
  private tellRider(courierId: string, complaintId: string): void {
    try {
      this.offerPushService.complaintNeedsReply(courierId, complaintId)
    } catch (error) {
      this.logger.error(`Could not push complaint ${complaintId}: ${error}`)
    }
  }

  // `never` = this function always throws, so TypeScript knows the code after a call is not reached.
  private refuseReply(complaint: ComplaintRecord): never {
    if (complaint.riderReply !== null) throw new ConflictException(COMPLAINT_ALREADY_REPLIED)
    if (complaint.status === EnumComplaintStatus.DECIDED || complaint.status === EnumComplaintStatus.WITHDRAWN) {
      throw new ConflictException(COMPLAINT_CLOSED)
    }
    throw new ConflictException(COMPLAINT_NOT_AWAITING_REPLY)
  }

  private refuseIfNotOpen(status: EnumComplaintStatus): void {
    if (status === EnumComplaintStatus.AWAITING_REPLY) throw new ConflictException(COMPLAINT_AWAITING_REPLY)
    if (status !== EnumComplaintStatus.OPEN) throw new ConflictException(COMPLAINT_CLOSED)
  }
}
