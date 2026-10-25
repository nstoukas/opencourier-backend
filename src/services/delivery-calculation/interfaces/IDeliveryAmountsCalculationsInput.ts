export interface IDeliveryAmountsCalculationsInput {
  deliveryId: string
  // The courier the amounts are for. Left out, it is the delivery's stored matchedCourierId. The
  // offer step passes it so amounts can be worked out before the offer is written (spec 0002).
  courierId?: string
}
