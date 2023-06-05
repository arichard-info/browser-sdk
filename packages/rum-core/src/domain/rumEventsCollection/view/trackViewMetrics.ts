import type { ClocksState, Duration, Observable, RelativeTime } from '@datadog/browser-core'
import {
  ExperimentalFeature,
  isExperimentalFeatureEnabled,
  DOM_EVENT,
  ONE_SECOND,
  addEventListener,
  elapsed,
  noop,
  relativeNow,
  round,
  throttle,
} from '@datadog/browser-core'
import type { RumLayoutShiftTiming } from '../../../browser/performanceCollection'
import { supportPerformanceTimingEvent } from '../../../browser/performanceCollection'
import { ViewLoadingType } from '../../../rawRumEvent.types'
import type { RumConfiguration } from '../../configuration'
import type { LifeCycle } from '../../lifeCycle'
import { LifeCycleEventType } from '../../lifeCycle'
import { waitPageActivityEnd } from '../../waitPageActivityEnd'

import { getScrollY } from '../../../browser/scroll'
import { getViewportDimension } from '../../../browser/viewportObservable'

export interface ScrollMetrics {
  maxScrollDepth?: number
  maxScrollHeight?: number
  maxScrollDepthTime?: Duration
  maxScrollTop?: number
}

export const THROTTLE_SCROLL_DURATION = ONE_SECOND

function computeScrollMetrics() {
  const scrollTop = getScrollY()

  const { height } = getViewportDimension()

  const scrollHeight = Math.round(document.documentElement.scrollHeight)
  const scrollDepth = Math.round(Math.min(height + scrollTop, scrollHeight))

  return {
    scrollHeight,
    scrollDepth,
    scrollTop,
  }
}

export function trackScrollMetrics(
  viewStart: ClocksState,
  getMetrics: () => {
    scrollHeight: number
    scrollDepth: number
    scrollTop: number
  },
  setScrollMetrics: (scrollMetrics: ScrollMetrics) => void
) {
  if (!isExperimentalFeatureEnabled(ExperimentalFeature.SCROLLMAP)) {
    return { stop: noop }
  }
  const trackedScrollMetrics: ScrollMetrics = {}
  const handleScrollEvent = throttle(
    () => {
      const { scrollHeight, scrollDepth, scrollTop } = getMetrics()

      if (scrollDepth > (trackedScrollMetrics.maxScrollDepth || 0)) {
        const now = relativeNow()
        const timeStamp = elapsed(viewStart.relative, now)
        trackedScrollMetrics.maxScrollDepth = scrollDepth
        trackedScrollMetrics.maxScrollHeight = scrollHeight
        trackedScrollMetrics.maxScrollDepthTime = timeStamp
        trackedScrollMetrics.maxScrollTop = scrollTop
        setScrollMetrics(trackedScrollMetrics)
      }
    },
    THROTTLE_SCROLL_DURATION,
    { leading: false, trailing: true }
  )

  const { stop } = addEventListener(window, DOM_EVENT.SCROLL, handleScrollEvent.throttled, { passive: true })

  return {
    stop: () => {
      handleScrollEvent.cancel()
      stop()
    },
  }
}

export interface ViewMetrics {
  loadingTime?: Duration
  cumulativeLayoutShift?: number
}

export function trackViewMetrics(
  lifeCycle: LifeCycle,
  domMutationObservable: Observable<void>,
  configuration: RumConfiguration,
  scheduleViewUpdate: () => void,
  loadingType: ViewLoadingType,
  viewStart: ClocksState
) {
  const viewMetrics: ViewMetrics = {}

  const scrollMetrics: ScrollMetrics = {}

  const { stop: stopLoadingTimeTracking, setLoadEvent } = trackLoadingTime(
    lifeCycle,
    domMutationObservable,
    configuration,
    loadingType,
    viewStart,
    (newLoadingTime) => {
      viewMetrics.loadingTime = newLoadingTime

      if (isExperimentalFeatureEnabled(ExperimentalFeature.SCROLLMAP)) {
        const { scrollHeight: maxScrollHeight, scrollDepth: maxScrollDepth, scrollTop } = computeScrollMetrics()
        scrollMetrics.maxScrollHeight = maxScrollHeight
        scrollMetrics.maxScrollDepth = maxScrollDepth
        scrollMetrics.maxScrollDepthTime = newLoadingTime
        scrollMetrics.maxScrollTop = scrollTop
      }
      scheduleViewUpdate()
    }
  )

  const { stop: stopScrollMetricsTracking } = trackScrollMetrics(
    viewStart,
    computeScrollMetrics,
    ({ maxScrollDepth, maxScrollHeight, maxScrollDepthTime, maxScrollTop }) => {
      scrollMetrics.maxScrollDepth = maxScrollDepth
      scrollMetrics.maxScrollHeight = maxScrollHeight
      scrollMetrics.maxScrollDepthTime = maxScrollDepthTime
      scrollMetrics.maxScrollTop = maxScrollTop
    }
  )

  let stopCLSTracking: () => void
  if (isLayoutShiftSupported()) {
    viewMetrics.cumulativeLayoutShift = 0
    ;({ stop: stopCLSTracking } = trackCumulativeLayoutShift(lifeCycle, (cumulativeLayoutShift) => {
      viewMetrics.cumulativeLayoutShift = cumulativeLayoutShift
      scheduleViewUpdate()
    }))
  } else {
    stopCLSTracking = noop
  }
  return {
    stop: () => {
      stopLoadingTimeTracking()
      stopCLSTracking()
      stopScrollMetricsTracking()
    },
    setLoadEvent,
    viewMetrics,
    scrollMetrics,
  }
}

