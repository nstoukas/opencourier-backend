import { EnumCountryCode } from '@prisma/types'

export interface ILocationUpdate {
  streetAddress?: string[]
  street?: string
  city?: string
  zipCode?: string
  state?: string
  countryCode?: EnumCountryCode
  latitude?: number
  longitude?: number
  houseNumber?: string
  formattedAddress?: string | null
}

