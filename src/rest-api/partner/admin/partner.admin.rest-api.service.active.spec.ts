import { EnumCountryCode, EnumUserRole } from '@prisma/types'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import { PasswordService } from 'src/domains/auth/password.service'
import { hashApiKey } from 'src/domains/auth/api-key'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'

describe('PartnerAdminRestApiService', () => {
  let service: PartnerAdminRestApiService
  let mockPartnerDomainService: jest.Mocked<PartnerDomainService>
  let mockLocationDomainService: jest.Mocked<LocationDomainService>
  let mockUserDomainService: jest.Mocked<UserDomainService>
  let mockPasswordService: jest.Mocked<PasswordService>
  let loggerLogSpy: jest.SpyInstance

  // Helper object representing a standard mock partner domain entity
  const mockPartnerEntity = new PartnerEntity({
    id: 'partner-100',
    name: 'Taverna Volos',
    logo: null,
    phoneNumber: '+302421000000',
    webhookUrl: null,
    usualPrepMinutes: 15,
    busyExtraMinutes: null,
    pausedUntil: null,
    disabledAt: null,
    disabledReason: null,
    userId: 'user-200',
    pickupLocationId: 'loc-300',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
    user: { email: 'taverna@volos.gr', apiKeyCreatedAt: null },
    pickupLocation: {
      id: 'loc-300',
      addressLine1: null,
      addressLine2: null,
      city: 'Volos',
      state: 'Magnesia',
      street: 'Iasonos',
      zipCode: '38221',
      countryCode: EnumCountryCode.GR,
      stateCode: 'Magnesia',
      houseNumber: '12',
      longitude: 22.944,
      latitude: 39.362,
      formattedAddress: 'Iasonos 12, Volos',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    },
  })

  // Helper object representing a created location entity
  const mockCreatedLocation = new LocationEntity({
    id: 'loc-new',
    addressLine1: null,
    addressLine2: null,
    city: 'Volos',
    state: 'Magnesia',
    street: 'Ermou',
    zipCode: '38221',
    countryCode: EnumCountryCode.GR,
    stateCode: 'Magnesia',
    houseNumber: '5',
    longitude: 22.945,
    latitude: 39.363,
    formattedAddress: 'Ermou 5, Volos',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Helper object representing the existing location entity for mockPartnerEntity (Row 150)
  const mockCurrentLocation = new LocationEntity({
    id: 'loc-300',
    addressLine1: null,
    addressLine2: null,
    city: 'Volos',
    state: 'Magnesia',
    street: 'Iasonos',
    zipCode: '38221',
    countryCode: EnumCountryCode.GR,
    stateCode: 'Magnesia',
    houseNumber: '12',
    longitude: 22.944,
    latitude: 39.362,
    formattedAddress: 'Iasonos 12, Volos',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
  })

  beforeEach(() => {
    // Inject mock domain and auth services into PartnerAdminRestApiService
    mockPartnerDomainService = {
      getByIdOrThrow: jest.fn(),
      getMany: jest.fn(),
      createWithLogin: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PartnerDomainService>

    mockLocationDomainService = {
      create: jest.fn().mockResolvedValue(mockCreatedLocation),
      update: jest.fn(),
      getById: jest.fn().mockResolvedValue(mockCurrentLocation),
    } as unknown as jest.Mocked<LocationDomainService>

    mockUserDomainService = {
      findUserWithEmail: jest.fn(),
      update: jest.fn(),
      findById: jest.fn(),
      replaceApiKeyHash: jest.fn(),
      removeApiKey: jest.fn(),
      setPasswordAndReplaceApiKey: jest.fn(),
    } as unknown as jest.Mocked<UserDomainService>

    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('hashed!password123'),
    } as unknown as jest.Mocked<PasswordService>

    service = new PartnerAdminRestApiService(
      mockPartnerDomainService,
      mockLocationDomainService,
      mockUserDomainService,
      mockPasswordService,
    )

    loggerLogSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('createRestaurant', () => {
    test('1. throws UserExistsException when email is taken and skips partner/location creation', async () => {
      // Mock userDomainService finding an existing user with the requested email
      mockUserDomainService.findUserWithEmail.mockResolvedValue({ id: 'user-existing' } as UserEntity)

      const input = {
        name: 'Taverna Volos',
        email: 'taverna@volos.gr',
        password: 'securepassword123',
      }

      const promise = service.createRestaurant(input)
      await expect(promise).rejects.toThrow(errors.UserExistsException)
      await expect(promise).rejects.toThrow('A partner with this email already exists')

      // Ensure domain creation steps were never reached
      expect(mockLocationDomainService.create).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.createWithLogin).not.toHaveBeenCalled()
    })

    test('2. normalizes email case/whitespace and passes hashed password (never plaintext) to createWithLogin', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(undefined)
      mockPartnerDomainService.createWithLogin.mockResolvedValue(mockPartnerEntity)

      const input = {
        name: '  Taverna Volos  ',
        email: '  Taverna@Volos.GR  ',
        password: 'mySecretPassword123',
      }

      await service.createRestaurant(input)

      // Verify email was trimmed and lowercased
      expect(mockUserDomainService.findUserWithEmail).toHaveBeenCalledWith('taverna@volos.gr')
      // Verify password hashing was called with original plaintext
      expect(mockPasswordService.hash).toHaveBeenCalledWith('mySecretPassword123')

      // Assert createWithLogin received normalized email and hash, no apiKey (AC-8), and plaintext password appears nowhere
      expect(mockPartnerDomainService.createWithLogin).toHaveBeenCalledWith({
        name: 'Taverna Volos',
        phoneNumber: null,
        pickupLocationId: null,
        login: {
          email: 'taverna@volos.gr',
          hashedPassword: 'hashed!password123',
        },
      })
    })

    test('3. creates location first when pickupAddress provided and links its ID, or uses null when omitted', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(undefined)
      mockLocationDomainService.create.mockResolvedValue(mockCreatedLocation)
      mockPartnerDomainService.createWithLogin.mockResolvedValue(mockPartnerEntity)

      const inputWithAddress = {
        name: 'Taverna Volos',
        email: 'taverna@volos.gr',
        password: 'securepassword123',
        pickupAddress: {
          street: 'Ermou',
          houseNumber: '5',
          city: 'Volos',
          state: 'Magnesia',
          zipCode: '38221',
          countryCode: EnumCountryCode.GR,
          latitude: 39.363,
          longitude: 22.945,
          formattedAddress: 'Ermou 5, Volos',
        },
      }

      await service.createRestaurant(inputWithAddress)

      expect(mockLocationDomainService.create).toHaveBeenCalledWith({
        street: 'Ermou',
        houseNumber: '5',
        city: 'Volos',
        state: 'Magnesia',
        stateCode: 'Magnesia',
        zipCode: '38221',
        countryCode: EnumCountryCode.GR,
        latitude: 39.363,
        longitude: 22.945,
        formattedAddress: 'Ermou 5, Volos',
      })

      expect(mockPartnerDomainService.createWithLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          pickupLocationId: 'loc-new',
        }),
      )

      // Test without pickupAddress
      mockLocationDomainService.create.mockClear()
      mockPartnerDomainService.createWithLogin.mockClear()

      const inputWithoutAddress = {
        name: 'Taverna Volos',
        email: 'taverna2@volos.gr',
        password: 'securepassword123',
      }

      await service.createRestaurant(inputWithoutAddress)

      expect(mockLocationDomainService.create).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.createWithLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          pickupLocationId: null,
        }),
      )
    })
  })

  describe('updateRestaurant', () => {
    test('4. creates a new location and repoints partner when pickup address changes, never updating old location in place (Row 150)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockLocationDomainService.getById.mockResolvedValue(mockCurrentLocation)
      mockLocationDomainService.create.mockResolvedValue(mockCreatedLocation)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        name: 'Taverna Volos Updated',
        pickupAddress: {
          street: 'Iasonos Updated',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
        },
      }

      await service.updateRestaurant('partner-100', updateInput)

      // Row 150: creates a NEW Location row for the restaurant
      expect(mockLocationDomainService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          street: 'Iasonos Updated',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
        }),
      )
      // Row 150: the old location row is NEVER updated in place so shared orders/quotes do not move
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      // Partner is updated with the new location ID and other changed fields
      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        name: 'Taverna Volos Updated',
        pickupLocationId: 'loc-new',
      })
    })

    test('5. creates new location when existing pickupLocationId is null and includes new ID in partner update', async () => {
      const partnerWithoutLocation = new PartnerEntity({
        ...mockPartnerEntity,
        pickupLocationId: null,
        pickupLocation: null,
      })

      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partnerWithoutLocation)
      mockLocationDomainService.create.mockResolvedValue(mockCreatedLocation)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        pickupAddress: {
          street: 'Ermou',
          houseNumber: '5',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.363,
          longitude: 22.945,
        },
      }

      await service.updateRestaurant('partner-100', updateInput)

      expect(mockLocationDomainService.create).toHaveBeenCalled()
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        pickupLocationId: 'loc-new',
      })
    })

    test('6. location creation payload has no streetAddress property and propagates street field correctly (Row 150)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockLocationDomainService.getById.mockResolvedValue(mockCurrentLocation)
      mockLocationDomainService.create.mockResolvedValue(mockCreatedLocation)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        name: 'Taverna Volos Updated',
        pickupAddress: {
          street: 'Iasonos Changed',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
        },
      }

      await service.updateRestaurant('partner-100', updateInput)

      // Row 150: new location is created, old location is never updated
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
      const createPayload = mockLocationDomainService.create.mock.calls[0]?.[0] as unknown as Record<string, unknown>
      // Verify streetAddress key is completely undefined / omitted and street is passed through
      expect('streetAddress' in createPayload).toBe(false)
      expect(createPayload.street).toBe(updateInput.pickupAddress.street)
    })

    test('6b. keeps existing location row and skips partner update when pickup address and point are unchanged (Row 150)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockLocationDomainService.getById.mockResolvedValue(mockCurrentLocation)

      // Identical fields to mockCurrentLocation
      const updateInputSameAddress = {
        pickupAddress: {
          street: 'Iasonos',
          houseNumber: '12',
          city: 'Volos',
          state: 'Magnesia',
          zipCode: '38221',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
          formattedAddress: 'Iasonos 12, Volos',
        },
      }

      const result = await service.updateRestaurant('partner-100', updateInputSameAddress)

      // Row 150: unchanged pickup address keeps the row: no create, no update in place
      expect(mockLocationDomainService.create).not.toHaveBeenCalled()
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      // Partner pickupLocationId is unchanged, so partnerDomainService.update is NOT called
      expect(mockPartnerDomainService.update).not.toHaveBeenCalled()
      // Returns fresh partner entity via getByIdOrThrow
      expect(result).toBe(mockPartnerEntity)
      expect(mockPartnerDomainService.getByIdOrThrow).toHaveBeenCalledTimes(2)
    })

    test('6c. recomputes formattedAddress on new location creation when formattedAddress is omitted (Row 150)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockLocationDomainService.getById.mockResolvedValue(mockCurrentLocation)
      mockLocationDomainService.create.mockResolvedValue(mockCreatedLocation)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        pickupAddress: {
          street: 'Ermou',
          houseNumber: '45',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.363,
          longitude: 22.945,
        },
      }

      await service.updateRestaurant('partner-100', updateInput)

      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
      const createPayload = mockLocationDomainService.create.mock.calls[0]?.[0] as unknown as Record<string, unknown>
      expect(createPayload.formattedAddress).toBe('Ermou 45, Volos, GR')
      expect(createPayload.formattedAddress).not.toBe('Iasonos 12, Volos')
    })

    test('6f. creates a new location and repoints partner when only map coordinates change (Row 150)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockLocationDomainService.getById.mockResolvedValue(mockCurrentLocation)
      mockLocationDomainService.create.mockResolvedValue(mockCreatedLocation)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInputOnlyCoordChange = {
        pickupAddress: {
          street: 'Iasonos',
          houseNumber: '12',
          city: 'Volos',
          state: 'Magnesia',
          zipCode: '38221',
          countryCode: EnumCountryCode.GR,
          latitude: 39.370,
          longitude: 22.944,
          formattedAddress: 'Iasonos 12, Volos',
        },
      }

      await service.updateRestaurant('partner-100', updateInputOnlyCoordChange)

      expect(mockLocationDomainService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          latitude: 39.370,
          longitude: 22.944,
        }),
      )
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        pickupLocationId: 'loc-new',
      })
    })

    test('6g. creates a new location when partner pickupLocationId points to a missing location row (Row 150)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockLocationDomainService.getById.mockResolvedValue(null)
      mockLocationDomainService.create.mockResolvedValue(mockCreatedLocation)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        pickupAddress: {
          street: 'Iasonos',
          houseNumber: '12',
          city: 'Volos',
          state: 'Magnesia',
          zipCode: '38221',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
          formattedAddress: 'Iasonos 12, Volos',
        },
      }

      await service.updateRestaurant('partner-100', updateInput)

      expect(mockLocationDomainService.create).toHaveBeenCalledTimes(1)
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        pickupLocationId: 'loc-new',
      })
    })

    test('6h. matches null and undefined fields without creating an unnecessary location row (Row 150)', async () => {
      const locationWithNulls = new LocationEntity({
        ...mockCurrentLocation,
        houseNumber: null,
        state: null,
        zipCode: null,
        formattedAddress: 'Iasonos, Volos',
      })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockLocationDomainService.getById.mockResolvedValue(locationWithNulls)

      // Input leaves out houseNumber, state, zipCode (undefined in JS)
      const updateInputUndefinedFields = {
        pickupAddress: {
          street: 'Iasonos',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
          formattedAddress: 'Iasonos, Volos',
        },
      }

      await service.updateRestaurant('partner-100', updateInputUndefinedFields)

      // null and undefined match via (saved ?? null) === (sent ?? null), no new row created
      expect(mockLocationDomainService.create).not.toHaveBeenCalled()
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.update).not.toHaveBeenCalled()
    })

    test('6d. updates only scalar fields when no pickupAddress is provided and skips location service', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        name: 'New Restaurant Name',
      }

      await service.updateRestaurant('partner-100', updateInput)

      expect(mockLocationDomainService.create).not.toHaveBeenCalled()
      expect(mockLocationDomainService.update).not.toHaveBeenCalled()
      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        name: 'New Restaurant Name',
      })
    })

    test('6e. propagates nullable fields (e.g. phoneNumber: null) to partnerDomainService.update', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        phoneNumber: null,
      }

      await service.updateRestaurant('partner-100', updateInput)

      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        phoneNumber: null,
      })
    })
  })

  // Spec 0023, AC-9: the usual prep time a representative sets.
  describe('usualPrepMinutes (spec 0023, AC-9)', () => {
    const createInput = { name: 'Taverna Volos', email: 'taverna@volos.gr', password: 'securepassword123' }

    test('create passes the usual prep time it was given', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(undefined)
      mockPartnerDomainService.createWithLogin.mockResolvedValue(mockPartnerEntity)

      await service.createRestaurant({ ...createInput, usualPrepMinutes: 20 })

      expect(mockPartnerDomainService.createWithLogin).toHaveBeenCalledWith(expect.objectContaining({ usualPrepMinutes: 20 }))
    })

    test('create passes 0 as 0 (Now is a real usual time)', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(undefined)
      mockPartnerDomainService.createWithLogin.mockResolvedValue(mockPartnerEntity)

      await service.createRestaurant({ ...createInput, usualPrepMinutes: 0 })

      expect(mockPartnerDomainService.createWithLogin.mock.calls[0]?.[0].usualPrepMinutes).toBe(0)
    })

    test('create without it passes no value, so the column default applies', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(undefined)
      mockPartnerDomainService.createWithLogin.mockResolvedValue(mockPartnerEntity)

      await service.createRestaurant(createInput)

      expect(mockPartnerDomainService.createWithLogin.mock.calls[0]?.[0].usualPrepMinutes).toBeUndefined()
    })

    test('update writes the usual prep time it was given, 0 included', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      await service.updateRestaurant('partner-100', { usualPrepMinutes: 0 })

      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', { usualPrepMinutes: 0 })
    })

    test('update without it leaves it alone', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      await service.updateRestaurant('partner-100', { name: 'Renamed' })

      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', { name: 'Renamed' })
      expect(mockPartnerDomainService.update.mock.calls[0]?.[1]).not.toHaveProperty('usualPrepMinutes')
    })

    test('create with usualPrepMinutes null passes undefined to the repository (column default applies) and does not throw', async () => {
      mockUserDomainService.findUserWithEmail.mockResolvedValue(undefined)
      mockPartnerDomainService.createWithLogin.mockResolvedValue(mockPartnerEntity)

      await expect(
        service.createRestaurant({ ...createInput, usualPrepMinutes: null as any })
      ).resolves.toBe(mockPartnerEntity)

      expect(mockPartnerDomainService.createWithLogin).toHaveBeenCalledTimes(1)
      expect(mockPartnerDomainService.createWithLogin.mock.calls[0]?.[0].usualPrepMinutes).toBeUndefined()
    })

    test('update with usualPrepMinutes null leaves usualPrepMinutes out of the update data', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      await service.updateRestaurant('partner-100', { name: 'Renamed', usualPrepMinutes: null as any })

      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', { name: 'Renamed' })
      expect(mockPartnerDomainService.update.mock.calls[0]?.[1]).not.toHaveProperty('usualPrepMinutes')
    })

    test('update with only usualPrepMinutes null leaves update data empty and skips update call', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)

      const result = await service.updateRestaurant('partner-100', { usualPrepMinutes: null as any })

      expect(mockPartnerDomainService.update).not.toHaveBeenCalled()
      expect(result).toBe(mockPartnerEntity)
    })
  })

  describe('rotatePassword (Spec 0037, AC-1, AC-11, AC-12)', () => {
    const mockUser = new UserEntity({
      id: 'user-200',
      email: 'taverna@volos.gr',
      password: 'old-hashed-password',
      role: [EnumUserRole.PARTNER],
      username: null,
      apiKeyHash: 'existing-hash',
      apiKeyCreatedAt: new Date('2026-07-01T10:00:00Z'),
      credentialsChangedAt: null,
      language: 'el',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    })

    test('replaces key when restaurant had one: returns new plain key, calls setPasswordAndReplaceApiKey, and logs replacement (AC-1, AC-12)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockUserDomainService.findById.mockResolvedValue(mockUser)
      mockUserDomainService.setPasswordAndReplaceApiKey.mockResolvedValue({ apiKeyReplaced: true })

      const before = new Date()
      const returnedKey = await service.rotatePassword('partner-100', 'newSuperSecret888', 'admin-user-77')
      const after = new Date()

      expect(mockUserDomainService.findById).toHaveBeenCalledWith('user-200')
      expect(mockPasswordService.hash).toHaveBeenCalledWith('newSuperSecret888')
      expect(mockUserDomainService.setPasswordAndReplaceApiKey).toHaveBeenCalledWith(
        'user-200',
        'hashed!password123',
        expect.any(Date),
        hashApiKey(returnedKey!)
      )

      const setCall = mockUserDomainService.setPasswordAndReplaceApiKey.mock.calls[0]
      const passedHash = setCall?.[3]
      expect(passedHash).toBe(hashApiKey(returnedKey!))
      expect(passedHash).not.toBe(returnedKey)
      const credentialsChangedAt = setCall?.[2] as Date
      expect(credentialsChangedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(credentialsChangedAt.getTime()).toBeLessThanOrEqual(after.getTime())

      // Returns the newly generated plain key (which starts with ock_)
      expect(typeof returnedKey).toBe('string')
      expect(returnedKey).toMatch(/^ock_[A-Za-z0-9_-]{43}$/)

      // AC-12: "Admin <id> set a new password for partner <id> and replaced its API key"
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Admin admin-user-77 set a new password for partner partner-100 and replaced its API key'
      )
      const loggedText = loggerLogSpy.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(loggedText).not.toContain('newSuperSecret888')
      expect(loggedText).not.toContain('hashed!password123')
      expect(loggedText).not.toContain(returnedKey!)
    })

    test('when restaurant had no key: returns null and logs password change only (AC-1, AC-12)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockUserDomainService.findById.mockResolvedValue(mockUser)
      mockUserDomainService.setPasswordAndReplaceApiKey.mockResolvedValue({ apiKeyReplaced: false })

      const returnedKey = await service.rotatePassword('partner-100', 'newSuperSecret888', 'admin-user-77')

      expect(returnedKey).toBeNull()
      // AC-12: without key replaced suffix
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Admin admin-user-77 set a new password for partner partner-100'
      )
    })

    test('throws ForbiddenException "This login also belongs to an admin." when login user has ADMIN role (AC-11)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      const adminPartnerUser = new UserEntity({
        id: 'user-200',
        email: 'taverna-admin@volos.gr',
        password: 'admin-hashed-pw',
        role: [EnumUserRole.PARTNER, EnumUserRole.ADMIN],
        username: null,
        apiKeyHash: 'hash-abc',
        apiKeyCreatedAt: new Date('2026-07-01T10:00:00Z'),
        credentialsChangedAt: null,
        language: 'el',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        updatedAt: new Date('2026-07-01T10:00:00Z'),
      })
      mockUserDomainService.findById.mockResolvedValue(adminPartnerUser)

      const call = service.rotatePassword('partner-100', 'newSuperSecret888', 'admin-user-77')

      await expect(call).rejects.toThrow(errors.ForbiddenException)
      await expect(call).rejects.toThrow('This login also belongs to an admin.')

      // Nothing updated, hashed, or logged
      expect(mockPasswordService.hash).not.toHaveBeenCalled()
      expect(mockUserDomainService.setPasswordAndReplaceApiKey).not.toHaveBeenCalled()
      expect(loggerLogSpy).not.toHaveBeenCalled()
    })

    test('throws NotFoundException when partner has no userId (AC-11)', async () => {
      const partnerWithoutUser = new PartnerEntity({
        ...mockPartnerEntity,
        userId: null,
      })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partnerWithoutUser)

      await expect(service.rotatePassword('partner-100', 'anotherPassword', 'admin-user-77')).rejects.toThrow(
        errors.NotFoundException,
      )
      await expect(service.rotatePassword('partner-100', 'anotherPassword', 'admin-user-77')).rejects.toThrow(
        'This partner has no login user',
      )
      expect(mockUserDomainService.findById).not.toHaveBeenCalled()
      expect(mockUserDomainService.setPasswordAndReplaceApiKey).not.toHaveBeenCalled()
      expect(loggerLogSpy).not.toHaveBeenCalled()
    })
  })

  describe('createApiKey (Spec 0037, AC-3, AC-11, AC-12)', () => {
    const mockUser = new UserEntity({
      id: 'user-200',
      email: 'taverna@volos.gr',
      password: 'hashed-password',
      role: [EnumUserRole.PARTNER],
      username: null,
      apiKeyHash: null,
      apiKeyCreatedAt: null,
      credentialsChangedAt: null,
      language: 'el',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    })

    test('creates new key when restaurant had no key before: logs made sentence and returns plain key once (AC-3, AC-12)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockUserDomainService.findById.mockResolvedValue(mockUser)
      mockUserDomainService.replaceApiKeyHash.mockResolvedValue({ replaced: false })

      const before = new Date()
      const result = await service.createApiKey('partner-100', 'admin-user-77')
      const after = new Date()

      expect(mockUserDomainService.replaceApiKeyHash).toHaveBeenCalledWith(
        'user-200',
        hashApiKey(result.apiKey),
        expect.any(Date)
      )
      const replaceCall = mockUserDomainService.replaceApiKeyHash.mock.calls[0]
      const passedHash = replaceCall?.[1]
      expect(passedHash).toBe(hashApiKey(result.apiKey))
      expect(passedHash).not.toBe(result.apiKey)
      expect(result.apiKey).toMatch(/^ock_[A-Za-z0-9_-]{43}$/)
      expect(result.apiKeyCreatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(result.apiKeyCreatedAt.getTime()).toBeLessThanOrEqual(after.getTime())

      // AC-12: "Admin <id> made a new API key for partner <id>" (no key before)
      expect(loggerLogSpy).toHaveBeenCalledWith('Admin admin-user-77 made a new API key for partner partner-100')
      const loggedText = loggerLogSpy.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(loggedText).not.toContain(result.apiKey)
    })

    test('replaces key when restaurant had a key before: logs replaced sentence (AC-3, AC-12)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockUserDomainService.findById.mockResolvedValue(mockUser)
      mockUserDomainService.replaceApiKeyHash.mockResolvedValue({ replaced: true })

      const result = await service.createApiKey('partner-100', 'admin-user-77')

      expect(mockUserDomainService.replaceApiKeyHash).toHaveBeenCalledWith(
        'user-200',
        hashApiKey(result.apiKey),
        expect.any(Date)
      )
      const replaceCall = mockUserDomainService.replaceApiKeyHash.mock.calls[0]
      const passedHash = replaceCall?.[1]
      expect(passedHash).toBe(hashApiKey(result.apiKey))
      expect(passedHash).not.toBe(result.apiKey)

      expect(result.apiKey).toMatch(/^ock_[A-Za-z0-9_-]{43}$/)
      // AC-12: "Admin <id> replaced the API key of partner <id>" (a key before)
      expect(loggerLogSpy).toHaveBeenCalledWith('Admin admin-user-77 replaced the API key of partner partner-100')
    })

    test('throws 403 ForbiddenException when login user has ADMIN role (AC-11)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      const adminPartnerUser = new UserEntity({
        id: 'user-200',
        email: 'taverna-admin@volos.gr',
        password: 'admin-hashed-pw',
        role: [EnumUserRole.PARTNER, EnumUserRole.ADMIN],
        username: null,
        apiKeyHash: null,
        apiKeyCreatedAt: null,
        credentialsChangedAt: null,
        language: 'el',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        updatedAt: new Date('2026-07-01T10:00:00Z'),
      })
      mockUserDomainService.findById.mockResolvedValue(adminPartnerUser)

      const call = service.createApiKey('partner-100', 'admin-user-77')

      await expect(call).rejects.toThrow(errors.ForbiddenException)
      await expect(call).rejects.toThrow('This login also belongs to an admin.')
      expect(mockUserDomainService.replaceApiKeyHash).not.toHaveBeenCalled()
      expect(loggerLogSpy).not.toHaveBeenCalled()
    })

    test('throws 404 NotFoundException when partner has no userId (AC-11)', async () => {
      const partnerWithoutUser = new PartnerEntity({
        ...mockPartnerEntity,
        userId: null,
      })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partnerWithoutUser)

      await expect(service.createApiKey('partner-100', 'admin-user-77')).rejects.toThrow(
        errors.NotFoundException
      )
      expect(mockUserDomainService.replaceApiKeyHash).not.toHaveBeenCalled()
    })
  })

  describe('removeApiKey (Spec 0037, AC-4, AC-11, AC-12)', () => {
    test('removes key and logs removal sentence when there was a key (AC-4, AC-12)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockUserDomainService.removeApiKey.mockResolvedValue({ removed: true })

      await service.removeApiKey('partner-100', 'admin-user-77')

      expect(mockUserDomainService.removeApiKey).toHaveBeenCalledWith('user-200')
      // AC-12: "Admin <id> removed the API key of partner <id>" (only when there was one)
      expect(loggerLogSpy).toHaveBeenCalledWith('Admin admin-user-77 removed the API key of partner partner-100')
    })

    test('logs nothing when there was no key to remove (AC-12)', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockUserDomainService.removeApiKey.mockResolvedValue({ removed: false })

      await service.removeApiKey('partner-100', 'admin-user-77')

      expect(mockUserDomainService.removeApiKey).toHaveBeenCalledWith('user-200')
      // AC-12: a removal with no key logs nothing
      expect(loggerLogSpy).not.toHaveBeenCalled()
    })

    test('allows removing key even when partner user has ADMIN role (AC-11)', async () => {
      // Removing a key signs nobody out and must always be allowed, even for a login that also has ADMIN role
      const adminPartnerUser = new UserEntity({
        id: 'user-200',
        email: 'taverna-admin@volos.gr',
        password: 'hash',
        role: [EnumUserRole.PARTNER, EnumUserRole.ADMIN],
        username: null,
        apiKeyHash: 'hash-abc',
        apiKeyCreatedAt: new Date('2026-07-01T10:00:00Z'),
        credentialsChangedAt: null,
        language: 'el',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        updatedAt: new Date('2026-07-01T10:00:00Z'),
      })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockUserDomainService.findById.mockResolvedValue(adminPartnerUser)
      mockUserDomainService.removeApiKey.mockResolvedValue({ removed: true })

      await service.removeApiKey('partner-100', 'admin-user-77')

      expect(mockUserDomainService.removeApiKey).toHaveBeenCalledWith('user-200')
      expect(loggerLogSpy).toHaveBeenCalledWith('Admin admin-user-77 removed the API key of partner partner-100')
    })

    test('throws 404 NotFoundException when partner has no userId (AC-11)', async () => {
      const partnerWithoutUser = new PartnerEntity({
        ...mockPartnerEntity,
        userId: null,
      })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partnerWithoutUser)

      await expect(service.removeApiKey('partner-100', 'admin-user-77')).rejects.toThrow(
        errors.NotFoundException
      )
      expect(mockUserDomainService.removeApiKey).not.toHaveBeenCalled()
    })
  })
})
