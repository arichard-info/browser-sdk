import type { StackTrace } from './types'

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
