import { StreamableFile } from '@nestjs/common'
import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryStatus,
} from '@prisma/types'
import { Readable } from 'stream'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import { ComplaintService } from 'src/services/complaint/complaint.service'
import { ComplaintAdminRestApiController } from './complaint.admin.rest-api.controller'
import { ComplaintRecord } from 'src/persistence/repositories/complaint.repository'

describe('ComplaintAdminRestApiController (Spec 0052, AC-3, AC-5, AC-6, AC-9, cross check 2)', () => {
  let controller: ComplaintAdminRestApiController
  let mockComplaintService: jest.Mocked<ComplaintService>

  const adminUser: UserEntity = {
    id: 'admin-u1',
    email: 'admin@coop.gr',
    username: 'admin',
  } as unknown as UserEntity

  const mockRecord: ComplaintRecord = {
    id: 'comp-admin-1',
    filedBy: EnumComplaintFiledBy.ADMIN,
    about: EnumComplaintAbout.RIDER,
    category: EnumComplaintCategory.RUDE,
    text: 'Customer Maria called in: rider was rude',
    status: EnumComplaintStatus.AWAITING_REPLY,
    createdAt: new Date(),
    openFor: null,
    photoKey: 'photo-admin.jpg',
    deliveryId: 'del-100',
    filerCourierId: null,
    filerPartnerId: null,
    filerAdminId: 'admin-u1',
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
      id: 'del-100',
      pickupBusinessName: 'Volos Tavern',
      createdAt: new Date(),
      status: EnumDeliveryStatus.DROPPED_OFF,
    },
    filerCourier: null,
    filerPartner: null,
    filerAdmin: { id: 'admin-u1', email: 'admin@coop.gr', username: 'admin' },
    aboutCourier: { id: 'courier-1', firstName: 'Kostas', lastName: 'Rider', deactivatedAt: null },
    replyEnteredBy: null,
    decidedBy: null,
    withdrawnBy: null,
  }

  beforeEach(() => {
    mockComplaintService = {
      listForAdmin: jest.fn().mockResolvedValue({
        data: [mockRecord],
        pagination: { total: 1, page: 1, perPage: 20 },
      }),
      ridersForAdmin: jest.fn().mockResolvedValue([{ id: 'courier-1', name: 'Kostas Rider' }]),
      get: jest.fn().mockResolvedValue(mockRecord),
      photoForAdmin: jest.fn().mockResolvedValue({ stream: Readable.from(['photo-data']), contentType: 'image/jpeg' }),
      fileByAdmin: jest.fn().mockResolvedValue(mockRecord),
      decide: jest.fn().mockResolvedValue({ ...mockRecord, status: EnumComplaintStatus.DECIDED, outcome: 'Settled' }),
      withdraw: jest.fn().mockResolvedValue({ ...mockRecord, status: EnumComplaintStatus.WITHDRAWN }),
      replyForRider: jest.fn().mockResolvedValue({ ...mockRecord, status: EnumComplaintStatus.OPEN, riderReply: 'Heard on phone' }),
    } as unknown as jest.Mocked<ComplaintService>

    controller = new ComplaintAdminRestApiController(mockComplaintService)
  })

  it('list delegates to complaintService.listForAdmin with filters', async () => {
    const args = { status: EnumComplaintStatus.AWAITING_REPLY, about: EnumComplaintAbout.RIDER, page: 1, perPage: 20 }
    const result = await controller.list(args)

    expect(mockComplaintService.listForAdmin).toHaveBeenCalledWith(
      { status: EnumComplaintStatus.AWAITING_REPLY, about: EnumComplaintAbout.RIDER },
      args
    )
    expect(result.data.length).toBe(1)
    expect(result.data[0]!.id).toBe('comp-admin-1')
  })

  it('deliveryRiders delegates to complaintService.ridersForAdmin', async () => {
    const result = await controller.deliveryRiders('del-100')

    expect(mockComplaintService.ridersForAdmin).toHaveBeenCalledWith('del-100')
    expect(result).toEqual([{ id: 'courier-1', name: 'Kostas Rider' }])
  })

  it('get delegates to complaintService.get', async () => {
    const result = await controller.get('comp-admin-1')

    expect(mockComplaintService.get).toHaveBeenCalledWith('comp-admin-1')
    expect(result.id).toBe('comp-admin-1')
  })

  it('photo streams JPEG with private, no-store and nosniff headers', async () => {
    const mockRes: any = { set: jest.fn() }
    const result = await controller.photo('comp-admin-1', mockRes)

    expect(mockComplaintService.photoForAdmin).toHaveBeenCalledWith('comp-admin-1')
    expect(mockRes.set).toHaveBeenCalledWith({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(result).toBeInstanceOf(StreamableFile)
  })

  it('file delegates to complaintService.fileByAdmin with admin user id', async () => {
    const input = {
      deliveryId: 'del-100',
      category: EnumComplaintCategory.RUDE,
      text: 'Customer Maria called in: rider was rude',
      aboutCourierId: 'courier-1',
    }

    const result = await controller.file(input, adminUser)

    expect(mockComplaintService.fileByAdmin).toHaveBeenCalledWith('admin-u1', input)
    expect(result.id).toBe('comp-admin-1')
  })

  it('decide delegates to complaintService.decide with admin user id', async () => {
    const result = await controller.decide('comp-admin-1', { outcome: 'Settled' }, adminUser)

    expect(mockComplaintService.decide).toHaveBeenCalledWith('admin-u1', 'comp-admin-1', 'Settled')
    expect(result.status).toBe(EnumComplaintStatus.DECIDED)
  })

  it('withdraw delegates to complaintService.withdraw with admin user id', async () => {
    const result = await controller.withdraw('comp-admin-1', { reason: 'Caller withdrew' }, adminUser)

    expect(mockComplaintService.withdraw).toHaveBeenCalledWith('admin-u1', 'comp-admin-1', 'Caller withdrew')
    expect(result.status).toBe(EnumComplaintStatus.WITHDRAWN)
  })

  it('replyForRider delegates to complaintService.replyForRider for deactivated rider', async () => {
    const result = await controller.replyForRider('comp-admin-1', { text: 'Heard on phone' }, adminUser)

    expect(mockComplaintService.replyForRider).toHaveBeenCalledWith('admin-u1', 'comp-admin-1', 'Heard on phone')
    expect(result.status).toBe(EnumComplaintStatus.OPEN)
  })
})
