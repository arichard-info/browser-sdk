import { isIE } from '@datadog/browser-core'
import type { RumConfiguration, ViewContexts } from '@datadog/browser-rum-core'
import { createRumSessionManagerMock } from '../../../rum-core/test'
import { getSessionReplayLink } from './getSessionReplayLink'
import { addRecord, resetReplayStats } from './replayStats'

const DEFAULT_CONFIGURATION = {
  site: 'datad0g.com',
} as RumConfiguration

describe('getReplayLink', () => {
  afterEach(() => {
    resetReplayStats()
  })
  it('should return url without query param if no view', () => {
    const sessionManager = createRumSessionManagerMock().setId('session-id-1')
    const viewContexts = { findView: () => undefined } as ViewContexts

    const link = getSessionReplayLink(DEFAULT_CONFIGURATION, sessionManager, viewContexts)

    expect(link).toBe('https://dd.datad0g.com/rum/replay/sessions/session-id-1?')
  })

  it('should return the replay link', () => {
    const sessionManager = createRumSessionManagerMock().setId('session-id-1')
    const viewContexts = {
      findView: () => ({
        id: 'view-id-1',
        startClocks: {
          timeStamp: 123456,
        },
      }),
    } as ViewContexts
    addRecord('view-id-1')

    const link = getSessionReplayLink(
      { ...DEFAULT_CONFIGURATION, site: 'datadoghq.com', subdomain: 'toto' },
      sessionManager,
      viewContexts
    )

    expect(link).toBe(
      isIE()
        ? 'https://toto.datadoghq.com/rum/replay/sessions/session-id-1?seed=view-id-1&from=1234566&error-type=browser-not-supported'
        : 'https://toto.datadoghq.com/rum/replay/sessions/session-id-1?seed=view-id-1&from=123456'
    )
  })

  it('return a param if replay is sampled out', () => {
    const sessionManager = createRumSessionManagerMock().setId('session-id-1').setPlanWithoutSessionReplay()
    const viewContexts = {
      findView: () => ({
        id: 'view-id-1',
        startClocks: {
          timeStamp: 123456,
        },
      }),
    } as ViewContexts

    const link = getSessionReplayLink({ ...DEFAULT_CONFIGURATION, site: 'datadoghq.com' }, sessionManager, viewContexts)

    expect(link).toBe(
      'https://app.datadoghq.com/rum/replay/sessions/session-id-1?error-type=incorrect-session-plan&seed=view-id-1&from=123456'
    )
  })

  it('return a param if rum is sampled out', () => {
    const sessionManager = createRumSessionManagerMock().setNotTracked()
    const viewContexts = {
      findView: () => undefined,
    } as ViewContexts

    const link = getSessionReplayLink({ ...DEFAULT_CONFIGURATION, site: 'datadoghq.com' }, sessionManager, viewContexts)

    expect(link).toBe('https://app.datadoghq.com/rum/replay/sessions/session-id?error-type=rum-not-tracked')
  })
})
