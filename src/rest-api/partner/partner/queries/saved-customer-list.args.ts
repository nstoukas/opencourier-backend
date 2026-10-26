import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator'
import { BadRequestException } from 'src/errors'

// The query string of GET /customers (spec 0005), and of the admin's list of one restaurant's customers.
export class SavedCustomerListArgs {
  @ApiPropertyOptional({
    type: String,
    description: 'Part of a name, or 2 or more digits of a phone (2 characters at least)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @ApiPropertyOptional({ type: Number, description: 'Page number, from 1 (default 1)' })
  @IsOptional()
  @IsInt()
  // @Type turns the query string's text "2" into the number 2 before @IsInt checks it.
  @Type(() => Number)
  page?: number

  @ApiPropertyOptional({ type: Number, description: 'Customers per page, 1 to 50 (default 20)' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  perPage?: number
}

export const SAVED_CUSTOMER_PAGE_SIZE_DEFAULT = 20
export const SAVED_CUSTOMER_PAGE_SIZE_MAX = 50

// The list's search, page and page size as the repository wants them: a search shorter than 2
// characters is refused (it would match nearly everyone), the page starts at 1, and the page size is
// kept within 1 to 50 rather than refused.
export function readSavedCustomerListArgs(args: SavedCustomerListArgs): {
  search: string | null
  page: number
  perPage: number
} {
  let search: string | null = null
  if (args.q !== undefined) {
    search = args.q.trim()
    if (search.length < 2) {
      throw new BadRequestException('Search with 2 characters or more')
    }
  }
  const page = Math.max(1, args.page ?? 1)
  const perPage = Math.min(SAVED_CUSTOMER_PAGE_SIZE_MAX, Math.max(1, args.perPage ?? SAVED_CUSTOMER_PAGE_SIZE_DEFAULT))
  return { search, page, perPage }
}
