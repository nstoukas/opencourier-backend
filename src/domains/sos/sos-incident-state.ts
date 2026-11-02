import { Prisma } from '@prisma/types'

// The three states of an SOS incident (spec 0022, "Terms"). None of them is stored: each follows
// from the incident's own times, so the record can never say one thing and the times another.
export type SosIncidentState = 'ACTIVE' | 'AWAITING_CLOSE' | 'CLOSED'

type IncidentTimes = { closedAt: Date | null; safeAt: Date | null; falseAlarmAt: Date | null }

export function sosIncidentState(incident: IncidentTimes): SosIncidentState {
  if (incident.closedAt) return 'CLOSED'
  if (incident.safeAt || incident.falseAlarmAt) return 'AWAITING_CLOSE'
  return 'ACTIVE'
}

// Prisma `where` for an active incident: nobody has ended it yet. Only then does the phone share
// its position and the rider count as busy (AC-5, AC-7). The matchers' raw SQL says the same in
// `activeSosCourierSubQuery` (courier.repository.ts); change both together.
export const ACTIVE_SOS_WHERE: Prisma.SosIncidentWhereInput = {
  closedAt: null,
  safeAt: null,
  falseAlarmAt: null,
}

// When a point was recorded, from its age on the phone (spec 0022, Notes on the table): the
// server's receipt time minus `ageMs`, never earlier than the incident's start and never after the
// receipt. Like a job step's tap time, only a difference of the phone's clock is used, never its
// date, so a phone set to the wrong day cannot place a point anywhere else.
export function sosPointRecordedAt(input: { receivedAt: Date; ageMs: number; startedAt: Date }): Date {
  const received = input.receivedAt.getTime()
  const atLeastStart = Math.max(received - input.ageMs, input.startedAt.getTime())
  return new Date(Math.min(atLeastStart, received))
}

// The fixed sentences the SOS routes answer with. None of them names a value the phone sent: no
// coordinate may reach a log line through an error message (AC-13).
export const SOS_SENTENCES = {
  notFound: 'This SOS was not found.',
  deliveryNotYours: 'This delivery is not yours.',
  courierInSos: 'This rider has an active SOS and cannot be given a delivery until it ends.',
}
