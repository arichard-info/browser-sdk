import { computeStackTrace } from '../tracekit'
import { createHandlingStack, formatErrorMessage, toStackTraceString } from '../../tools/error'
import { mergeObservables, Observable } from '../../tools/observable'
import { find, jsonStringify } from '../../tools/utils'
import { ConsoleApiName } from '../../tools/display'
import { callMonitored } from '../../tools/monitor'

export interface ConsoleLog {
  /* Error message created from the concatenation of console parameters */
  message: string
  /* The console API generating this log (debug, info, warn, error, ...) */
  api: ConsoleApiName
  /* The specific type of the first Error object present in console parameters (SyntaxError, RangeError, ...) */
  kind?: string
  /* The stack trace provided by the first Error object present in console parameters */
  stack?: string
  /* The message included in the first Error object present in console parameters */
  errorMessage?: string
  /* The stack trace at the time the console method is called */
  handlingStack?: string
}

const consoleObservablesByApi: { [k in ConsoleApiName]?: Observable<ConsoleLog> } = {}

export function initConsoleObservable(apis: ConsoleApiName[]) {
  const consoleObservables = apis.map((api) => {
    if (!consoleObservablesByApi[api]) {
      consoleObservablesByApi[api] = createConsoleObservable(api)
    }
    return consoleObservablesByApi[api]!
  })

  return mergeObservables<ConsoleLog>(...consoleObservables)
}

/* eslint-disable no-console */
function createConsoleObservable(api: ConsoleApiName) {
  const observable = new Observable<ConsoleLog>(() => {
    const originalConsoleApi = console[api]

    console[api] = (...params: unknown[]) => {
      originalConsoleApi.apply(console, params)
      const handlingStack = createHandlingStack()

      callMonitored(() => {
        observable.notify(buildConsoleLog(params, api, handlingStack))
      })
    }

    return () => {
      console[api] = originalConsoleApi
    }
  })

  return observable
}

function buildConsoleLog(params: unknown[], api: ConsoleApiName, handlingStack: string): ConsoleLog {
  // Todo: remove console error prefix in the next major version
  let message = params.map((param) => formatConsoleParameters(param)).join(' ')
  let stack
  let kind
  let errorMessage

  if (api === ConsoleApiName.error) {
    const firstErrorParam = find(params, (param: unknown): param is Error => param instanceof Error)
    if (firstErrorParam) {
      const stackTrace = computeStackTrace(firstErrorParam)
      stack = toStackTraceString(stackTrace)
      kind = stackTrace.name
      errorMessage = stackTrace.message
    }
    message = `console error: ${message}`
  }

  return {
    api,
    kind,
    message,
    errorMessage,
    stack,
    handlingStack,
  }
}

function formatConsoleParameters(param: unknown) {
  if (typeof param === 'string') {
    return param
  }
  if (param instanceof Error) {
    return formatErrorMessage(computeStackTrace(param))
  }
  return jsonStringify(param, undefined, 2)
}
