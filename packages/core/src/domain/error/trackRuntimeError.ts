import type { Observable } from '../../tools/observable'
import { clocksNow } from '../../tools/utils/timeUtils'
import { startUnhandledErrorCollection } from '../tracekit'
import { computeRawError } from './error'
import type { RawError } from './error.types'
import { ErrorHandling, ErrorSource } from './error.types'

export function trackRuntimeError(errorObservable: Observable<RawError>) {
  return startUnhandledErrorCollection((stackTrace, originalError) => {
    errorObservable.notify(
      computeRawError({
        stackTrace,
        originalError,
        startClocks: clocksNow(),
        nonErrorPrefix: 'Uncaught',
        source: ErrorSource.SOURCE,
        handling: ErrorHandling.UNHANDLED,
      })
    )
  })
}