function trackLoadingTime(
  lifeCycle: LifeCycle,
  domMutationObservable: Observable<void>,
  configuration: RumConfiguration,
  loadType: ViewLoadingType,
  viewStart: ClocksState,
  callback: (loadingTime: Duration) => void
) {
  let isWaitingForLoadEvent = loadType === ViewLoadingType.INITIAL_LOAD
  let isWaitingForActivityLoadingTime = true
  const loadingTimeCandidates: Duration[] = []

  function invokeCallbackIfAllCandidatesAreReceived() {
    if (!isWaitingForActivityLoadingTime && !isWaitingForLoadEvent && loadingTimeCandidates.length > 0) {
      callback(Math.max(...loadingTimeCandidates) as Duration)
    }
  }

  const { stop } = waitPageActivityEnd(lifeCycle, domMutationObservable, configuration, (event) => {
    if (isWaitingForActivityLoadingTime) {
      isWaitingForActivityLoadingTime = false
      if (event.hadActivity) {
        loadingTimeCandidates.push(elapsed(viewStart.timeStamp, event.end))
      }
      invokeCallbackIfAllCandidatesAreReceived()
    }
  })

  return {
    stop,
    setLoadEvent: (loadEvent: Duration) => {
      if (isWaitingForLoadEvent) {
        isWaitingForLoadEvent = false
        loadingTimeCandidates.push(loadEvent)
        invokeCallbackIfAllCandidatesAreReceived()
      }
    },
  }
}

/**
 * Track the cumulative layout shifts (CLS).
 * Layout shifts are grouped into session windows.
 * The minimum gap between session windows is 1 second.
 * The maximum duration of a session window is 5 second.
 * The session window layout shift value is the sum of layout shifts inside it.
 * The CLS value is the max of session windows values.
 *
 * This yields a new value whenever the CLS value is updated (a higher session window value is computed).
 *
 * See isLayoutShiftSupported to check for browser support.
 *
 * Documentation:
 * https://web.dev/cls/
 * https://web.dev/evolving-cls/
 * Reference implementation: https://github.com/GoogleChrome/web-vitals/blob/master/src/getCLS.ts
 */
function trackCumulativeLayoutShift(lifeCycle: LifeCycle, callback: (layoutShift: number) => void) {
  let maxClsValue = 0
  const window = slidingSessionWindow()
  const { unsubscribe: stop } = lifeCycle.subscribe(LifeCycleEventType.PERFORMANCE_ENTRIES_COLLECTED, (entries) => {
    for (const entry of entries) {
      if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
        window.update(entry)
        if (window.value() > maxClsValue) {
          maxClsValue = window.value()
          callback(round(maxClsValue, 4))
        }
      }
    }
  })

  return {
    stop,
  }
}

function slidingSessionWindow() {
  let value = 0
  let startTime: RelativeTime
  let endTime: RelativeTime
  return {
    update: (entry: RumLayoutShiftTiming) => {
      const shouldCreateNewWindow =
        startTime === undefined ||
        entry.startTime - endTime >= ONE_SECOND ||
        entry.startTime - startTime >= 5 * ONE_SECOND
      if (shouldCreateNewWindow) {
        startTime = endTime = entry.startTime
        value = entry.value
      } else {
        value += entry.value
        endTime = entry.startTime
      }
    },
    value: () => value,
  }
}

/**
 * Check whether `layout-shift` is supported by the browser.
 */
function isLayoutShiftSupported() {
  return supportPerformanceTimingEvent('layout-shift')
}
