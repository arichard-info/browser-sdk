import type { TimeStamp, HttpRequest } from '@datadog/browser-core'
import { PageExitReason, DefaultPrivacyLevel, noop, isIE, timeStampNow } from '@datadog/browser-core'
import type { LifeCycle, ViewCreatedEvent } from '@datadog/browser-rum-core'
import { LifeCycleEventType } from '@datadog/browser-rum-core'
import { inflate } from 'pako'
import type { Clock } from '@datadog/browser-core/test'
import { collectAsyncCalls, createNewEvent, mockClock } from '@datadog/browser-core/test'
import type { RumSessionManagerMock, TestSetupBuilder } from '../../../rum-core/test'
import { createRumSessionManagerMock, setup } from '../../../rum-core/test'

import { recordsPerFullSnapshot } from '../../test'
import { setSegmentBytesLimit, startDeflateWorker } from '../domain/segmentCollection'

import type { BrowserSegment } from '../types'
import { RecordType } from '../types'
import { resetReplayStats } from '../domain/replayStats'
import { startRecording } from './startRecording'

const VIEW_TIMESTAMP = 1 as TimeStamp

describe('startRecording', () => {
  let setupBuilder: TestSetupBuilder
  let sessionManager: RumSessionManagerMock
  let viewId: string
  let sandbox: HTMLElement
  let textField: HTMLInputElement
  let requestSendSpy: jasmine.Spy<HttpRequest['sendOnExit']>
  let stopRecording: () => void
  let clock: Clock | undefined

  beforeEach((done) => {
    if (isIE()) {
      pending('IE not supported')
    }
    resetReplayStats()
    sessionManager = createRumSessionManagerMock()
    viewId = 'view-id'

    sandbox = document.createElement('div')
    document.body.appendChild(sandbox)
    textField = document.createElement('input')
    sandbox.appendChild(textField)

    startDeflateWorker((worker) => {
      setupBuilder = setup()
        .withViewContexts({
          findView() {
            return { id: viewId }
          },
        })
        .withSessionManager(sessionManager)
        .withConfiguration({
          defaultPrivacyLevel: DefaultPrivacyLevel.ALLOW,
        })
        .beforeBuild(({ lifeCycle, configuration, viewContexts, sessionManager }) => {
          requestSendSpy = jasmine.createSpy()
          const httpRequest = {
            send: requestSendSpy,
            sendOnExit: requestSendSpy,
          }

          const recording = startRecording(lifeCycle, configuration, sessionManager, viewContexts, worker!, httpRequest)
          stopRecording = recording ? recording.stop : noop
          return { stop: stopRecording }
        })
      done()
    })
  })

  afterEach(() => {
    sandbox.remove()
    setSegmentBytesLimit()
    setupBuilder.cleanup()
    clock?.cleanup()
  })

  it('sends recorded segments with valid context', (done) => {
    const { lifeCycle } = setupBuilder.build()
    flushSegment(lifeCycle)

    collectAsyncCalls(requestSendSpy, 1, (calls) => {
      expect(calls.first().args[0]).toEqual({ data: jasmine.any(FormData), bytesCount: jasmine.any(Number) })
      expect(getRequestData(calls.first())).toEqual({
        'application.id': 'appId',
        creation_reason: 'init',
        end: jasmine.stringMatching(/^\d{13}$/),
        has_full_snapshot: 'true',
        records_count: String(recordsPerFullSnapshot()),
        segment: jasmine.any(File),
        'session.id': 'session-id',
        start: jasmine.stringMatching(/^\d{13}$/),
        raw_segment_size: jasmine.stringMatching(/^\d+$/),
        'view.id': 'view-id',
        index_in_view: '0',
        source: 'browser',
      })
      done()
    })
  })

  it('flushes the segment when its compressed data reaches the segment bytes limit', (done) => {
    setupBuilder.build()
    const inputCount = 150
    const inputEvent = createNewEvent('input', { target: textField })
    for (let i = 0; i < inputCount; i += 1) {
      // Create a random value harder to deflate, so we don't have to send too many events to reach
      // the limit.
      textField.value = createRandomString(1000)
      document.body.dispatchEvent(inputEvent)
    }

    collectAsyncCalls(requestSendSpy, 1, (calls) => {
      expect(getRequestData(calls.first()).records_count).toBe(String(inputCount + recordsPerFullSnapshot()))
      done()
    })
  })

  it('stops sending new segment when the session is expired', (done) => {
    const { lifeCycle } = setupBuilder.build()

    document.body.dispatchEvent(createNewEvent('click', { clientX: 1, clientY: 2 }))

    sessionManager.setNotTracked()
    flushSegment(lifeCycle)
    document.body.dispatchEvent(createNewEvent('click', { clientX: 1, clientY: 2 }))

    flushSegment(lifeCycle)

    collectAsyncCalls(requestSendSpy, 1, (calls) => {
      expect(getRequestData(calls.first()).records_count).toBe(String(1 + recordsPerFullSnapshot()))
      done()
    })
  })

  it('restarts sending segments when the session is renewed', (done) => {
    sessionManager.setNotTracked()
    const { lifeCycle } = setupBuilder.build()

    document.body.dispatchEvent(createNewEvent('click', { clientX: 1, clientY: 2 }))

    sessionManager.setId('new-session-id').setPlanWithSessionReplay()
    flushSegment(lifeCycle)
    document.body.dispatchEvent(createNewEvent('click', { clientX: 1, clientY: 2 }))

    flushSegment(lifeCycle)

    collectAsyncCalls(requestSendSpy, 1, (calls) => {
      const data = getRequestData(calls.first())
      expect(data.records_count).toBe('1')
      expect(data['session.id']).toBe('new-session-id')
      done()
    })
  })

  it('takes a full snapshot when the view changes', (done) => {
    const { lifeCycle } = setupBuilder.build()

    changeView(lifeCycle)
    flushSegment(lifeCycle)

    collectAsyncCalls(requestSendSpy, 2, (calls) => {
      expect(getRequestData(calls.mostRecent()).has_full_snapshot).toBe('true')
      done()
    })
  })

  it('full snapshot related records should have the view change date', (done) => {
    clock = mockClock()
    const { lifeCycle } = setupBuilder.build()

    changeView(lifeCycle)
    flushSegment(lifeCycle)

    collectAsyncCalls(requestSendSpy, 2, (calls) => {
      readRequestSegment(calls.first(), (segment) => {
        expect(segment.records[0].timestamp).toEqual(timeStampNow())
        expect(segment.records[1].timestamp).toEqual(timeStampNow())
        expect(segment.records[2].timestamp).toEqual(timeStampNow())
        expect(segment.records[3].timestamp).toEqual(timeStampNow())

        readRequestSegment(calls.mostRecent(), (segment) => {
          expect(segment.records[0].timestamp).toEqual(VIEW_TIMESTAMP)
          expect(segment.records[1].timestamp).toEqual(VIEW_TIMESTAMP)
          expect(segment.records[2].timestamp).toEqual(VIEW_TIMESTAMP)

          done()
        })
      })
    })
  })

  it('adds a ViewEnd record when the view ends', (done) => {
    const { lifeCycle } = setupBuilder.build()

    changeView(lifeCycle)
    flushSegment(lifeCycle)

    collectAsyncCalls(requestSendSpy, 2, (calls) => {
      expect(getRequestData(calls.first())['view.id']).toBe('view-id')
      readRequestSegment(calls.first(), (segment) => {
        expect(segment.records[segment.records.length - 1].type).toBe(RecordType.ViewEnd)
        done()
      })
    })
  })

  it('flushes pending mutations before ending the view', (done) => {
    const { lifeCycle } = setupBuilder.build()

    sandbox.appendChild(document.createElement('hr'))
    changeView(lifeCycle)
    flushSegment(lifeCycle)

    collectAsyncCalls(requestSendSpy, 2, (calls) => {
      readRequestSegment(calls.first(), (segment) => {
        expect(segment.records[segment.records.length - 2].type).toBe(RecordType.IncrementalSnapshot)
        expect(segment.records[segment.records.length - 1].type).toBe(RecordType.ViewEnd)

        readRequestSegment(calls.mostRecent(), (segment) => {
          expect(segment.records[0].type).toBe(RecordType.Meta)
          done()
        })
      })
    })
  })

  it('does not split Meta, Focus and FullSnapshot records between multiple segments when taking a full snapshot', (done) => {
    setSegmentBytesLimit(0)
    setupBuilder.build()

    collectAsyncCalls(requestSendSpy, 1, (calls) => {
      readRequestSegment(calls.first(), (segment) => {
        expect(segment.records[0].type).toBe(RecordType.Meta)
        expect(segment.records[1].type).toBe(RecordType.Focus)
        expect(segment.records[2].type).toBe(RecordType.FullSnapshot)
        done()
      })
    })
  })

  describe('when calling stop()', () => {
    it('stops collecting records', (done) => {
      const { lifeCycle } = setupBuilder.build()

      document.body.dispatchEvent(createNewEvent('click', { clientX: 1, clientY: 2 }))
      stopRecording()
      document.body.dispatchEvent(createNewEvent('click', { clientX: 1, clientY: 2 }))
      flushSegment(lifeCycle)

      collectAsyncCalls(requestSendSpy, 1, (calls) => {
        expect(getRequestData(calls.first()).records_count).toBe(String(1 + recordsPerFullSnapshot()))
        done()
      })
    })

    it('stops taking full snapshots on view creation', (done) => {
      const { lifeCycle } = setupBuilder.build()

      stopRecording()
      changeView(lifeCycle)
      flushSegment(lifeCycle)

      collectAsyncCalls(requestSendSpy, 1, (calls) => {
        expect(getRequestData(calls.first()).records_count).toBe(String(recordsPerFullSnapshot()))
        done()
      })
    })
  })

  function changeView(lifeCycle: LifeCycle) {
    lifeCycle.notify(LifeCycleEventType.VIEW_ENDED, {} as any)
    viewId = 'view-id-2'
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { relative: 1, timeStamp: VIEW_TIMESTAMP },
    } as Partial<ViewCreatedEvent> as any)
  }
})

