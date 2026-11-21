export enum EnumCourierMatcherType {
  NEAREST_COURIER = 'NEAREST_COURIER',
  COURIER_SENIORITY = 'COURIER_SENIORITY',
  STATIC = 'STATIC',
  // Spec 0044 (rows 12 and 13): a weighted score of road time, earnings per hour today and waiting,
  // with the co-op's weights. The default since 2026-11-20 (operator decision).
  FAIRNESS = 'FAIRNESS',
}

export const COURIER_MATCHER_TYPE_TO_HUMAN: Record<EnumCourierMatcherType, string> = {
  NEAREST_COURIER: 'Nearest courier',
  COURIER_SENIORITY: 'Courier seniority',
  STATIC: 'Static courier id (For development)',
  FAIRNESS: 'Fairness (co-op weights)',
}
