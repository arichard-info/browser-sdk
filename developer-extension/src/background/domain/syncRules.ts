import type { NetRequestRulesOptions } from '../../common/types'
import { INTAKE_DOMAINS } from '../../common/constants'
import { createLogger } from '../../common/logger'
import { onDevtoolsDisconnection, onDevtoolsMessage } from '../devtoolsPanelConnection'

const logger = createLogger('syncRules')

onDevtoolsDisconnection.subscribe((tabId) => {
  clearRules(tabId).catch((error) => logger.error('Error while clearing rules:', error))
})

onDevtoolsMessage.subscribe((message) => {
  if (message.type === 'update-net-request-rules') {
    updateRules(message.options).catch((error) => logger.error('Error while updating rules:', error))
  }
})

async function clearRules(tabId: number) {
  logger.log(`Clearing rules for tab ${tabId}`)
  const { tabRuleIds } = await getExistingRulesInfos(tabId)
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: tabRuleIds,
  })
  await chrome.browsingData.removeCache({})
}

async function updateRules(options: NetRequestRulesOptions) {
  logger.log(`Updating rules for tab ${options.tabId}`)
  const { tabRuleIds, nextRuleId } = await getExistingRulesInfos(options.tabId)
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: tabRuleIds,
    addRules: buildRules(options, nextRuleId),
  })
  await chrome.browsingData.removeCache({})
}

async function getExistingRulesInfos(tabId: number) {
  const rules = await chrome.declarativeNetRequest.getSessionRules()

  let nextRuleId = 1
  const tabRuleIds: number[] = []
  for (const rule of rules) {
    if (rule.condition.tabIds?.includes(tabId)) {
      tabRuleIds.push(rule.id)
    } else {
      nextRuleId = rule.id + 1
    }
  }

  return { tabRuleIds, nextRuleId }
}

function buildRules({ tabId, blockIntakeRequests }: NetRequestRulesOptions, nextRuleId: number) {
  const rules: chrome.declarativeNetRequest.Rule[] = []
  let id = nextRuleId

  if (blockIntakeRequests) {
    logger.log('add block intake rules')
    for (const intakeDomain of INTAKE_DOMAINS) {
      rules.push({
        id: id++,
        condition: { tabIds: [tabId], urlFilter: `||${intakeDomain}` },
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.BLOCK,
        },
      })
    }
  }

  return rules
}
