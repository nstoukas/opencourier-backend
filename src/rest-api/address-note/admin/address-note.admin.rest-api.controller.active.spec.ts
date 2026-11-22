import { AddressNoteAdminRestApiController } from './address-note.admin.rest-api.controller'
import { LocationNoteDomainService } from 'src/domains/location-note/location-note.domain.service'
import { EnumLocationNoteActor, EnumUserRole } from '@prisma/types'
import { ROLES_KEY } from 'src/decorators/roles.decorator'
import { UserEntity } from 'src/domains/user/entities/user.entity'

describe('AddressNoteAdminRestApiController (Spec 0053 AC-7)', () => {
  let controller: AddressNoteAdminRestApiController
  let mockLocationNoteDomainService: jest.Mocked<LocationNoteDomainService>

  const adminUser = {
    id: 'admin-user-42',
    role: EnumUserRole.ADMIN,
    email: 'admin@coop.gr',
  } as unknown as UserEntity

  const mockAdminNoteView = {
    id: 'note-1',
    note: 'Code 1234',
    latitude: 39.364,
    longitude: 22.948,
    actor: EnumLocationNoteActor.COURIER,
    courierId: 'courier-1',
    deliveryId: 'del-1',
    locationId: 'loc-1',
    address: 'Ermou 15, Volos',
    upvotes: 3,
    couriers: { id: 'courier-1', firstName: 'Nikos', lastName: 'Pap' },
    flags: [{ id: 'flag-1', reason: 'Abuse', createdAt: new Date('2026-11-20T10:00:00Z') }],
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:00:00Z'),
    lastConfirmedAt: new Date('2026-11-20T12:00:00Z'),
    locations: null,
  }

  beforeEach(() => {
    mockLocationNoteDomainService = {
      adminFlagged: jest.fn().mockResolvedValue([mockAdminNoteView]),
      adminSearch: jest.fn().mockResolvedValue({ data: [mockAdminNoteView], total: 1 }),
      adminDelete: jest.fn().mockResolvedValue(undefined),
      adminDismissFlags: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LocationNoteDomainService>

    controller = new AddressNoteAdminRestApiController(mockLocationNoteDomainService)
  })

  describe('Security and Roles', () => {
    it('protects flagged, search, delete, and dismissFlags endpoints with ADMIN role', () => {
      const flaggedRoles = Reflect.getMetadata(ROLES_KEY, controller.flagged)
      const searchRoles = Reflect.getMetadata(ROLES_KEY, controller.search)
      const deleteRoles = Reflect.getMetadata(ROLES_KEY, controller.delete)
      const dismissRoles = Reflect.getMetadata(ROLES_KEY, controller.dismissFlags)

      expect(flaggedRoles).toEqual([EnumUserRole.ADMIN])
      expect(searchRoles).toEqual([EnumUserRole.ADMIN])
      expect(deleteRoles).toEqual([EnumUserRole.ADMIN])
      expect(dismissRoles).toEqual([EnumUserRole.ADMIN])
    })
  })

  describe('GET flagged', () => {
    it('returns flagged notes with author and flags mapped to AddressNoteAdminDto', async () => {
      const result = await controller.flagged()

      expect(mockLocationNoteDomainService.adminFlagged).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('note-1')
      expect(result[0]?.authorName).toBe('Nikos Pap')
      expect(result[0]?.authorCourierId).toBe('courier-1')
      expect(result[0]?.address).toBe('Ermou 15, Volos')
      expect(result[0]?.flags).toHaveLength(1)
      expect(result[0]?.flags[0]?.reason).toBe('Abuse')
    })
  })

  describe('GET search', () => {
    it('calls adminSearch with query parameters and returns paginated dto', async () => {
      const result = await controller.search({ search: 'ermou', page: 2, perPage: 15 })

      expect(mockLocationNoteDomainService.adminSearch).toHaveBeenCalledWith('ermou', 2, 15)
      expect(result.data).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.page).toBe(2)
      expect(result.perPage).toBe(15)
    })

    it('uses defaults when page and perPage are not provided', async () => {
      await controller.search({})

      expect(mockLocationNoteDomainService.adminSearch).toHaveBeenCalledWith('', 1, 25)
    })
  })

  describe('DELETE :id', () => {
    it('delegates deletion with note id and current admin user id', async () => {
      await controller.delete('note-1', adminUser)

      expect(mockLocationNoteDomainService.adminDelete).toHaveBeenCalledWith('note-1', adminUser.id)
    })
  })

  describe('POST :id/dismiss-flags', () => {
    it('delegates dismissing flags to domain service', async () => {
      await controller.dismissFlags('note-1')

      expect(mockLocationNoteDomainService.adminDismissFlags).toHaveBeenCalledWith('note-1')
    })
  })
})
