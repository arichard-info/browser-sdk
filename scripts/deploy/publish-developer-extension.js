// chrome-webstore-upload only support ESM syntax.
const webstore = (...args) => import('chrome-webstore-upload').then(({ default: webstore }) => webstore(...args))
const fs = require('node:fs')

const { printLog, runMain } = require('../lib/execution-utils')
const { command } = require('../lib/command')
const { getChromeWebStoreClientId, getChromeWebStoreRefreshToken } = require('../lib/secrets')

const ZIP_FILE_NAME = 'developer-extension.zip'

runMain(async () => {
  printLog('Building the project')
  command`yarn build`.withEnvironment({ BUILD_MODE: 'release' }).run()

  printLog('Zipping extension files')
  command`zip -jr ${ZIP_FILE_NAME} developer-extension/dist/`.run()

  printLog('Publish Developer extension')
  await uploadAndPublish()

  printLog('Developer extension published.')
})

async function uploadAndPublish() {
  const zipFile = fs.createReadStream(ZIP_FILE_NAME)
  const api = await webstore({
    extensionId: 'TODO',
    clientId: getChromeWebStoreClientId(),
    refreshToken: getChromeWebStoreRefreshToken(),
  })

  try {
    printLog('Fetching the token')
    const token = await api.fetchToken()

    printLog('Uploading the archive')
    await api.uploadExisting(zipFile, token)

    printLog('Publishing to trusted testers')
    await api.publish('trustedTesters')
  } catch (err) {
    const body = err?.response?.body
    if (body) {
      throw body
    }
    throw err
  }
}
