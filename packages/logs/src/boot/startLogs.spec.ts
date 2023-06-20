import { ErrorSource, display, stopSessionManager, getCookie, SESSION_STORE_KEY } from '@datadog/browser-core'
import type { Request } from '@datadog/browser-core/test'
import {
  interceptRequests,
  stubEndpointBuilder,
  deleteEventBridgeStub,
  initEventBridgeStub,
  cleanupSyntheticsWorkerValues,
  mockSyntheticsWorkerValues,
} from '@datadog/browser-core/test'

import type { LogsConfiguration } from '../domain/configuration'
import { validateAndBuildLogsConfiguration } from '../domain/configuration'
import { HandlerType, Logger, StatusType } from '../domain/logger'
import type { startLoggerCollection } from '../domain/logsCollection/logger/loggerCollection'
import type { LogsEvent } from '../logsEvent.types'
import { startLogs } from './startLogs'

function getLoggedMessage(requests: Request[], index: number) {
  return JSON.parse(requests[index].body) as LogsEvent
}

interface Rum {
  getInternalContext(startTime?: number): any | undefined
}
declare global {
  interface Window {
    DD_RUM?: Rum
    DD_RUM_SYNTHETICS?: Rum
  }
}

const DEFAULT_MESSAGE = { status: StatusType.info, message: 'message' }
const COMMON_CONTEXT = {
  view: { referrer: 'common_referrer', url: 'common_url' },
  context: {},
  user: {},
}

describe('logs', () => {
  const initConfiguration = { clientToken: 'xxx', service: 'service', telemetrySampleRate: 0 }
  let baseConfiguration: LogsConfiguration
  let interceptor: ReturnType<typeof interceptRequests>
  let requests: Request[]
  let handleLog: ReturnType<typeof startLoggerCollection>['handleLog']
  let logger: Logger
  let consoleLogSpy: jasmine.Spy
  let displayLogSpy: jasmine.Spy

  beforeEach(() => {
    baseConfiguration = {
      ...validateAndBuildLogsConfiguration(initConfiguration)!,
      logsEndpointBuilder: stubEndpointBuilder('https://localhost/v1/input/log'),
      batchMessagesLimit: 1,
    }
    logger = new Logger((...params) => handleLog(...params))
    interceptor = interceptRequests()
    requests = interceptor.requests
    consoleLogSpy = spyOn(console, 'log')
    displayLogSpy = spyOn(display, 'log')
  })

  afterEach(() => {
    delete window.DD_RUM
    deleteEventBridgeStub()
    stopSessionManager()
    interceptor.restore()
  })

  describe('request', () => {
    it('should send the needed data', () => {
      ;({ handleLog: handleLog } = startLogs(initConfiguration, baseConfiguration, () => COMMON_CONTEXT))

      handleLog({ message: 'message', status: StatusType.warn, context: { foo: 'bar' } }, logger, COMMON_CONTEXT)

      expect(requests.length).toEqual(1)
      expect(requests[0].url).toContain(baseConfiguration.logsEndpointBuilder.build('xhr'))
      expect(getLoggedMessage(requests, 0)).toEqual({
        date: jasmine.any(Number),
        foo: 'bar',
        message: 'message',
        service: 'service',
        session_id: jasmine.any(String),
        status: StatusType.warn,
        view: {
          referrer: 'common_referrer',
          url: 'common_url',
        },
        origin: ErrorSource.LOGGER,
      })
    })

    it('should all use the same batch', () => {
      ;({ handleLog } = startLogs(
        initConfiguration,
        { ...baseConfiguration, batchMessagesLimit: 3 },
        () => COMMON_CONTEXT
      ))

      handleLog(DEFAULT_MESSAGE, logger)
      handleLog(DEFAULT_MESSAGE, logger)
      handleLog(DEFAULT_MESSAGE, logger)

      expect(requests.length).toEqual(1)
    })

    it('should send bridge event when bridge is present', () => {
      const sendSpy = spyOn(initEventBridgeStub(), 'send')
      ;({ handleLog: handleLog } = startLogs(initConfiguration, baseConfiguration, () => COMMON_CONTEXT))

      handleLog(DEFAULT_MESSAGE, logger)

      expect(requests.length).toEqual(0)
      const [message] = sendSpy.calls.mostRecent().args
      const parsedMessage = JSON.parse(message)
      expect(parsedMessage).toEqual({
        eventType: 'log',
        event: jasmine.objectContaining({ message: 'message' }),
      })
    })
  })

  describe('sampling', () => {
    it('should be applied when event bridge is present', () => {
      const sendSpy = spyOn(initEventBridgeStub(), 'send')

      let configuration = { ...baseConfiguration, sessionSampleRate: 0 }
      ;({ handleLog } = startLogs(initConfiguration, configuration, () => COMMON_CONTEXT))
      handleLog(DEFAULT_MESSAGE, logger)

      expect(sendSpy).not.toHaveBeenCalled()

      configuration = { ...baseConfiguration, sessionSampleRate: 100 }
      ;({ handleLog } = startLogs(initConfiguration, configuration, () => COMMON_CONTEXT))
      handleLog(DEFAULT_MESSAGE, logger)

      expect(sendSpy).toHaveBeenCalled()
    })
  })

  it('should not print the log twice when console handler is enabled', () => {
    logger.setHandler([HandlerType.console])
    ;({ handleLog } = startLogs(
      initConfiguration,
      { ...baseConfiguration, forwardConsoleLogs: ['log'] },
      () => COMMON_CONTEXT
    ))

    /* eslint-disable-next-line no-console */
    console.log('foo', 'bar')

    expect(consoleLogSpy).toHaveBeenCalledTimes(1)
    expect(displayLogSpy).not.toHaveBeenCalled()
  })

  describe('logs session creation', () => {
    afterEach(() => {
      cleanupSyntheticsWorkerValues()
    })

    it('creates a session on normal conditions', () => {
      ;({ handleLog } = startLogs(initConfiguration, baseConfiguration, () => COMMON_CONTEXT))

      expect(getCookie(SESSION_STORE_KEY)).not.toBeUndefined()
    })

    it('does not create a session if event bridge is present', () => {
      initEventBridgeStub()
      ;({ handleLog } = startLogs(initConfiguration, baseConfiguration, () => COMMON_CONTEXT))

      expect(getCookie(SESSION_STORE_KEY)).toBeUndefined()
    })

    it('does not create a session if synthetics worker will inject RUM', () => {
      mockSyntheticsWorkerValues({ injectsRum: true })
      ;({ handleLog } = startLogs(initConfiguration, baseConfiguration, () => COMMON_CONTEXT))

      expect(getCookie(SESSION_STORE_KEY)).toBeUndefined()
    })
  })
})
