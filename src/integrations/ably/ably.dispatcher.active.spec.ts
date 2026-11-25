import { AblyDispatcher } from './ably.dispatcher'
import { AblyService } from './ably.service'
import { describeErrorForLog, errorForConsole, errorSummaryForLog } from 'src/utils/errorForLog'
import { NotificationEventType, JobEditedMessage, courierNotificationChannel } from 'src/shared-types/index'

describe('AblyDispatcher (Row 139)', () => {
  let dispatcher: AblyDispatcher
  let mockAblyService: jest.Mocked<AblyService>
  let mockChannel: { publish: jest.Mock }
  let loggerErrorSpy: jest.SpyInstance
  let consoleLogSpy: jest.SpyInstance

  beforeEach(() => {
    mockChannel = {
      publish: jest.fn().mockResolvedValue(undefined),
    }
    mockAblyService = {
      getChannel: jest.fn().mockReturnValue(mockChannel),
    } as unknown as jest.Mocked<AblyService>

    dispatcher = new AblyDispatcher(mockAblyService)
    loggerErrorSpy = jest.spyOn((dispatcher as any).logger, 'error').mockImplementation(() => {})
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('publish rejection logs through errorForConsole without printing error whole', async () => {
    const error = new Error('Ably publish rejected: network timeout')
    mockChannel.publish.mockRejectedValue(error)

    await (dispatcher as any).publishMessage('test-channel', 'test-event', { id: 123 })

    expect(consoleLogSpy).toHaveBeenCalledWith(`error sending message: ${errorForConsole(error)}`)
    const logCall = consoleLogSpy.mock.calls[0]![0]
    expect(logCall).toContain('Error: Ably publish rejected: network timeout')
    expect(loggerErrorSpy).not.toHaveBeenCalled()
  })

  it('synchronous throw in publishMessage logs summary and stack frames only, never Error object', async () => {
    const error = new Error('Ably channel connection failed')
    mockAblyService.getChannel.mockImplementation(() => {
      throw error
    })

    await (dispatcher as any).publishMessage('test-channel', 'test-event', { id: 123 })

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const [msg, stack] = loggerErrorSpy.mock.calls[0]!

    expect(msg).toBe(
      `There was a problem trying to publish a message to ably channel test-channel: ${errorSummaryForLog(error)}`
    )
    expect(msg).toContain('Error: Ably channel connection failed')

    expect(stack).toBe(describeErrorForLog(error).stack)
    expect(stack).not.toBeInstanceOf(Error)
    expect(typeof stack).toBe('string')
    const lines = stack.split('\n')
    expect(lines.length).toBeGreaterThan(0)
    lines.forEach((l: string) => expect(l).toMatch(/^\s+at\s/))
  })

  test('sendJobEdited emits JOB_EDITED on courierNotificationChannel and logs delivery id only (Row 164)', async () => {
    const loggerLogSpy = jest.spyOn((dispatcher as any).logger, 'log').mockImplementation(() => {})
    const publishSpy = jest.spyOn(dispatcher as any, 'publishMessage').mockResolvedValue(undefined)

    const message: JobEditedMessage = {
      deliveryId: 'del-164',
      restaurantName: 'Secret Business Name',
      changed: ['NOTES', 'TIMES'],
      editedAt: '2026-11-25T14:00:00.000Z',
    }

    await dispatcher.sendJobEdited('courier-user-1', message)

    expect(publishSpy).toHaveBeenCalledWith(
      courierNotificationChannel('courier-user-1'),
      NotificationEventType.JOB_EDITED,
      message
    )

    expect(loggerLogSpy).toHaveBeenCalledWith('emitting JOB_EDITED for delivery del-164')
    const logged = loggerLogSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('del-164')
    expect(logged).not.toContain('Secret Business Name')
  })
})
