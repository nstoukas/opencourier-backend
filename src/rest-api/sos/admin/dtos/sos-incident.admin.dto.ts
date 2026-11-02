import { ApiProperty } from '@nestjs/swagger'
import { EnumSosOutcome, SosLocationPoint } from '@prisma/types'
import { SosIncidentState, sosIncidentState } from 'src/domains/sos/sos-incident-state'
import { SosIncidentWithPeople } from 'src/persistence/repositories/sos-incident.repository'

// One SOS as admins see it in the list and the banner (spec 0022, AC-8, AC-9): the rider's name,
// the times, how it ended. Never a count of a rider's incidents (binding value 5).
export class SosIncidentAdminDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: ['ACTIVE', 'AWAITING_CLOSE', 'CLOSED'] }) state: SosIncidentState
  @ApiProperty() courier: { id: string; firstName: string; lastName: string }
  @ApiProperty({ type: String, nullable: true }) deliveryId: string | null
  @ApiProperty() startedAt: Date
  @ApiProperty() createdAt: Date
  @ApiProperty({ type: Date, nullable: true }) safeAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) falseAlarmAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) closedAt: Date | null
  @ApiProperty({ nullable: true }) closedBy: { id: string; email: string | null; username: string | null } | null
  @ApiProperty({ enum: EnumSosOutcome, nullable: true }) outcome: EnumSosOutcome | null
  @ApiProperty({ type: String, nullable: true }) note: string | null
  @ApiProperty({ type: Date, nullable: true }) pointsDeletedAt: Date | null

  constructor(incident: SosIncidentWithPeople) {
    this.id = incident.id
    this.state = sosIncidentState(incident)
    this.courier = incident.courier
    this.deliveryId = incident.deliveryId
    this.startedAt = incident.startedAt
    this.createdAt = incident.createdAt
    this.safeAt = incident.safeAt
    this.falseAlarmAt = incident.falseAlarmAt
    this.closedAt = incident.closedAt
    this.closedBy = incident.closedBy
    this.outcome = incident.outcome
    this.note = incident.note
    this.pointsDeletedAt = incident.pointsDeletedAt
  }
}

export class SosPointAdminDto {
  @ApiProperty() latitude: number
  @ApiProperty() longitude: number
  @ApiProperty({ type: Number, nullable: true }) accuracyMetres: number | null
  @ApiProperty() recordedAt: Date

  constructor(point: SosLocationPoint) {
    this.latitude = point.latitude
    this.longitude = point.longitude
    this.accuracyMetres = point.accuracyMetres
    this.recordedAt = point.recordedAt
  }
}

// The incident page (AC-9): the incident and its trail, oldest point first. Empty once deleted.
export class SosIncidentDetailAdminDto extends SosIncidentAdminDto {
  @ApiProperty({ type: [SosPointAdminDto] }) points: SosPointAdminDto[]

  constructor(incident: SosIncidentWithPeople, points: SosLocationPoint[]) {
    super(incident)
    this.points = points.map((point) => new SosPointAdminDto(point))
  }
}

// The closed list's page (AC-9).
export class SosIncidentPageAdminDto {
  @ApiProperty({ type: [SosIncidentAdminDto] }) data: SosIncidentAdminDto[]
  @ApiProperty() pagination: { page: number; limit: number; totalItems: number; totalPages: number }
}
