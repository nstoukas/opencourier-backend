import { StreamableFile } from '@nestjs/common'
import {
  EnumComplaintAbout,
  EnumComplaintCategory,
  EnumComplaintFiledBy,
  EnumComplaintStatus,
  EnumDeliveryStatus,
} from '@prisma/types'
import { Readable } from 'stream'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import { ComplaintService } from 'src/services/complaint/complaint.service'
import { ComplaintCourierRestApiController } from './complaint.courier.rest-api.controller'
import { ComplaintRecord } from 'src/persistence/repositories/complaint.repository'

describe('ComplaintCourierRestApiController (Spec 0052, AC-2, AC-5, AC-7, AC-9)', () => {
  let controller: ComplaintCourierRestApiController
  let mockComplaintService: jest.Mocked<ComplaintService>

  const courier: CourierEntity = {
    id: 'courier-c1',
    userId: 'user-u1',
  } as unknown as CourierEntity

  const mockRecord: ComplaintRecord = {
    id: 'comp-1',
    filedBy: EnumComplaintFiledBy.RIDER,
    about: EnumComplaintAbout.RESTAURANT,
    category: EnumComplaintCategory.LONG_WAIT,
    text: 'Long wait for food',
    status: EnumComplaintStatus.OPEN,
    createdAt: new Date(),
    openFor: 'RIDER:courier-c1:del-1:RESTAURANT',
    photoKey: null,
    deliveryId: 'del-1',
    filerCourierId: 'courier-c1',
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
      id: 'del-1',
      pickupBusinessName: 'Tavern',
      createdAt: new Date(),
      status: EnumDeliveryStatus.DROPPED_OFF,
    },
    filerCourier: { id: 'courier-c1', firstName: 'Nikos', lastName: 'Rider' },
    filerPartner: null,
    filerAdmin: null,
    aboutCourier: null,
    replyEnteredBy: null,
    decidedBy: null,
    withdrawnBy: null,
  }

  beforeEach(() => {
    mockComplaintService = {
      fileByRider: jest.fn().mockResolvedValue(mockRecord),
      listForCourier: jest.fn().mockResolvedValue({ data: [mockRecord], pagination: { totalItems: 1, totalPages: 1, page: 1, perPage: 20 } as any }),
      photoForCourier: jest.fn().mockResolvedValue({ stream: Readable.from(['photo-data']), contentType: 'image/jpeg' }),
      reply: jest.fn().mockResolvedValue(mockRecord),
    } as unknown as jest.Mocked<ComplaintService>

    controller = new ComplaintCourierRestApiController(mockComplaintService)
  })

  it('file delegates to complaintService.fileByRider with authenticated courier id and photo buffer', async () => {
    const input = {
      deliveryId: 'del-1',
      about: EnumComplaintAbout.RESTAURANT,
      category: EnumComplaintCategory.LONG_WAIT,
      text: 'Long wait for food',
    }
    const mockFile: Express.Multer.File = {
      buffer: Buffer.from('photo-bytes'),
      fieldname: 'photo',
      originalname: 'photo.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 11,
      stream: Readable.from(['']),
      destination: '',
      filename: '',
      path: '',
    }

    const result = await controller.file(input, courier, mockFile)

    expect(mockComplaintService.fileByRider).toHaveBeenCalledWith(
      'courier-c1',
      input,
      Buffer.from('photo-bytes')
    )
    expect(result.id).toBe('comp-1')
  })

  it('file works without a photo', async () => {
    const input = {
      deliveryId: 'del-1',
      about: EnumComplaintAbout.CUSTOMER,
      category: EnumComplaintCategory.NOT_ANSWERING,
      text: 'No answer at doorbell',
    }

    await controller.file(input, courier, undefined)

    expect(mockComplaintService.fileByRider).toHaveBeenCalledWith('courier-c1', input, null)
  })

  it('list delegates to complaintService.listForCourier with authenticated courier id', async () => {
    const args = { page: 1, perPage: 10 }
    const result = await controller.list(args, courier)

    expect(mockComplaintService.listForCourier).toHaveBeenCalledWith('courier-c1', args)
    expect(result.data.length).toBe(1)
    expect(result.pagination?.totalItems).toBe(1)
  })

  it('reply delegates to complaintService.reply with authenticated courier id', async () => {
    const result = await controller.reply('comp-1', { text: 'My explanation' }, courier)

    expect(mockComplaintService.reply).toHaveBeenCalledWith('courier-c1', 'comp-1', 'My explanation')
    expect(result.id).toBe('comp-1')
  })

  it('photo streams JPEG with private, no-store and nosniff headers', async () => {
    const mockRes: any = {
      set: jest.fn(),
    }

    const result = await controller.photo('comp-1', courier, mockRes)

    expect(mockComplaintService.photoForCourier).toHaveBeenCalledWith('courier-c1', 'comp-1')
    expect(mockRes.set).toHaveBeenCalledWith({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    expect(result).toBeInstanceOf(StreamableFile)
  })
})
