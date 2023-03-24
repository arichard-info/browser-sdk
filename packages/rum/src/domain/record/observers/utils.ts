import { isNodeShadowHost } from '@datadog/browser-rum-core'

export type ListenerHandler = () => void

export function getEventTarget(event: Event): Node {
  if (event.composed === true && isNodeShadowHost(event.target as Node)) {
    return event.composedPath()[0] as Node
  }
  return event.target as Node
}

const recordIds = new WeakMap<Event, number>()
let nextId = 1

export function getRecordIdForEvent(event: Event): number {
  if (!recordIds.has(event)) {
    recordIds.set(event, nextId++)
  }
  return recordIds.get(event)!
}
