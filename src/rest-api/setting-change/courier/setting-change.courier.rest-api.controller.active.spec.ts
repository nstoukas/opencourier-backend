import { SettingChangeCourierRestApiController } from './setting-change.courier.rest-api.controller'
import { WorkRulesService } from 'src/services/work-rules/work-rules.service'
import { HowItWorksCourierDto, SettingChangeCourierPageDto } from '../setting-change.dto'
import { ReviewPageArgs } from 'src/rest-api/review-request/queries/review-request.inputs'

describe('SettingChangeCourierRestApiController (row 137, problem 15)', () => {
  let controller: SettingChangeCourierRestApiController
  let mockWorkRulesService: {
    howItWorks: jest.Mock
    riderChanges: jest.Mock
  }

  const mockHowItWorksResult: HowItWorksCourierDto = {
    offers: ['Προσφορά 1'],
    pay: ['Αμοιβή 1'],
    personDecides: ['Άνθρωπος 1'],
    appRecords: ['Καταγραφή 1'],
    timeWorked: ['Χρόνος 1'],
    earningsFigures: ['Αποδοχές 1'],
    reviewAnswerDays: 14,
  }

  beforeEach(() => {
    mockWorkRulesService = {
      howItWorks: jest.fn().mockResolvedValue(mockHowItWorksResult),
      riderChanges: jest.fn().mockResolvedValue({ data: [] } as SettingChangeCourierPageDto),
    }

    controller = new SettingChangeCourierRestApiController(mockWorkRulesService as unknown as WorkRulesService)
  })

  describe('GET /how-it-works (howItWorks)', () => {
    it('passes "el" to service when lang query is exactly "el"', async () => {
      const result = await controller.howItWorks('el')

      // Exactly "el" passes "el"
      expect(mockWorkRulesService.howItWorks).toHaveBeenCalledWith('el')
      expect(result).toBe(mockHowItWorksResult)
    })

    it('passes "en" to service when lang query is "en"', async () => {
      await controller.howItWorks('en')

      expect(mockWorkRulesService.howItWorks).toHaveBeenCalledWith('en')
    })

    it('passes "en" to service when lang query is undefined (missing)', async () => {
      await controller.howItWorks(undefined)

      // Missing query parameter defaults to English
      expect(mockWorkRulesService.howItWorks).toHaveBeenCalledWith('en')
    })

    it('passes "en" to service when lang query is an unsupported language like "fr"', async () => {
      await controller.howItWorks('fr')

      // Anything other than "el" falls back to English
      expect(mockWorkRulesService.howItWorks).toHaveBeenCalledWith('en')
    })

    it('passes "en" to service when lang query is uppercase "EL"', async () => {
      await controller.howItWorks('EL')

      // Case-sensitive check: only lowercase "el" passes "el"
      expect(mockWorkRulesService.howItWorks).toHaveBeenCalledWith('en')
    })

    it('passes "en" to service when lang query is empty string ""', async () => {
      await controller.howItWorks('')

      expect(mockWorkRulesService.howItWorks).toHaveBeenCalledWith('en')
    })

    it('passes "en" to service when lang query is "greek"', async () => {
      await controller.howItWorks('greek')

      expect(mockWorkRulesService.howItWorks).toHaveBeenCalledWith('en')
    })
  })

  describe('GET /setting-changes (changes)', () => {
    it('delegates to workRulesService.riderChanges with query arguments', async () => {
      const args: ReviewPageArgs = { page: 2, perPage: 10 }
      const expectedPage: SettingChangeCourierPageDto = { data: [] }
      mockWorkRulesService.riderChanges.mockResolvedValue(expectedPage)

      const result = await controller.changes(args)

      expect(mockWorkRulesService.riderChanges).toHaveBeenCalledWith(args)
      expect(result).toBe(expectedPage)
    })
  })
})
