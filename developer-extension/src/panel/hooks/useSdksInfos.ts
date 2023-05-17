import { useEffect, useState } from 'react'
import { createLogger } from '../../common/logger'
import { evalInWindow } from '../evalInWindow'

const logger = createLogger('useSdkInfos')

const REFRESH_INFOS_INTERVAL = 2000

export interface SdksInfos {
  rum: RumSdkInfos[]
  logs: LogsSdkInfos[]
  cookie?: {
    id: string
    created: string
    expire: string
    logs: string
    rum: string
  }
}

export interface RumSdkInfos {
  version?: string
  config?: object & { site?: string }
  internalContext?: object & { session: { id: string } }
  globalContext?: object
  user?: object
}

export interface LogsSdkInfos {
  version?: string
  config?: object & { site?: string }
  globalContext?: object
  user?: object
}

export type SdkInfos = LogsSdkInfos | LogsSdkInfos

export function useSdksInfos() {
  const [infos, setInfos] = useState<SdksInfos | undefined>()

  useEffect(() => {
    function refreshSdksInfos() {
      void getSdksInfos().then((newInfos) =>
        setInfos((previousInfos) => (deepEqual(previousInfos, newInfos) ? previousInfos : newInfos))
      )
    }
    refreshSdksInfos()
    const id = setInterval(refreshSdksInfos, REFRESH_INFOS_INTERVAL)
    return () => clearInterval(id)
  }, [])

  return infos
}

async function getSdksInfos(): Promise<SdksInfos> {
  try {
    return (await evalInWindow(
      `
        const cookieRawValue = document.cookie
          .split(';')
          .map(cookie => cookie.match(/(\\S*?)=(.*)/)?.slice(1) || [])
          .find(([name, _]) => name === '_dd_s')
          ?.[1]

        const cookie = cookieRawValue && Object.fromEntries(
          cookieRawValue.split('&').map(value => value.split('='))
        )
        const rum = window.__ddBrowserSdkRumInstances && window.__ddBrowserSdkRumInstances.map(ddRum =>  ({
          version: ddRum.version,
          config: ddRum.getInitConfiguration?.(),
          internalContext: ddRum.getInternalContext?.(),
          globalContext: ddRum.getRumGlobalContext?.(),
        }))
       
        const logs = window.__ddBrowserSdkLogsInstances && window.__ddBrowserSdkLogsInstances.map(ddLogs =>  ({
          version: ddLogs.version,
          config: ddLogs.getInitConfiguration?.(),
          globalContext: ddLogs.getRumGlobalContext?.(),
        }))
        
        return { rum, logs, cookie }
      `
    )) as SdksInfos
  } catch (error) {
    logger.error('Error while getting SDK infos:', error)
  }
  return {
    rum: [],
    logs: [],
  }
}

function deepEqual(a: unknown, b: unknown) {
  // Quick and dirty but does the job. We might want to include a cleaner helper if our needs are
  // changing.
  return JSON.stringify(a) === JSON.stringify(b)
}
