import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { PARTNER_API_V1_PREFIX } from 'src/constants'
import { ApiKeyAuth } from 'src/decorators/api-key-auth.decorator'
import { CurrentUserPartner } from 'src/decorators/currentUserPartner.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { LocationDomainService } from 'src/domains/location/location.domain.service'
import { PartnerEntity } from 'src/domains/partner/entities/partner.entity'
import { DEFAULT_WAIT_RECORD_DAYS } from 'src/domains/partner/wait-record'
import { PartnerWaitRecordDomainService } from 'src/domains/partner/partner-wait-record.domain.service'
import { availabilityOf } from 'src/domains/partner/partner-availability'
import { AvailabilityActor, PartnerAvailabilityDomainService } from 'src/domains/partner/partner-availability.domain.service'
import * as errors from 'src/errors'
import { PartnerAvailabilityPartnerDto } from './dtos/partner-availability.partner.dto'
import { PartnerProfileDto } from './dtos/partner-profile.partner.dto'
import { BusyOnPartnerInput } from './queries/busy-on.partner.input'
import { PausePartnerInput } from './queries/pause.partner.input'
import { WaitRecordPartnerArgs } from './queries/wait-record.partner.args'
import { WaitRecordPartnerDto } from './dtos/wait-record.partner.dto'

// Only system admins can alter partner profile fields; no mutation endpoints exist in the partner namespace.
@swagger.ApiBearerAuth()
@swagger.ApiTags('partner')
@common.Controller(`${PARTNER_API_V1_PREFIX}/partner`)
export class PartnerPartnerRestApiController {
  constructor(
    private readonly locationDomainService: LocationDomainService,
    private readonly partnerAvailabilityDomainService: PartnerAvailabilityDomainService,
    private readonly partnerWaitRecordDomainService: PartnerWaitRecordDomainService
  ) {}

  @common.Get('profile')
  @swagger.ApiResponse({ type: PartnerProfileDto })
  @swagger.ApiForbiddenResponse({ type: errors.ForbiddenException })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiOperation({ summary: 'Get partner profile' })
  // ApiKeyAuth allows request authentication via either an API key header or a Bearer token.
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async getProfile(@CurrentUserPartner() partner: PartnerEntity): Promise<PartnerProfileDto> {
    const pickupLocation = partner.pickupLocationId
      ? await this.locationDomainService.getById(partner.pickupLocationId)
      : null
    return new PartnerProfileDto({ partner, pickupLocation })
  }

  // Spec 0029, AC-1: busy mode on, or a new amount.
  @common.Post('availability/busy')
  @common.HttpCode(200)
  @swagger.ApiResponse({ type: PartnerAvailabilityPartnerDto })
  @swagger.ApiOperation({ summary: 'Turn busy mode on or change its extra minutes' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async busyOn(
    @common.Body() input: BusyOnPartnerInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<PartnerAvailabilityPartnerDto> {
    const updated = await this.partnerAvailabilityDomainService.setBusy(partner, this.actorOf(partner), input.extraMinutes)
    return new PartnerAvailabilityPartnerDto(availabilityOf(updated, new Date()))
  }

  @common.Delete('availability/busy')
  @swagger.ApiResponse({ type: PartnerAvailabilityPartnerDto })
  @swagger.ApiOperation({ summary: 'Turn busy mode off' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async busyOff(@CurrentUserPartner() partner: PartnerEntity): Promise<PartnerAvailabilityPartnerDto> {
    const updated = await this.partnerAvailabilityDomainService.clearBusy(partner, this.actorOf(partner))
    return new PartnerAvailabilityPartnerDto(availabilityOf(updated, new Date()))
  }

  // Spec 0029, AC-3: ordering paused for a chosen time.
  @common.Post('availability/pause')
  @common.HttpCode(200)
  @swagger.ApiResponse({ type: PartnerAvailabilityPartnerDto })
  @swagger.ApiOperation({ summary: 'Pause ordering for a chosen time' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async pause(
    @common.Body() input: PausePartnerInput,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<PartnerAvailabilityPartnerDto> {
    const now = new Date()
    const updated = await this.partnerAvailabilityDomainService.pause(partner, this.actorOf(partner), input.minutes, now)
    return new PartnerAvailabilityPartnerDto(availabilityOf(updated, now))
  }

  @common.Delete('availability/pause')
  @swagger.ApiResponse({ type: PartnerAvailabilityPartnerDto })
  @swagger.ApiOperation({ summary: 'Resume ordering' })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async resume(@CurrentUserPartner() partner: PartnerEntity): Promise<PartnerAvailabilityPartnerDto> {
    const now = new Date()
    const updated = await this.partnerAvailabilityDomainService.resume(partner, this.actorOf(partner), now)
    return new PartnerAvailabilityPartnerDto(availabilityOf(updated, now))
  }

  // Spec 0030, AC-1: the restaurant's own record.
  @common.Get('wait-record')
  @swagger.ApiResponse({ type: WaitRecordPartnerDto })
  @swagger.ApiOperation({ summary: "The restaurant's own wait record" })
  @ApiKeyAuth()
  @Roles(EnumUserRole.PARTNER)
  async getWaitRecord(
    @common.Query() args: WaitRecordPartnerArgs,
    @CurrentUserPartner() partner: PartnerEntity
  ): Promise<WaitRecordPartnerDto> {
    const record = await this.partnerWaitRecordDomainService.getWaitRecord(
      partner,
      args.days ?? DEFAULT_WAIT_RECORD_DAYS,
      new Date()
    )
    return new WaitRecordPartnerDto(record)
  }

  // A partner session always carries its user; a restaurant with no sign in cannot get this far.
  private actorOf(partner: PartnerEntity): AvailabilityActor {
    if (!partner.userId) throw new common.ForbiddenException('This restaurant has no sign in.')
    return { role: EnumUserRole.PARTNER, userId: partner.userId }
  }
}
