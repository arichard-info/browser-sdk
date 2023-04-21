import type { StackTrace } from '../tracekit'
import { computeStackTrace } from '../tracekit'
import { callMonitored } from '../../tools/monitor'
import { sanitize } from '../../tools/serialisation/sanitize'
import type { ClocksState } from '../../tools/utils/timeUtils'
import { noop } from '../../tools/utils/functionUtils'
import { jsonStringify } from '../../tools/serialisation/jsonStringify'
import type { ErrorSource, ErrorHandling, RawError, RawErrorCause, ErrorWithCause, NonErrorPrefix } from './error.types'

export const NO_ERROR_STACK_PRESENT_MESSAGE = 'No stack, consider using an instance of Error'

type RawErrorParams = {
  stackTrace?: StackTrace
  originalError: unknown

  handlingStack?: string
  startClocks: ClocksState
  nonErrorPrefix: NonErrorPrefix
  source: ErrorSource
  handling: ErrorHandling
}

export function computeRawError({
  stackTrace,
  originalError,
  handlingStack,
  startClocks,
  nonErrorPrefix,
  source,
  handling,
}: RawErrorParams): RawError {
  const isErrorInstance = originalError instanceof Error
  const sanitizedError = sanitize(originalError)

  const message = stackTrace?.message
    ? stackTrace.message
    : !isErrorInstance
    ? `${nonErrorPrefix} ${jsonStringify(sanitizedError)!}`
    : 'Empty message'
  const stack = isValidStackTrace(isErrorInstance, stackTrace)
    ? toStackTraceString(stackTrace)
    : NO_ERROR_STACK_PRESENT_MESSAGE
  const causes = isErrorInstance ? flattenErrorCauses(originalError as ErrorWithCause, source) : undefined
  const type = stackTrace && stackTrace.name

  return {
    startClocks,
    source,
    handling,
    handlingStack,
    originalError,
    type,
    message,
    stack,
    causes,
  }
}

function isValidStackTrace(isErrorInstance: boolean, stackTrace?: StackTrace): stackTrace is StackTrace {
  return (
    stackTrace !== undefined &&
    (isErrorInstance ||
      (stackTrace.stack.length > 0 && (stackTrace.stack.length > 1 || stackTrace.stack[0].url !== undefined)))
  )
}

export function toStackTraceString(stack: StackTrace) {
  let result = formatErrorMessage(stack)
  stack.stack.forEach((frame) => {
    const func = frame.func === '?' ? '<anonymous>' : frame.func
    const args = frame.args && frame.args.length > 0 ? `(${frame.args.join(', ')})` : ''
    const line = frame.line ? `:${frame.line}` : ''
    const column = frame.line && frame.column ? `:${frame.column}` : ''
    result += `\n  at ${func!}${args} @ ${frame.url!}${line}${column}`
  })
  return result
}

export function getFileFromStackTraceString(stack: string) {
  return /@ (.+)/.exec(stack)?.[1]
}

export function formatErrorMessage(stack: StackTrace) {
  return `${stack.name || 'Error'}: ${stack.message!}`
}

/**
 Creates a stacktrace without SDK internal frames.
 
 Constraints:
 - Has to be called at the utmost position of the call stack.
 - No monitored function should encapsulate it, that is why we need to use callMonitored inside it.
 */
export function createHandlingStack(): string {
  /**
   * Skip the two internal frames:
   * - SDK API (console.error, ...)
   * - this function
   * in order to keep only the user calls
   */
  const internalFramesToSkip = 2
  const error = new Error()
  let formattedStack: string

  // IE needs to throw the error to fill in the stack trace
  if (!error.stack) {
    try {
      throw error
    } catch (e) {
      noop()
    }
  }

  callMonitored(() => {
    const stackTrace = computeStackTrace(error)
    stackTrace.stack = stackTrace.stack.slice(internalFramesToSkip)
    formattedStack = toStackTraceString(stackTrace)
  })

  return formattedStack!
}

export function flattenErrorCauses(error: ErrorWithCause, parentSource: ErrorSource): RawErrorCause[] | undefined {
  let currentError = error
  const causes: RawErrorCause[] = []
  while (currentError?.cause instanceof Error && causes.length < 10) {
    const stackTrace = computeStackTrace(currentError.cause)
    causes.push({
      message: currentError.cause.message,
      source: parentSource,
      type: stackTrace?.name,
      stack: stackTrace && toStackTraceString(stackTrace),
    })
    currentError = currentError.cause
  }
  return causes.length ? causes : undefined
}
