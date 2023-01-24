import {
  addEventListener,
  addTelemetryDebug,
  DOM_EVENT,
  getSyntheticsTestId,
  includes,
  monitor,
} from '@datadog/browser-core'

export type MouseEventOnElement = MouseEvent & { target: Element }

export type GetUserActivity = () => { selection: boolean; input: boolean }
export interface ActionEventsHooks<ClickContext> {
  onPointerDown: (event: MouseEventOnElement) => ClickContext | undefined
  onClick: (context: ClickContext, event: MouseEventOnElement, getUserActivity: GetUserActivity) => void
}

export function listenActionEvents<ClickContext>({ onPointerDown, onClick }: ActionEventsHooks<ClickContext>) {
  let hasSelectionChanged = false
  let selectionEmptyAtPointerDown: boolean
  let hasInputChanged = false
  let clickContext: ClickContext | undefined

  const listeners = [
    addEventListener(
      window,
      DOM_EVENT.POINTER_DOWN,
      (event) => {
        logEvent(event)
        hasSelectionChanged = false
        selectionEmptyAtPointerDown = isSelectionEmpty()
        if (isMouseEventOnElement(event)) {
          clickContext = onPointerDown(event)
          if (shouldLog()) {
            addTelemetryDebug('New click context', { clickContext: Boolean(clickContext) })
          }
        }
      },
      { capture: true }
    ),

    addEventListener(
      window,
      DOM_EVENT.SELECTION_CHANGE,
      (event) => {
        logEvent(event)
        if (!selectionEmptyAtPointerDown || !isSelectionEmpty()) {
          hasSelectionChanged = true
        }
      },
      { capture: true }
    ),

    addEventListener(
      window,
      DOM_EVENT.CLICK,
      (clickEvent: MouseEvent) => {
        logEvent(clickEvent)
        if (isMouseEventOnElement(clickEvent) && clickContext) {
          // Use a scoped variable to make sure the value is not changed by other clicks
          const userActivity = {
            selection: hasSelectionChanged,
            input: hasInputChanged,
          }
          if (!hasInputChanged) {
            setTimeout(
              monitor(() => {
                userActivity.input = hasInputChanged
              })
            )
          }

          onClick(clickContext, clickEvent, () => userActivity)
          clickContext = undefined
          if (shouldLog()) {
            addTelemetryDebug('Reset click context', { clickContext: Boolean(clickContext) })
          }
        }
      },
      { capture: true }
    ),

    addEventListener(
      window,
      DOM_EVENT.INPUT,
      (event) => {
        logEvent(event)
        hasInputChanged = true
      },
      { capture: true }
    ),
  ]

  return {
    stop: () => {
      listeners.forEach((listener) => listener.stop())
    },
  }
}

function shouldLog() {
  return includes(['dth-et6-4xx', 'zch-9ia-ymv'], getSyntheticsTestId())
}

function logEvent(event: Event) {
  if (shouldLog()) {
    try {
      const target =
        event.target instanceof Text
          ? `#TEXT ${event.target.data}`
          : event.target instanceof Element
          ? `#ELEMENT ${(event.target.cloneNode(false) as Element).outerHTML}`
          : Object.prototype.toString.call(event.target)
      addTelemetryDebug('Event during Monitors synthetics test', {
        event: {
          type: event.type,
          timestamp: event.timeStamp,
          target,
          isTrusted: event.isTrusted,
        },
      })
    } catch (e) {
      addTelemetryDebug(`Event during Monitors synthetics test (error) ${String(e)}`, {})
    }
  }
}

function isSelectionEmpty(): boolean {
  const selection = window.getSelection()
  return !selection || selection.isCollapsed
}

function isMouseEventOnElement(event: Event): event is MouseEventOnElement {
  return event.target instanceof Element
}
