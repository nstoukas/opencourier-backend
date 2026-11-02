import {
  ACTIVE_SOS_WHERE,
  SOS_SENTENCES,
  sosIncidentState,
  sosPointRecordedAt,
} from './sos-incident-state'

describe('sosIncidentState and state transitions (Pin 1, Spec 0022 Terms)', () => {
  const now = new Date('2026-11-03T10:00:00.000Z')

  test('sosIncidentState returns ACTIVE when closedAt, safeAt, and falseAlarmAt are all null', () => {
    expect(
      sosIncidentState({
        closedAt: null,
        safeAt: null,
        falseAlarmAt: null,
      })
    ).toBe('ACTIVE')
  })

  test('sosIncidentState returns AWAITING_CLOSE when safeAt is set and closedAt is null', () => {
    expect(
      sosIncidentState({
        closedAt: null,
        safeAt: now,
        falseAlarmAt: null,
      })
    ).toBe('AWAITING_CLOSE')
  })

  test('sosIncidentState returns AWAITING_CLOSE when falseAlarmAt is set and closedAt is null', () => {
    expect(
      sosIncidentState({
        closedAt: null,
        safeAt: null,
        falseAlarmAt: now,
      })
    ).toBe('AWAITING_CLOSE')
  })

  test('sosIncidentState returns AWAITING_CLOSE when both safeAt and falseAlarmAt are set and closedAt is null', () => {
    expect(
      sosIncidentState({
        closedAt: null,
        safeAt: now,
        falseAlarmAt: now,
      })
    ).toBe('AWAITING_CLOSE')
  })

  test('sosIncidentState returns CLOSED whenever closedAt is set, regardless of safeAt or falseAlarmAt', () => {
    expect(
      sosIncidentState({
        closedAt: now,
        safeAt: null,
        falseAlarmAt: null,
      })
    ).toBe('CLOSED')

    expect(
      sosIncidentState({
        closedAt: now,
        safeAt: now,
        falseAlarmAt: null,
      })
    ).toBe('CLOSED')

    expect(
      sosIncidentState({
        closedAt: now,
        safeAt: null,
        falseAlarmAt: now,
      })
    ).toBe('CLOSED')

    expect(
      sosIncidentState({
        closedAt: now,
        safeAt: now,
        falseAlarmAt: now,
      })
    ).toBe('CLOSED')
  })

  test('ACTIVE_SOS_WHERE requires closedAt, safeAt, and falseAlarmAt all to be null', () => {
    expect(ACTIVE_SOS_WHERE).toEqual({
      closedAt: null,
      safeAt: null,
      falseAlarmAt: null,
    })
  })
})

describe('sosPointRecordedAt bounds (Pin 4, Spec 0022 Notes on table)', () => {
  const startedAt = new Date('2026-11-03T10:00:00.000Z')
  const receivedAt = new Date('2026-11-03T10:01:00.000Z') // 60 seconds later

  test('calculates recordedAt as receivedAt minus ageMs when within valid range', () => {
    const result = sosPointRecordedAt({
      receivedAt,
      ageMs: 20000, // 20s before receipt = 10:00:40
      startedAt,
    })
    expect(result.getTime()).toBe(new Date('2026-11-03T10:00:40.000Z').getTime())
  })

  test('clamps recordedAt to startedAt when ageMs would place it before startedAt (lower bound)', () => {
    const result = sosPointRecordedAt({
      receivedAt,
      ageMs: 90000, // 90s before receipt = 09:59:30, older than start 10:00:00
      startedAt,
    })
    expect(result.getTime()).toBe(startedAt.getTime())
  })

  test('clamps recordedAt to receivedAt when ageMs is negative (upper bound)', () => {
    const result = sosPointRecordedAt({
      receivedAt,
      ageMs: -5000, // future claim relative to server receipt
      startedAt,
    })
    expect(result.getTime()).toBe(receivedAt.getTime())
  })

  test('handles exact boundary at startedAt', () => {
    const result = sosPointRecordedAt({
      receivedAt,
      ageMs: 60000, // exactly 60s
      startedAt,
    })
    expect(result.getTime()).toBe(startedAt.getTime())
  })

  test('handles exact boundary at receivedAt when ageMs is 0', () => {
    const result = sosPointRecordedAt({
      receivedAt,
      ageMs: 0,
      startedAt,
    })
    expect(result.getTime()).toBe(receivedAt.getTime())
  })
})

describe('SOS_SENTENCES (Pin 1, AC-13)', () => {
  test('defines fixed sentences without parameter interpolation', () => {
    expect(SOS_SENTENCES.notFound).toBe('This SOS was not found.')
    expect(SOS_SENTENCES.deliveryNotYours).toBe('This delivery is not yours.')
    expect(SOS_SENTENCES.courierInSos).toBe(
      'This rider has an active SOS and cannot be given a delivery until it ends.'
    )
  })
})