function flushSegment(lifeCycle: LifeCycle) {
  lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, { reason: PageExitReason.UNLOADING })
}

function getRequestData(call: jasmine.CallInfo<HttpRequest['sendOnExit']>) {
  const result: { [key: string]: unknown } = {}
  getRequestFormData(call).forEach((value, key) => {
    result[key] = value
  })
  return result
}

function readRequestSegment(
  call: jasmine.CallInfo<HttpRequest['sendOnExit']>,
  callback: (segment: BrowserSegment) => void
) {
  const encodedSegment = getRequestFormData(call).get('segment')
  expect(encodedSegment).toBeInstanceOf(Blob)
  const reader = new FileReader()
  reader.addEventListener('loadend', () => {
    const textDecoder = new TextDecoder()
    callback(JSON.parse(textDecoder.decode(inflate(reader.result as Uint8Array))))
  })
  reader.readAsArrayBuffer(encodedSegment as Blob)
}

function getRequestFormData(call: jasmine.CallInfo<HttpRequest['sendOnExit']>) {
  const payload = call.args[0]
  expect(payload.data).toEqual(jasmine.any(FormData))
  return payload.data as FormData
}

function createRandomString(minLength: number) {
  let result = ''
  while (result.length < minLength) {
    result += Math.random().toString(36)
  }
  return result
}
