import * as fs from 'fs'
import * as path from 'path'

describe('Complaint Value 5 Guard (AC-8 & Cross check 12)', () => {
  const rootSrc = path.resolve(__dirname, '../../')

  function findFiles(dir: string, filter: (filePath: string) => boolean): string[] {
    const results: string[] = []
    if (!fs.existsSync(dir)) return results

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, filter))
      } else if (entry.isFile() && filter(fullPath)) {
        results.push(fullPath)
      }
    }
    return results
  }

  describe('AC-8 / Cross check 12: No matcher, fairness, or pay folder imports ComplaintRepository', () => {
    // Check folders:
    // - src/domains/matching
    // - src/services/delivery-calculation
    // - src/services/quote-calculation
    // - src/domains/delivery-quote
    // - src/services/time-worked
    const foldersToCheck = [
      path.join(rootSrc, 'domains/matching'),
      path.join(rootSrc, 'services/delivery-calculation'),
      path.join(rootSrc, 'services/quote-calculation'),
      path.join(rootSrc, 'domains/delivery-quote'),
      path.join(rootSrc, 'services/time-worked'),
    ]

    const files = foldersToCheck.flatMap((dir) =>
      findFiles(dir, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    )

    it('finds source files in matching, fairness and pay directories', () => {
      expect(files.length).toBeGreaterThan(0)
    })

    files.forEach((filePath) => {
      const relativePath = path.relative(rootSrc, filePath)
      it(`${relativePath} does not import ComplaintRepository or read complaint data`, () => {
        const content = fs.readFileSync(filePath, 'utf8')
        expect(content).not.toMatch(/complaint\.repository/i)
        expect(content).not.toMatch(/\bComplaintRepository\b/)
        expect(content).not.toMatch(/from\s+['"].*\/complaint/i)
      })
    })
  })

  describe('AC-8 / Cross check 12: CourierAdminDto has no complaint properties', () => {
    const courierAdminDtoPath = path.join(rootSrc, 'rest-api/courier/admin/dtos/courier.admin.dto.ts')

    it('ensures CourierAdminDto exists and contains no property matching /complaint/i', () => {
      expect(fs.existsSync(courierAdminDtoPath)).toBe(true)
      const content = fs.readFileSync(courierAdminDtoPath, 'utf8')

      // Check lines declaring properties: @ApiProperty, class fields
      const lines = content.split('\n')
      for (const line of lines) {
        // Exclude comments
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          continue
        }
        expect(trimmed).not.toMatch(/complaint/i)
      }
    })
  })

  describe('AC-8: ComplaintCourierPagingDto contains no total or count fields', () => {
    const complaintDtoPath = path.join(rootSrc, 'rest-api/complaint/dtos/complaint.dto.ts')

    it('ensures ComplaintCourierPagingDto exists and has no total or count properties', () => {
      expect(fs.existsSync(complaintDtoPath)).toBe(true)
      const content = fs.readFileSync(complaintDtoPath, 'utf8')

      // Extract ComplaintCourierPagingDto class slice
      const startIdx = content.indexOf('class ComplaintCourierPagingDto')
      expect(startIdx).toBeGreaterThanOrEqual(0)
      const endIdx = content.indexOf('class ', startIdx + 30)
      const classSlice = endIdx > -1 ? content.slice(startIdx, endIdx) : content.slice(startIdx)

      expect(classSlice).not.toMatch(/total/i)
      expect(classSlice).not.toMatch(/count/i)
      expect(classSlice).toMatch(/currentPage/)
      expect(classSlice).toMatch(/perPage/)
      expect(classSlice).toMatch(/prevPage/)
      expect(classSlice).toMatch(/nextPage/)
    })
  })

  describe('AC-8: No matcher inputs contain complaint fields', () => {
    const matcherFiles = findFiles(
      path.join(rootSrc, 'domains/matching'),
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')
    )

    matcherFiles.forEach((filePath) => {
      const relativePath = path.relative(rootSrc, filePath)
      it(`${relativePath} declares no complaint field in its interfaces or score inputs`, () => {
        const content = fs.readFileSync(filePath, 'utf8')
        const lines = content.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            continue
          }
          expect(trimmed).not.toMatch(/\bcomplaints?\b/i)
          expect(trimmed).not.toMatch(/complaintCount/i)
        }
      })
    })
  })

  describe('AC-8: No persistence queries group, count or aggregate Complaint by rider', () => {
    const persistenceFiles = findFiles(
      path.join(rootSrc, 'persistence'),
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')
    )

    persistenceFiles.forEach((filePath) => {
      const relativePath = path.relative(rootSrc, filePath)
      it(`${relativePath} does not group or aggregate Complaint by aboutCourierId or filerCourierId across riders`, () => {
        const content = fs.readFileSync(filePath, 'utf8')

        // 1. complaint.groupBy
        expect(content).not.toMatch(/complaint\.groupBy\s*\(/)
        // 2. Raw SQL grouping complaints by courier
        expect(content).not.toMatch(/GROUP\s+BY\s+.*aboutCourierId/i)
        expect(content).not.toMatch(/GROUP\s+BY\s+.*filerCourierId/i)
      })
    })
  })

  describe('Guard detection proof: ensures patterns catch violations', () => {
    it('catches prohibited import of complaint repository', () => {
      const violatingSnippet = "import { ComplaintRepository } from 'src/persistence/repositories/complaint.repository'"
      expect(violatingSnippet).toMatch(/complaint\.repository/i)
      expect(violatingSnippet).toMatch(/\bComplaintRepository\b/)
    })

    it('catches prohibited complaint property in CourierAdminDto', () => {
      const violatingDtoSnippet = '  @ApiProperty({ type: Number }) complaintCount: number'
      expect(violatingDtoSnippet).toMatch(/complaint/i)
    })

    it('catches prohibited complaint aggregation in persistence', () => {
      const violatingSql = 'SELECT "aboutCourierId", COUNT(*) FROM "Complaint" GROUP BY "aboutCourierId"'
      expect(violatingSql).toMatch(/GROUP\s+BY\s+.*aboutCourierId/i)
    })
  })
})
