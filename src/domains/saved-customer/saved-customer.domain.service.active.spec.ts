import { Logger } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import {
  NotFoundException,
  SavedCustomerPhoneClashException,
  SavedCustomerRefusedException,
  SAVED_CUSTOMER_PHONE_CLASH_MESSAGE,
} from 'src/errors'
import {
  SavedCustomerFields,
  SavedCustomerRepository,
} from 'src/persistence/repositories/saved-customer.repository'
import {
  INVALID_PHONE_MESSAGE,
  OUTSIDE_SERVICE_AREA_MESSAGE,
  SavedCustomerDomainService,
  SavedCustomerInput,
} from './saved-customer.domain.service'

describe('SavedCustomerDomainService (AC-4, AC-5, AC-6, AC-7, AC-9, AC-10)', () => {
  let service: SavedCustomerDomainService
  let repository: jest.Mocked<SavedCustomerRepository>
  let configDomainService: jest.Mocked<ConfigDomainService>

  const partnerId = 'partner-1'
  const customerId = 'cust-1'

  // Region: square polygon around Volos center (lat 39.35..39.40, lng 22.90..23.00)
  const regionPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [22.90, 39.35],
        [23.00, 39.35],
        [23.00, 39.40],
        [22.90, 39.40],
        [22.90, 39.35],
      ],
    ],
  }

  const validInput: SavedCustomerInput = {
    name: 'Nikos Dimas',
    phone: '6912345678',
    notes: ' Ring bell twice ',
    addressLine1: ' Iasonos 10 ',
    addressLine2: '   ',
    city: ' Volos ',
    zipCode: ' 38221 ',
    latitude: 39.362,
    longitude: 22.945,
    formattedAddress: ' Iasonos 10, Volos ',
  }

  const existingCustomerRecord: any = {
    id: customerId,
    partnerId,
    name: 'Nikos Dimas',
    phone: '+306912345678',
    notes: 'Ring bell twice',
    addressLine1: 'Iasonos 10',
    addressLine2: null,
    city: 'Volos',
    zipCode: '38221',
    latitude: 39.362,
    longitude: 22.945,
    formattedAddress: 'Iasonos 10, Volos',
    lastUsedAt: new Date('2026-05-01T12:00:00Z'),
    createdAt: new Date('2026-05-01T12:00:00Z'),
    updatedAt: new Date('2026-05-01T12:00:00Z'),
  }

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      findOwned: jest.fn(),
      findIdByPhone: jest.fn(),
      create: jest.fn(),
      upsertByPhone: jest.fn(),
      update: jest.fn(),
      markUsed: jest.fn(),
      delete: jest.fn(),
      deleteUnusedForMonths: jest.fn(),
    } as any

    configDomainService = {
      instanceConfig: {
        getDetails: jest.fn().mockResolvedValue({ region: regionPolygon }),
        getSavedCustomerRetentionMonths: jest.fn().mockResolvedValue(12),
      },
    } as any

    service = new SavedCustomerDomainService(repository, configDomainService)
  })

  describe('create (AC-4, AC-10)', () => {
    it('creates customer with normalized phone, trimmed strings and null for empty optional fields', async () => {
      repository.create.mockResolvedValue(existingCustomerRecord)

      const result = await service.create(partnerId, validInput, 'refuse', false)

      expect(repository.create).toHaveBeenCalledWith(partnerId, {
        name: 'Nikos Dimas',
        phone: '+306912345678',
        notes: 'Ring bell twice',
        addressLine1: 'Iasonos 10',
        addressLine2: null,
        city: 'Volos',
        zipCode: '38221',
        latitude: 39.362,
        longitude: 22.945,
        formattedAddress: 'Iasonos 10, Volos',
      })
      expect(result).toEqual({ customer: existingCustomerRecord, created: true })
    })

    it('delegates to upsertByPhone with markUsed when onPhoneClash is update', async () => {
      repository.upsertByPhone.mockResolvedValue({ customer: existingCustomerRecord, created: false })

      const result = await service.create(partnerId, validInput, 'update', true)

      expect(repository.upsertByPhone).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({ phone: '+306912345678' }),
        true
      )
      expect(repository.create).not.toHaveBeenCalled()
      expect(result.created).toBe(false)
    })

    it('handles Prisma P2002-shaped unique error on refuse by throwing 409 with conflictingCustomerId and no personal data', async () => {
      // Shape of PrismaClientKnownRequestError from generated client (name and code, not instanceof runtime class)
      const p2002Error = Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      })
      repository.create.mockRejectedValue(p2002Error)
      repository.findIdByPhone.mockResolvedValue('conflicting-cust-456')

      try {
        await service.create(partnerId, validInput, 'refuse', false)
        fail('Expected SavedCustomerPhoneClashException')
      } catch (err: any) {
        expect(err).toBeInstanceOf(SavedCustomerPhoneClashException)
        expect(err.getStatus()).toBe(409)
        const response = err.getResponse()
        expect(response.message).toBe(SAVED_CUSTOMER_PHONE_CLASH_MESSAGE)
        expect(response.conflictingCustomerId).toBe('conflicting-cust-456')
        // Ensure no customer name or phone is leaked in the error or its response
        const serialized = JSON.stringify(response)
        expect(serialized).not.toContain(validInput.name)
        expect(serialized).not.toContain(validInput.phone)
      }
    })

    it('throws 422 with fixed message when phone is impossible, never repeating the input', async () => {
      await expect(
        service.create(partnerId, { ...validInput, phone: '123' }, 'refuse', false)
      ).rejects.toThrow(SavedCustomerRefusedException)

      await expect(
        service.create(partnerId, { ...validInput, phone: '123' }, 'refuse', false)
      ).rejects.toThrow(INVALID_PHONE_MESSAGE)

      try {
        await service.create(partnerId, { ...validInput, phone: 'bad-input-xyz' }, 'refuse', false)
      } catch (err: any) {
        expect(err.message).toBe(INVALID_PHONE_MESSAGE)
        expect(err.message).not.toContain('bad-input-xyz')
      }
    })

    it('throws 422 when required fields (name, street, city) are whitespace-only', async () => {
      await expect(
        service.create(partnerId, { ...validInput, name: '   ' }, 'refuse', false)
      ).rejects.toThrow("The customer's name cannot be empty")

      await expect(
        service.create(partnerId, { ...validInput, addressLine1: '   ' }, 'refuse', false)
      ).rejects.toThrow("The customer's street cannot be empty")

      await expect(
        service.create(partnerId, { ...validInput, city: '   ' }, 'refuse', false)
      ).rejects.toThrow("The customer's city cannot be empty")
    })

    it('throws 422 when address coordinates are outside the instance region (AC-10)', async () => {
      await expect(
        service.create(partnerId, { ...validInput, latitude: 39.60, longitude: 22.95 }, 'refuse', false)
      ).rejects.toThrow(OUTSIDE_SERVICE_AREA_MESSAGE)
    })
  })

  describe('update (AC-4, AC-5, AC-10)', () => {
    it('throws 404 when customer does not exist or is not owned by the restaurant', async () => {
      repository.findOwned.mockResolvedValue(null)

      await expect(
        service.update(partnerId, 'foreign-id', { name: 'New Name' }, false)
      ).rejects.toThrow(NotFoundException)
    })

    it('throws 404 if customer was deleted between findOwned and update write', async () => {
      repository.findOwned.mockResolvedValue(existingCustomerRecord)
      repository.update.mockResolvedValue(null)

      await expect(
        service.update(partnerId, customerId, { name: 'New Name' }, false)
      ).rejects.toThrow(NotFoundException)
    })

    it('throws 409 when updating phone to another customer phone (P2002 error)', async () => {
      repository.findOwned.mockResolvedValue(existingCustomerRecord)
      const p2002Error = Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      })
      repository.update.mockRejectedValue(p2002Error)
      repository.findIdByPhone.mockResolvedValue('other-cust-id')

      try {
        await service.update(partnerId, customerId, { phone: '6987654321' }, false)
        fail('Expected 409')
      } catch (err: any) {
        expect(err).toBeInstanceOf(SavedCustomerPhoneClashException)
        expect(err.getResponse().conflictingCustomerId).toBe('other-cust-id')
      }
    })

    it('checks merged coordinates when moving only latitude or only longitude (AC-10)', async () => {
      repository.findOwned.mockResolvedValue(existingCustomerRecord)

      // Existing is lat: 39.362, lng: 22.945. Moving latitude to 39.60 moves point outside region.
      await expect(
        service.update(partnerId, customerId, { latitude: 39.60 }, false)
      ).rejects.toThrow(OUTSIDE_SERVICE_AREA_MESSAGE)

      // Moving longitude to 23.50 moves point outside region.
      await expect(
        service.update(partnerId, customerId, { longitude: 23.50 }, false)
      ).rejects.toThrow(OUTSIDE_SERVICE_AREA_MESSAGE)
    })

    it('trims updated fields and sets empty strings to null for optional fields', async () => {
      repository.findOwned.mockResolvedValue(existingCustomerRecord)
      repository.update.mockResolvedValue({ ...existingCustomerRecord, notes: null })

      await service.update(partnerId, customerId, { notes: '   ', name: ' Updated Name ' }, false)

      expect(repository.update).toHaveBeenCalledWith(
        partnerId,
        customerId,
        { notes: null, name: 'Updated Name' },
        false
      )
    })
  })

  describe('markUsed (AC-5)', () => {
    it('throws 404 when repository.markUsed returns false', async () => {
      repository.markUsed.mockResolvedValue(false)

      await expect(service.markUsed(partnerId, 'missing-id')).rejects.toThrow(NotFoundException)
    })

    it('succeeds when repository.markUsed returns true', async () => {
      repository.markUsed.mockResolvedValue(true)

      await expect(service.markUsed(partnerId, customerId)).resolves.toBeUndefined()
      expect(repository.markUsed).toHaveBeenCalledWith(partnerId, customerId)
    })
  })

  describe('delete (AC-5)', () => {
    it('throws 404 when repository.delete returns false', async () => {
      repository.delete.mockResolvedValue(false)

      await expect(service.delete(partnerId, 'missing-id')).rejects.toThrow(NotFoundException)
    })

    it('succeeds when repository.delete returns true', async () => {
      repository.delete.mockResolvedValue(true)

      await expect(service.delete(partnerId, customerId)).resolves.toBeUndefined()
      expect(repository.delete).toHaveBeenCalledWith(partnerId, customerId)
    })
  })

  describe('admin operations (AC-6)', () => {
    let loggerSpy: jest.SpyInstance

    beforeEach(() => {
      loggerSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      loggerSpy.mockRestore()
    })

    it('updateAsAdmin passes markUsed: false and logs exactly one line with ids only, never customer details', async () => {
      repository.findOwned.mockResolvedValue(existingCustomerRecord)
      repository.update.mockResolvedValue(existingCustomerRecord)

      await service.updateAsAdmin('admin-user-99', partnerId, customerId, { name: 'Admin Fix' })

      // Verify markUsed was false
      expect(repository.update).toHaveBeenCalledWith(partnerId, customerId, expect.anything(), false)

      // Verify log line
      expect(loggerSpy).toHaveBeenCalledTimes(1)
      const logMessage = loggerSpy.mock.calls[0][0]
      expect(logMessage).toContain('admin-user-99')
      expect(logMessage).toContain(partnerId)
      expect(logMessage).toContain(customerId)
      expect(logMessage).not.toContain('Nikos Dimas')
      expect(logMessage).not.toContain('+306912345678')
      expect(logMessage).not.toContain('Iasonos 10')
    })

    it('deleteAsAdmin logs exactly one line with ids only', async () => {
      repository.delete.mockResolvedValue(true)

      await service.deleteAsAdmin('admin-user-99', partnerId, customerId)

      expect(loggerSpy).toHaveBeenCalledTimes(1)
      const logMessage = loggerSpy.mock.calls[0][0]
      expect(logMessage).toContain('admin-user-99')
      expect(logMessage).toContain(partnerId)
      expect(logMessage).toContain(customerId)
      expect(logMessage).not.toContain('Nikos Dimas')
      expect(logMessage).not.toContain('+306912345678')
    })
  })

  describe('deleteUnused (AC-7)', () => {
    it('reads retention setting, calls repository.deleteUnusedForMonths, and logs only the count', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
      repository.deleteUnusedForMonths.mockResolvedValue(3)

      const count = await service.deleteUnused()

      expect(configDomainService.instanceConfig.getSavedCustomerRetentionMonths).toHaveBeenCalled()
      expect(repository.deleteUnusedForMonths).toHaveBeenCalledWith(12)
      expect(count).toBe(3)
      expect(loggerSpy).toHaveBeenCalledWith('Saved customer retention (12 months): deleted 3')
      loggerSpy.mockRestore()
    })
  })

  describe('AC-9 No leak: logger output across operations', () => {
    it('captures all logger output across search, 409, 422, and admin delete and ensures no sensitive customer data appears', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})

      const fixtureName = 'Papadopoulos'
      const fixturePhone = '+306912345678'
      const fixtureStreet = 'Dimitriadis 42'

      // 1. Search (list)
      repository.list.mockResolvedValue({ items: [], total: 0 })
      await service.list(partnerId, fixtureName, 1, 20)

      // 2. 409 clash on create
      const p2002Error = Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      })
      repository.create.mockRejectedValue(p2002Error)
      repository.findIdByPhone.mockResolvedValue('clash-id')
      try {
        await service.create(
          partnerId,
          {
            name: fixtureName,
            phone: fixturePhone,
            addressLine1: fixtureStreet,
            city: 'Volos',
            latitude: 39.362,
            longitude: 22.945,
          },
          'refuse',
          false
        )
      } catch {}

      // 3. 422 outside area on create
      try {
        await service.create(
          partnerId,
          {
            name: fixtureName,
            phone: fixturePhone,
            addressLine1: fixtureStreet,
            city: 'Volos',
            latitude: 39.99,
            longitude: 22.945,
          },
          'refuse',
          false
        )
      } catch {}

      // 4. Admin delete
      repository.delete.mockResolvedValue(true)
      await service.deleteAsAdmin('admin-user-1', partnerId, 'cust-to-delete')

      // Gather all logged messages
      const allLogs = [
        ...logSpy.mock.calls.map((c) => String(c[0])),
        ...warnSpy.mock.calls.map((c) => String(c[0])),
        ...errorSpy.mock.calls.map((c) => String(c[0])),
      ].join(' ')

      expect(allLogs).not.toContain(fixtureName)
      expect(allLogs).not.toContain(fixturePhone)
      expect(allLogs).not.toContain(fixtureStreet)

      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })
})
