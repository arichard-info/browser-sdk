// This file implements a way to relay messages from the web page to the devtools script. Basically,
// the devtools panel cannot simply listen for messages on the inspected page. Instead, messages
// from the web page are relayed through a list of scripts:
//
// 1. web-page calls a global callback defined by a "main" content script
// 2. the "main" content script relays the message to an "isolated" content script via a custom
//    event
// 3. the "isolated" content script relays the message to the background script via the
//    chrome.runtime.sendMessage API
// 4. the background script relays the message to the devtools panel via a persistent connection
//    (chrome.runtime.Port)
//
// Steps 2, 3 and 4 are a solution advised in the documentation provided by Google Chrome:
// https://developer.chrome.com/docs/extensions/mv3/devtools/#content-script-to-devtools

import { createLogger } from '../../common/logger'
import { store } from '../store'
import { listenAction } from '../actions'

const logger = createLogger('devBundleInjection')

const devtoolsConnections = new Map<number, chrome.runtime.Port>()

const portNameRe = /^devtools-panel-for-tab-(\d+)$/

// Listen for connection from the devtools-panel
chrome.runtime.onConnect.addListener((port) => {
  const match = portNameRe.exec(port.name)
  if (!match) {
    return
  }

  const tabId = Number(match[1])

  logger.log(`New devtools connection for tab ${tabId}`)
  devtoolsConnections.set(tabId, port)

  if (devtoolsConnections.size === 1) {
    // Register content script when a first devtools panel is open and useDevBundles
    if (store.useDevBundles) {
      registerDevSdkAsContentScript().catch((error) =>
        logger.error('Error while registering dev bundle content scripts:', error)
      )
    }
  }

  port.onDisconnect.addListener(() => {
    logger.log(`Remove devtools connection for tab ${tabId}`)
    devtoolsConnections.delete(tabId)
    if (devtoolsConnections.size === 0) {
      // Unregister content scripts when the last devtools panel is open
      unregisterDevSdkAsContentScript().catch((error) =>
        logger.error('Error while unregistering dev sdk content scripts:', error)
      )
    }
  })
})

listenAction('setStore', (newStore) => {
  if ('useDevBundles' in newStore) {
    if (store.useDevBundles) {
      registerDevSdkAsContentScript().catch((error) =>
        logger.error('Error while registering dev bundle content scripts:', error)
      )
    } else {
      unregisterDevSdkAsContentScript().catch((error) =>
        logger.error('Error while unregistering dev sdk content scripts:', error)
      )
    }
  }
})

const devSdkContentScripts = [
  {
    id: 'browser-rum-sdk-dev-package',
    world: 'MAIN' as const,
    file: './datadog-rum.js',
  },
  {
    id: 'browser-logs-sdk-dev-package',
    world: 'MAIN' as const,
    file: './datadog-logs.js',
  },
]

async function registerDevSdkAsContentScript() {
  await unregisterDevSdkAsContentScript()
  await chrome.scripting.registerContentScripts(
    devSdkContentScripts.map((script) => ({
      id: script.id,
      allFrames: true,
      js: [script.file],
      matches: ['<all_urls>'],
      world: script.world,
      runAt: 'document_start',
    }))
  )
}

async function unregisterDevSdkAsContentScript() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: devSdkContentScripts.map((script) => script.id) })
  } catch {
    // This will throw an error when scripts are not registered. Just ignore it.
  }
}
