import { DeliveryEvent } from 'src/shared-types'

// Row 95: how a delivery event is named in the log. Ids, type, actor and source only: never the
// event's `message`, which is free text an admin or a client can fill (a name, a phone, an address),
// and never anything added to an event later. The full event, message included, is kept on its
// DeliveryEvent row for members to audit (binding value 1); the log is not that record.
export function eventLogLine(event: Pick<DeliveryEvent, 'deliveryId' | 'type' | 'actor' | 'source' | 'courierId'>): string {
  const courier = event.courierId ? ` courier=${event.courierId}` : ''
  return `delivery=${event.deliveryId} type=${event.type} actor=${event.actor} source=${event.source}${courier}`
}
