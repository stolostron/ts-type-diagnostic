import chalk from 'chalk'
import { getNodeLink } from './utils'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _____      _                        _
//  | ____|_  _| |_ ___ _ __ _ __   __ _| |
//  |  _| \ \/ / __/ _ \ '__| '_ \ / _` | |
//  | |___ >  <| ||  __/ |  | | | | (_| | |
//  |_____/_/\_\\__\___|_|  |_| |_|\__,_|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenProblemIsInExternalLibrary({ context, suggest }) {
  if (context.captured) return
  if (context?.externalLinks?.length) {
    const libs = new Set()
    context.externalLinks.forEach((link) => {
      const linkArr = link.split('node_modules/')[1].split('/')
      link = linkArr[0]
      if (link.startsWith('@')) {
        link += `/${linkArr[1]}`
      }
      libs.add(link)
    })
    const externalLibs = `'${Array.from(libs).join(', ')}'`
    suggest(
      `Problem is in an external library ${chalk.green(externalLibs)}. Ignore the error`,
      getNodeLink(context.errorNode),
      [
        '// eslint-disable-next-line @typescript-eslint/ban-ts-comment',
        `// @ts-expect-error: Fix required in ${externalLibs}`,
      ]
    )
    context.captured = false // TODO isVerbose
  }
}
