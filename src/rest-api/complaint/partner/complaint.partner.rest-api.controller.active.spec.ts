import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryStatus,
} from '@prisma/types'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { ComplaintService } from 'src/services/complaint/complaint.service'
import { ComplaintPartnerRestApiController } from './complaint.partner.rest-api.controller'
import { ComplaintRecord } from 'src/persistence/repositories/complaint.repository'
import { ComplaintPartnerStatus } from '../dtos/complaint.dto'

describe('ComplaintPartnerRestApiController (Spec 0052, AC-3, AC-7)', () => {
  let controller: ComplaintPartnerRestApiController
  let mockComplaintService: jest.Mocked<ComplaintService>

  const partner: PartnerEntity = {
    id: 'partner-p1',
    name: 'Souvlaki Bar',
    userId: 'user-p1',
  } as unknown as PartnerEntity

  const mockRecord: ComplaintRecord = {
    id: 'comp-p1',
    filedBy: EnumComplaintFiledBy.RESTAURANT,
    about: EnumComplaintAbout.RIDER,
    category: EnumComplaintCategory.LATE,
    text: 'Courier arrived 40 min late',
    status: EnumComplaintStatus.AWAITING_REPLY,
    createdAt: new Date(),
    openFor: 'RESTAURANT:partner-p1:del-1:RIDER',
    photoKey: null,
    deliveryId: 'del-1',
    filerCourierId: null,
    filerPartnerId: 'partner-p1',
    filerAdminId: null,
    aboutCourierId: 'courier-1',
    riderReply: null,
    repliedAt: null,
    replyEnteredByUserId: null,
    replyEnteredForRider: false,
    outcome: null,
    decidedAt: null,
    decidedByUserId: null,
    withdrawnReason: null,
    withdrawnAt: null,
    withdrawnByUserId: null,
    delivery: {
      id: 'del-1',
      pickupBusinessName: 'Souvlaki Bar',
      createdAt: new Date(),
      status: EnumDeliveryStatus.DROPPED_OFF,
    },
    filerCourier: null,
    filerPartner: { id: 'partner-p1', name: 'Souvlaki Bar' },
    filerAdmin: null,
    aboutCourier: { id: 'courier-1', firstName: 'Kostas', lastName: 'Rider', deactivatedAt: null },
    replyEnteredBy: null,
    decidedBy: null,
    withdrawnBy: null,
  }

  beforeEach(() => {
    mockComplaintService = {
      fileByRestaurant: jest.fn().mockResolvedValue(mockRecord),
      listForPartner: jest.fn().mockResolvedValue({
        data: [mockRecord],
        pagination: { total: 1, page: 1, perPage: 20 },
      }),
    } as unknown as jest.Mocked<ComplaintService>

    controller = new ComplaintPartnerRestApiController(mockComplaintService)
  })

  it('file delegates to complaintService.fileByRestaurant with authenticated partner id', async () => {
    const input = {
      deliveryId: 'del-1',
      category: EnumComplaintCategory.LATE,
      text: 'Courier arrived 40 min late',
    }

    const result = await controller.file(input, partner)

    expect(mockComplaintService.fileByRestaurant).toHaveBeenCalledWith('partner-p1', input)
    expect(result.id).toBe('comp-p1')
    // Restaurant sees AWAITING_REPLY as OPEN
    expect(result.status).toBe(ComplaintPartnerStatus.OPEN)
  })

  it('list delegates to complaintService.listForPartner with authenticated partner id', async () => {
    const args = { page: 1, perPage: 10, deliveryId: 'del-1' }
    const result = await controller.list(args, partner)

    expect(mockComplaintService.listForPartner).toHaveBeenCalledWith('partner-p1', args)
    expect(result.data.length).toBe(1)
    expect(result.data[0]!.status).toBe(ComplaintPartnerStatus.OPEN)
  })
})
