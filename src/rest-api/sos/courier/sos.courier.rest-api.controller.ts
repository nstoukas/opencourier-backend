import * as common from '@nestjs/common'
import * as swagger from '@nestjs/swagger'
import { EnumUserRole } from '@prisma/types'
import { COURIER_API_V1_PREFIX } from 'src/constants'
import { CurrentUserCourier } from 'src/decorators/currentUserCourier.decorator'
import { Roles } from 'src/decorators/roles.decorator'
import { CourierEntity } from 'src/domains/courier/entities/courier.entity'
import * as errors from 'src/errors'
import { CourierJobStepCourierInput } from 'src/rest-api/delivery/courier/queries/courier-job-step.courier.input'
import { SosService } from 'src/services/sos/sos.service'
import { SosIncidentCourierDto } from './dtos/sos-incident.courier.dto'
import { SosPointsCourierInput } from './queries/sos-points.courier.input'
import { SosStartCourierInput } from './queries/sos-start.courier.input'

// A rider's own SOS (spec 0022). Every route reaches only the calling rider's incidents: anyone
// else's answers the same 404 as one that does not exist.
@swagger.ApiBearerAuth()
@swagger.ApiTags('sos')
@common.Controller(`${COURIER_API_V1_PREFIX}/sos`)
export class SosCourierRestApiController {
  constructor(private readonly sosService: SosService) {}

  // The 3 s hold (AC-4): starts the SOS, or answers the one this start or another already made.
  @common.Post('')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: SosStartCourierInput })
  @swagger.ApiOkResponse({ type: SosIncidentCourierDto })
  @swagger.ApiNotFoundResponse({ description: 'The delivery is not this rider’s' })
  @swagger.ApiOperation({ summary: 'Start an SOS' })
  @Roles(EnumUserRole.COURIER)
  async start(
    @common.Body() body: SosStartCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<SosIncidentCourierDto> {
    const incident = await this.sosService.start(courier.id, body, new Date())
    return new SosIncidentCourierDto(incident)
  }

  // After an app restart (AC-12): the rider's active SOS, or null.
  @common.Get('active')
  @swagger.ApiOkResponse({ type: SosIncidentCourierDto })
  @swagger.ApiOperation({ summary: 'The rider’s active SOS, or null' })
  @Roles(EnumUserRole.COURIER)
  async active(@CurrentUserCourier() courier: CourierEntity): Promise<SosIncidentCourierDto | null> {
    const incident = await this.sosService.findActive(courier.id)
    return incident ? new SosIncidentCourierDto(incident) : null
  }

  // The positions taken while the SOS is active (AC-5). 409 SOS_NOT_ACTIVE once it ended.
  @common.Post(':id/points')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: SosPointsCourierInput })
  @swagger.ApiNotFoundResponse({ type: errors.NotFoundException })
  @swagger.ApiConflictResponse({ description: 'The SOS is no longer active' })
  @swagger.ApiOperation({ summary: 'Send positions for an active SOS' })
  @Roles(EnumUserRole.COURIER)
  async points(
    @common.Param('id') id: string,
    @common.Body() body: SosPointsCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<{ accepted: number }> {
    return this.sosService.addPoints(courier.id, id, body.points, new Date())
  }

  // "I'm safe" (AC-6). A repeat answers the incident; 409 SOS_CLOSED once an admin closed it.
  @common.Post(':id/safe')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: CourierJobStepCourierInput })
  @swagger.ApiOkResponse({ type: SosIncidentCourierDto })
  @swagger.ApiOperation({ summary: 'End the SOS: the rider is safe' })
  @Roles(EnumUserRole.COURIER)
  async safe(
    @common.Param('id') id: string,
    @common.Body() body: CourierJobStepCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<SosIncidentCourierDto> {
    const incident = await this.sosService.endByRider(courier.id, id, 'safe', body.tapAgeMs, new Date())
    return new SosIncidentCourierDto(incident)
  }

  // "False alarm" (AC-6), as "I'm safe".
  @common.Post(':id/false-alarm')
  @common.HttpCode(200)
  @swagger.ApiBody({ type: CourierJobStepCourierInput })
  @swagger.ApiOkResponse({ type: SosIncidentCourierDto })
  @swagger.ApiOperation({ summary: 'End the SOS: it was a false alarm' })
  @Roles(EnumUserRole.COURIER)
  async falseAlarm(
    @common.Param('id') id: string,
    @common.Body() body: CourierJobStepCourierInput,
    @CurrentUserCourier() courier: CourierEntity
  ): Promise<SosIncidentCourierDto> {
    const incident = await this.sosService.endByRider(courier.id, id, 'falseAlarm', body.tapAgeMs, new Date())
    return new SosIncidentCourierDto(incident)
  }
}
