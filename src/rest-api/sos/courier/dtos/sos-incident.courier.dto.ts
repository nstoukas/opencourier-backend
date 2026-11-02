import { ApiProperty } from '@nestjs/swagger'
import { SosIncident } from '@prisma/types'
import { SosIncidentState, sosIncidentState } from 'src/domains/sos/sos-incident-state'

// What the rider's phone reads about its own SOS (spec 0022): enough to know whether to keep
// sharing (`state`) and which incident to send to. Never an admin's note or who closed it.
export class SosIncidentCourierDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: ['ACTIVE', 'AWAITING_CLOSE', 'CLOSED'] }) state: SosIncidentState
  @ApiProperty({ type: String, nullable: true }) deliveryId: string | null
  @ApiProperty() startedAt: Date
  @ApiProperty({ type: Date, nullable: true }) safeAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) falseAlarmAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) closedAt: Date | null

  constructor(incident: SosIncident) {
    this.id = incident.id
    this.state = sosIncidentState(incident)
    this.deliveryId = incident.deliveryId
    this.startedAt = incident.startedAt
    this.safeAt = incident.safeAt
    this.falseAlarmAt = incident.falseAlarmAt
    this.closedAt = incident.closedAt
  }
}
