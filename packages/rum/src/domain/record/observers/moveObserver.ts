import { addEventListeners, addTelemetryDebug, DOM_EVENT, throttle } from '@datadog/browser-core'
import { getSerializedNodeId, hasSerializedNode } from '../serializationUtils'
import type { ListenerHandler } from '../utils'
import { getEventTarget, isTouchEvent } from '../utils'
import type { MousePosition } from '../../../types'
import { IncrementalSource } from '../../../types'
import { convertMouseEventToLayoutCoordinates } from '../viewports'
import type { MousemoveCallBack } from './observers'
const MOUSE_MOVE_OBSERVER_THRESHOLD = 50

export function initMoveObserver(cb: MousemoveCallBack): ListenerHandler {
  const { throttled: updatePosition } = throttle(
    (event: MouseEvent | TouchEvent) => {
      const target = getEventTarget(event)
      if (hasSerializedNode(target)) {
        const coordinates = tryToComputeCoordinates(event)
        if (!coordinates) {
          return
        }
        const position: MousePosition = {
          id: getSerializedNodeId(target),
          timeOffset: 0,
          x: coordinates.x,
          y: coordinates.y,
        }

        cb([position], isTouchEvent(event) ? IncrementalSource.TouchMove : IncrementalSource.MouseMove)
      }
    },
    MOUSE_MOVE_OBSERVER_THRESHOLD,
    {
      trailing: false,
    }
  )

  return addEventListeners(document, [DOM_EVENT.MOUSE_MOVE, DOM_EVENT.TOUCH_MOVE], updatePosition, {
    capture: true,
    passive: true,
  }).stop
}

export function tryToComputeCoordinates(event: MouseEvent | TouchEvent) {
  let { clientX: x, clientY: y } = isTouchEvent(event) ? event.changedTouches[0] : event
  if (window.visualViewport) {
    const { visualViewportX, visualViewportY } = convertMouseEventToLayoutCoordinates(x, y)
    x = visualViewportX
    y = visualViewportY
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (event.isTrusted) {
      addTelemetryDebug('mouse/touch event without x/y')
    }
    return undefined
  }
  return { x, y }
}
