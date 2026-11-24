export enum CacheKeys {
  DELIVERY_COURIER_MATCH = 'delivery-courier-match:deliveryId',
  // Row 148: a sorted set (one end time per rider), so a new key name: the old key held a JSON array, and
  // a sorted set command on it would fail. Old keys run out by themselves within the skip time.
  DELIVERY_REJECTED_COURIERS = 'delivery-skip-list:deliveryId',
}

export class CacheHelpers {
  static getDeliveryCourierMatchKey(deliveryId: string) {
    return CacheKeys.DELIVERY_COURIER_MATCH.replace('deliveryId', deliveryId)
  }

  static getDeliveryRejectedCouriersKey(deliveryId: string) {
    return CacheKeys.DELIVERY_REJECTED_COURIERS.replace('deliveryId', deliveryId)
  }
}
