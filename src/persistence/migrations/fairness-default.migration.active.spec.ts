import * as fs from 'fs'
import * as path from 'path'

describe('Migration 20261121030100_fairness_default (Spec 0044: AC-7, cross check 8)', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../prisma/migrations/20261121030100_fairness_default/migration.sql'
  )
  const migrationSql = fs.readFileSync(migrationPath, 'utf8')

  test('updates only NEAREST_COURIER or COURIER_SENIORITY to FAIRNESS in Config', () => {
    expect(migrationSql).toContain('UPDATE "Config" SET "value" = \'FAIRNESS\'')
    expect(migrationSql).toMatch(
      /WHERE\s+"key"\s*=\s*'courierMatcherType'\s+AND\s+"value"\s+IN\s*\('NEAREST_COURIER',\s*'COURIER_SENIORITY'\)/
    )
    // Ensures STATIC or other matchers are NOT updated
    expect(migrationSql).not.toContain("'STATIC'")
  })

  test('inserts a SettingChange record with changedByUserId NULL', () => {
    expect(migrationSql).toContain('INSERT INTO "SettingChange"')
    expect(migrationSql).toContain('"changedByUserId"')
    // NULL is selected for changedByUserId (operator decision, no admin user id)
    expect(migrationSql).toContain('CURRENT_TIMESTAMP, NULL')
    expect(migrationSql).toContain("'fairness-default-2026-11-20'")
    expect(migrationSql).toContain("'courierMatcherType'")
    expect(migrationSql).toContain("to_jsonb('FAIRNESS'::text)")
  })
})
