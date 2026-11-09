import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsString, Length } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'
import { DISABLED_REASON_MAX_LENGTH } from 'src/domains/partner/partner-availability'

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class PartnerDisableAdminInput {
  @ApiProperty({ type: String, minLength: 1, maxLength: DISABLED_REASON_MAX_LENGTH })
  @RefuseIfNotSentAsString()
  @Transform(trimmed)
  @IsString()
  @Length(1, DISABLED_REASON_MAX_LENGTH)
  reason: string
}
