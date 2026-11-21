import { ApiProperty } from '@nestjs/swagger'
import { EnumCourierAccountChangeKind } from '@prisma/types'
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'
import { DEACTIVATION_REASON_MAX } from 'src/domains/courier/account-upkeep'
import { AccountChangeWithActor } from 'src/persistence/repositories/courier-account.repository'

// Spec 0051 (row 108): the inputs and answers of rider account upkeep, for both audiences.

// AC-1, cross check 1: the reason is required, 1 to 300 characters after trimming.
// `@Transform` runs before the checks, so spaces alone count as empty.
export class CourierDeactivateAdminInput {
  @ApiProperty({ type: String, minLength: 1, maxLength: DEACTIVATION_REASON_MAX })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(DEACTIVATION_REASON_MAX)
  reason!: string
}

// Cross check 9: an optional reason.
export class CourierReactivateAdminInput {
  @ApiProperty({ type: String, required: false, maxLength: DEACTIVATION_REASON_MAX })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(DEACTIVATION_REASON_MAX)
  reason?: string
}

// AC-6: what the admin courier page shows of the account, beyond the courier DTO.
export class CourierAccountAdminDto {
  @ApiProperty({ type: String, nullable: true }) email!: string | null
  @ApiProperty({ type: Date, nullable: true }) deactivatedAt!: Date | null
  @ApiProperty({ type: String, nullable: true }) emergencyContactName!: string | null
  @ApiProperty({ type: String, nullable: true }) emergencyContactPhone!: string | null

  constructor(data: {
    email: string | null
    deactivatedAt: Date | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
  }) {
    this.email = data.email
    this.deactivatedAt = data.deactivatedAt
    this.emergencyContactName = data.emergencyContactName
    this.emergencyContactPhone = data.emergencyContactPhone
  }
}

// AC-5, AC-6: one account change as admins read it, with the acting admin's email.
export class CourierAccountChangeAdminDto {
  @ApiProperty() id!: string
  @ApiProperty({ enum: EnumCourierAccountChangeKind }) kind!: EnumCourierAccountChangeKind
  @ApiProperty({ type: String, nullable: true }) field!: string | null
  @ApiProperty({ type: String, nullable: true }) oldValue!: string | null
  @ApiProperty({ type: String, nullable: true }) newValue!: string | null
  @ApiProperty({ type: String, nullable: true }) reason!: string | null
  @ApiProperty() actorIsRider!: boolean
  @ApiProperty({ type: String, nullable: true }) actorEmail!: string | null
  @ApiProperty({ type: Date }) createdAt!: Date

  constructor(change: AccountChangeWithActor) {
    this.id = change.id
    this.kind = change.kind
    this.field = change.field
    this.oldValue = change.oldValue
    this.newValue = change.newValue
    this.reason = change.reason
    this.actorIsRider = change.actorIsRider
    this.actorEmail = change.actorEmail
    this.createdAt = change.createdAt
  }
}

// AC-7, cross check 10: the rider's own record. The actor is "the co-op" or "you", never an admin's name.
export class CourierAccountChangeCourierDto {
  @ApiProperty() id!: string
  @ApiProperty({ enum: EnumCourierAccountChangeKind }) kind!: EnumCourierAccountChangeKind
  @ApiProperty({ type: String, nullable: true }) field!: string | null
  @ApiProperty({ type: String, nullable: true }) oldValue!: string | null
  @ApiProperty({ type: String, nullable: true }) newValue!: string | null
  @ApiProperty({ type: String, nullable: true }) reason!: string | null
  @ApiProperty({ enum: ['the co-op', 'you'] }) by!: 'the co-op' | 'you'
  @ApiProperty({ type: Date }) createdAt!: Date

  constructor(change: AccountChangeWithActor) {
    this.id = change.id
    this.kind = change.kind
    this.field = change.field
    this.oldValue = change.oldValue
    this.newValue = change.newValue
    this.reason = change.reason
    this.by = change.actorIsRider ? 'you' : 'the co-op'
    this.createdAt = change.createdAt
  }
}

// AC-8: the rider's own password change. `pushToken`: this phone's, so it keeps its offer pushes.
export class ChangePasswordCourierInput {
  @ApiProperty({ type: String }) @IsString() currentPassword!: string
  @ApiProperty({ type: String, minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string
  @ApiProperty({ type: String, required: false }) @IsOptional() @IsString() pushToken?: string
}

// Cross check 12: the rider's emergency contact, either part may be empty.
export class EmergencyContactCourierInput {
  @ApiProperty({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name!: string | null
  @ApiProperty({ type: String, nullable: true, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone!: string | null
}

export class EmergencyContactCourierDto {
  @ApiProperty({ type: String, nullable: true }) name!: string | null
  @ApiProperty({ type: String, nullable: true }) phone!: string | null

  constructor(data: { name: string | null; phone: string | null }) {
    this.name = data.name
    this.phone = data.phone
  }
}
