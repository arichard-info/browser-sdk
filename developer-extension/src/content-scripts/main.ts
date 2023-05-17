// this script is executed in the "main" execution world, the same world as the webpage. Thus, it
// can define global attributes that will be accessible by the webpage.

export {}
declare global {
  interface Window extends EventTarget {
    DD_RUM?: SdkPublicApi
    DD_LOGS?: SdkPublicApi
    __ddBrowserSdkRumInstances: SdkPublicApi[]
    __ddBrowserSdkLogsInstances: SdkPublicApi[]
    __ddBrowserSdkExtensionCallback: (message: unknown) => void
  }
}

export type SdkPublicApi = { version: string; [key: string]: any }

// Define a global callback variable to listen to SDK events.
window.__ddBrowserSdkExtensionCallback = (message: unknown) => {
  // Relays any message to the "isolated" content-script via a custom event.
  window.dispatchEvent(
    new CustomEvent('__ddBrowserSdkMessage', {
      detail: message,
    })
  )
}

proxy('DD_RUM', '__ddBrowserSdkRumInstances')
proxy('DD_LOGS', '__ddBrowserSdkLogsInstances')

function proxy(
  global: 'DD_RUM' | 'DD_LOGS',
  instancesKey: '__ddBrowserSdkRumInstances' | '__ddBrowserSdkLogsInstances'
) {
  // Define a global variable to store browser SDK instances
  window[instancesKey] = []

  // Push the potentially already existing DD_RUM/DD_LOGS instance. It can happen if the chrome dev tool is opened after the page load.
  if (window[global]) {
    window[instancesKey].push(window[global]!)
  }

  // Define DD_RUM getter and setter to keep track of potential multiple instances of the SDK
  Object.defineProperty(window, global, {
    set(sdkInstance: SdkPublicApi) {
      window[instancesKey].push(sdkInstance)
    },
    get(): SdkPublicApi | undefined {
      // Always return the dev bundle instance if present (to work with "Use development bundles" option)
      const devBundle = window[instancesKey].find((rumSdk) => rumSdk.version === 'dev')
      if (devBundle) {
        return devBundle
      }
      return window[instancesKey].length ? window[instancesKey][window[instancesKey].length - 1] : undefined
    },
  })
}
