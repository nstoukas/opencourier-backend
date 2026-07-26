import { EnumCountryCode } from '@prisma/types'
import { PartnerAdminRestApiService } from './partner.admin.rest-api.service'
import { PartnerDomainService } from 'src/domains/partner/partner.domain.service'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { UserDomainService } from 'src/domains/user/user.domain.service'
import { AuthDomainService } from 'src/domains/auth/auth.domain.service'
import { PasswordService } from 'src/domains/auth/password.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { LocationEntity } from 'src/domains/location/entities/location.entity'
import { UserEntity } from 'src/domains/user/entities/user.entity'
import * as errors from 'src/errors'

describe('PartnerAdminRestApiService', () => {
  let service: PartnerAdminRestApiService
  let mockPartnerDomainService: jest.Mocked<PartnerDomainService>
  let mockLocationDomainService: jest.Mocked<LocationDomainService>
  let mockUserDomainService: jest.Mocked<UserDomainService>
  let mockAuthDomainService: jest.Mocked<AuthDomainService>
  let mockPasswordService: jest.Mocked<PasswordService>

  // Helper object representing a standard mock partner domain entity
  const mockPartnerEntity = new PartnerEntity({
    id: 'partner-100',
    name: 'Taverna Volos',
    logo: null,
    phoneNumber: '+302421000000',
    webhookUrl: null,
    userId: 'user-200',
    pickupLocationId: 'loc-300',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
    user: { email: 'taverna@volos.gr' },
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

  beforeEach(() => {
    // Inject mock domain and auth services into PartnerAdminRestApiService
    mockPartnerDomainService = {
      getByIdOrThrow: jest.fn(),
      getMany: jest.fn(),
      createWithLogin: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PartnerDomainService>

    mockLocationDomainService = {
      create: jest.fn(),
      update: jest.fn(),
      getById: jest.fn(),
    } as unknown as jest.Mocked<LocationDomainService>

    mockUserDomainService = {
      findUserWithEmail: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<UserDomainService>

    mockAuthDomainService = {
      generateApiKey: jest.fn().mockReturnValue('generated-api-key-123'),
    } as unknown as jest.Mocked<AuthDomainService>

    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('hashed!password123'),
    } as unknown as jest.Mocked<PasswordService>

    service = new PartnerAdminRestApiService(
      mockPartnerDomainService,
      mockLocationDomainService,
      mockUserDomainService,
      mockAuthDomainService,
      mockPasswordService,
    )
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

      // Assert createWithLogin received normalized email and hash, and plaintext password appears nowhere
      expect(mockPartnerDomainService.createWithLogin).toHaveBeenCalledWith({
        name: 'Taverna Volos',
        phoneNumber: null,
        pickupLocationId: null,
        login: {
          email: 'taverna@volos.gr',
          hashedPassword: 'hashed!password123',
          apiKey: 'generated-api-key-123',
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
    test('4. updates location in-place when pickupLocationId exists and preserves ID stability', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
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

      // Ensures existing location 'loc-300' is updated and locationDomainService.create is NOT called
      expect(mockLocationDomainService.update).toHaveBeenCalledWith('loc-300', expect.anything())
      expect(mockLocationDomainService.create).not.toHaveBeenCalled()
      // Partner pickupLocationId remains unchanged ('loc-300') so updateData doesn't duplicate it
      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        name: 'Taverna Volos Updated',
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
      expect(mockPartnerDomainService.update).toHaveBeenCalledWith('partner-100', {
        pickupLocationId: 'loc-new',
      })
    })

    test('6. location update payload has no streetAddress property and propagates street field correctly', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)
      mockPartnerDomainService.update.mockResolvedValue(mockPartnerEntity)

      const updateInput = {
        name: 'Taverna Volos Updated',
        pickupAddress: {
          street: 'Iasonos',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
        },
      }

      await service.updateRestaurant('partner-100', updateInput)

      const updatePayload = mockLocationDomainService.update.mock.calls[0]?.[1] as Record<string, unknown>
      // Verify streetAddress key is completely undefined / omitted and street is passed through
      expect('streetAddress' in updatePayload).toBe(false)
      expect(updatePayload.street).toBe(updateInput.pickupAddress.street)
    })

    test('6b. skips partnerDomainService.update call when only in-place pickupAddress is updated', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)

      const updateInputOnlyAddress = {
        pickupAddress: {
          street: 'Iasonos Updated Only',
          city: 'Volos',
          countryCode: EnumCountryCode.GR,
          latitude: 39.362,
          longitude: 22.944,
        },
      }

      const result = await service.updateRestaurant('partner-100', updateInputOnlyAddress)

      // Location is updated in place
      expect(mockLocationDomainService.update).toHaveBeenCalledWith('loc-300', expect.anything())
      // partnerDomainService.update is NOT called with empty {}
      expect(mockPartnerDomainService.update).not.toHaveBeenCalled()
      // getByIdOrThrow re-fetches or returns fresh partner entity
      expect(result).toBe(mockPartnerEntity)
      expect(mockPartnerDomainService.getByIdOrThrow).toHaveBeenCalledTimes(2)
    })

    test('6c. recomputes formattedAddress on pickupAddress update when formattedAddress is omitted', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)

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

      const updatePayload = mockLocationDomainService.update.mock.calls[0]?.[1] as Record<string, unknown>
      expect(updatePayload.formattedAddress).toBe('Ermou 45, Volos, GR')
      expect(updatePayload.formattedAddress).not.toBe('Iasonos 12, Volos')
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

  describe('rotatePassword', () => {
    test('7a. hashes new password and updates user when partner has a valid userId', async () => {
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(mockPartnerEntity)

      await service.rotatePassword('partner-100', 'newSuperSecret888')

      expect(mockPasswordService.hash).toHaveBeenCalledWith('newSuperSecret888')
      expect(mockUserDomainService.update).toHaveBeenCalledWith('user-200', {
        password: 'hashed!password123',
      })
    })

    test('7b. throws NotFoundException when partner has no userId', async () => {
      const partnerWithoutUser = new PartnerEntity({
        ...mockPartnerEntity,
        userId: null,
      })
      mockPartnerDomainService.getByIdOrThrow.mockResolvedValue(partnerWithoutUser)

      await expect(service.rotatePassword('partner-100', 'anotherPassword')).rejects.toThrow(errors.NotFoundException)
      await expect(service.rotatePassword('partner-100', 'anotherPassword')).rejects.toThrow('This partner has no login user')
      expect(mockUserDomainService.update).not.toHaveBeenCalled()
    })
  })
})
