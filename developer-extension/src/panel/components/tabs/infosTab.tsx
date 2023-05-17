import { Anchor, Button, Divider, Group, Space, Tabs, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import React from 'react'
import { evalInWindow } from '../../evalInWindow'
import type { SdkInfos } from '../../hooks/useSdksInfos'
import { useSdksInfos } from '../../hooks/useSdksInfos'
import { Columns } from '../columns'
import { Json } from '../json'
import { TabBase } from '../tabBase'
import { createLogger } from '../../../common/logger'

const logger = createLogger('infosTab')

export function InfosTab() {
  const infos = useSdksInfos()
  if (!infos) {
    return null
  }
  const sessionId = infos.cookie?.id

  return (
    <TabBase>
      <Columns>
        <Columns.Column title="Session">
          {infos.cookie && (
            <>
              <Entry name="Id" value={infos.cookie.id} />
              <Entry name="Logs" value={formatSessionType(infos.cookie.logs, 'Not tracked', 'Tracked')} />
              <Entry
                name="RUM"
                value={formatSessionType(
                  infos.cookie.rum,
                  'Not tracked',
                  'Tracked with Session Replay',
                  'Tracked without Session Replay'
                )}
              />
              <Entry name="Created" value={formatDate(Number(infos.cookie.created))} />
              <Entry name="Expire" value={formatDate(Number(infos.cookie.expire))} />
              <Space h="sm" />
              <Button color="violet" variant="light" onClick={endSession}>
                End current session
              </Button>
            </>
          )}
        </Columns.Column>
        <Columns.Column title={`RUM ${infos.rum.length > 1 ? `(${String(infos.rum.length)} instances)` : ''}`}>
          {infos.rum.length && (
            <SdkTabs
              sdksInfos={infos.rum}
              renderSdkInfos={(sdkInfos) => (
                <>
                  {sessionId && (
                    <Group>
                      <AppLink
                        config={sdkInfos.config}
                        path="rum/explorer"
                        params={{
                          query: `source:browser @session.id:${sessionId}`,
                          live: 'true',
                        }}
                      >
                        Explorer
                      </AppLink>
                      <Divider sx={{ height: '24px' }} orientation="vertical" />
                      <AppLink config={sdkInfos.config} path={`rum/replay/sessions/${sessionId}`} params={{}}>
                        Session Replay
                      </AppLink>
                    </Group>
                  )}
                  <Entry name="Version" value={sdkInfos.version} />
                  <Entry name="Configuration" value={sdkInfos.config} />
                  <Entry name="Internal context" value={sdkInfos.internalContext} />
                  <Entry name="Global context" value={sdkInfos.globalContext} />
                  <Entry name="User" value={sdkInfos.user} />
                </>
              )}
            />
          )}
        </Columns.Column>
        <Columns.Column title={`Logs ${infos.logs.length > 1 ? `(${String(infos.logs.length)} instances)` : ''}`}>
          {infos.logs.length && (
            <SdkTabs
              sdksInfos={infos.logs}
              renderSdkInfos={(sdkInfos) => (
                <>
                  {sessionId && (
                    <AppLink
                      config={sdkInfos.config}
                      path="logs"
                      params={{
                        query: `source:browser @session_id:${sessionId}`,
                      }}
                    >
                      Explorer
                    </AppLink>
                  )}
                  <Entry name="Version" value={sdkInfos.version} />
                  <Entry name="Configuration" value={sdkInfos.config} />
                  <Entry name="Global context" value={sdkInfos.globalContext} />
                  <Entry name="User" value={sdkInfos.user} />
                </>
              )}
            />
          )}
        </Columns.Column>
      </Columns>
    </TabBase>
  )
}

function SdkTabs<T extends SdkInfos>({
  sdksInfos,
  renderSdkInfos,
}: {
  sdksInfos: T[]
  renderSdkInfos: (sdkInfos: T) => ReactNode
}) {
  return (
    <Tabs color="violet" defaultValue={String(0)} variant="pills" radius="xl">
      {sdksInfos && (
        <>
          <Tabs.List>
            {sdksInfos.map((infos, index) => (
              <Tabs.Tab value={String(index)}>{infos.version}</Tabs.Tab>
            ))}
          </Tabs.List>
          {sdksInfos.map(
            (infos, index) =>
              infos && (
                <Tabs.Panel value={String(index)} sx={{ flex: 1, minHeight: 0 }}>
                  {renderSdkInfos(infos)}
                </Tabs.Panel>
              )
          )}
        </>
      )}
    </Tabs>
  )
}

function AppLink({
  config,
  path,
  params,
  children,
}: {
  config?: { site?: string }
  path: string
  params: { [key: string]: string }
  children: ReactNode
}) {
  const site = config?.site ?? 'datadoghq.com'
  const hostname = site === 'datadoghq.com' ? 'app.datadoghq.com' : site === 'datad0g.com' ? 'dd.datad0g.com' : site
  return (
    <Anchor href={`https://${hostname}/${path}?${new URLSearchParams(params).toString()}`} target="_blank">
      {children}
    </Anchor>
  )
}

function Entry({ name, value }: { name: string; value: any }) {
  return (
    <Text sx={{ fontFamily: 'menlo, sans-serif', fontSize: 11 }} component="div">
      {typeof value === 'string' ? (
        <>
          {name}: {value}
        </>
      ) : value ? (
        <div style={{ marginLeft: -17 }}>
          <Json name={name} src={value} collapsed={1} />
        </div>
      ) : (
        <>{name}: (empty)</>
      )}
    </Text>
  )
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString('en-US')
}

function formatSessionType(value: string, ...labels: string[]) {
  const index = Number(value)
  return !isNaN(index) && index >= 0 && index < labels.length ? labels[index] : value
}

function endSession() {
  evalInWindow(
    `
      document.cookie = '_dd_s=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    `
  ).catch((error) => logger.error('Error while ending session:', error))
}
