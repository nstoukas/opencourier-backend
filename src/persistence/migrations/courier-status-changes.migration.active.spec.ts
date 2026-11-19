import * as fs from 'fs'
import * as path from 'path'
import { DELIVERY_ONGOING_STATUSES } from 'src/shared-types/stateMachine'

describe('Migration 20261119200000_courier_status_changes (spec 0040, AC-1, AC-3)', () => {
  // Moved out of the migration's own folder, which holds only the applied SQL.
  const migrationPath = path.resolve(
    __dirname,
    '../../../prisma/migrations/20261119200000_courier_status_changes/migration.sql'
  )
  const migrationSql = fs.readFileSync(migrationPath, 'utf8')

  test('creates the CHECK constraint that fromStatus differs from toStatus (AC-1)', () => {
    expect(migrationSql).toContain('CHECK ("fromStatus" <> "toStatus")')
    expect(migrationSql).toContain('ADD CONSTRAINT "CourierStatusChange_status_differs"')
  })

  test('inserts SYSTEM_START rows only for riders whose status is not OFFLINE (AC-3)', () => {
    expect(migrationSql).toContain('INSERT INTO "CourierStatusChange"')
    expect(migrationSql).toContain("'SYSTEM_START'")
    expect(migrationSql).toContain("'OFFLINE'")
    // Only for riders not offline:
    expect(migrationSql).toMatch(/WHERE\s+c\."status"\s*<>\s*'OFFLINE'/)
  })

  test('fills DeliveryEvent.courierId only on the latest successful ACCEPTED of deliveries in the six DELIVERY_ONGOING_STATUSES (AC-3)', () => {
    expect(migrationSql).toContain('UPDATE "DeliveryEvent"')
    expect(migrationSql).toContain('SET "courierId" = d."courierId"')
    expect(migrationSql).toContain('FROM "Delivery" d')

    // Latest successful ACCEPTED subquery
    expect(migrationSql).toContain("e2.\"type\" = 'ACCEPTED'")
    expect(migrationSql).toContain('e2."transitionSuccessful" = true')
    expect(migrationSql).toMatch(/ORDER BY\s+e2\."createdAt"\s+DESC,\s+e2\."id"\s+DESC/)
    expect(migrationSql).toContain('LIMIT 1')

    // Must require d.courierId IS NOT NULL
    expect(migrationSql).toContain('d."courierId" IS NOT NULL')

    // Must cover all six DELIVERY_ONGOING_STATUSES and only them
    for (const status of DELIVERY_ONGOING_STATUSES) {
      expect(migrationSql).toContain(`'${status}'`)
    }

    // Verify non-ongoing statuses are NOT included in the status IN (...) filter
    const nonOngoingStatuses = ['CREATED', 'DROPPED_OFF', 'CANCELED', 'FAILED']
    for (const status of nonOngoingStatuses) {
      expect(migrationSql).not.toContain(`'${status}'`)
    }
  })
})
