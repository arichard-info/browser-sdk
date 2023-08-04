import type { MantineTheme } from '@mantine/core'
import { rem } from '@mantine/core'

export const BORDER_RADIUS = 8

export function separatorBorder(theme: MantineTheme) {
  return `1px solid ${borderColor(theme)}`
}

/**
 * Returns the same CSS border as the mantine TabsList
 */
export function tabsListBorder(theme: MantineTheme) {
  // https://github.com/mantinedev/mantine/blob/cf0f85faec56615ea5fbd7813e83bac60dbaefb7/src/mantine-core/src/Tabs/TabsList/TabsList.styles.ts#L25-L26
  return `${rem(2)} solid ${borderColor(theme)}`
}

function borderColor(theme: MantineTheme) {
  return theme.colorScheme === 'dark' ? theme.colors.dark[4] : theme.colors.gray[3]
}
