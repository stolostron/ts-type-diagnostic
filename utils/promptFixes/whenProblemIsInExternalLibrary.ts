import chalk from 'chalk'
import { getNodeLink, getNodePos } from '../utils'
import { IPromptFix } from '../types'

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
export function whenProblemIsInExternalLibrary({ context, stack, promptFixes }) {
  if (context.captured) return
  if (context?.externalLinks?.length) {
    const promptFix: IPromptFix = {
      prompt: 'Fix this mismatch?',
      choices: [],
    }

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
    const comment = [
      '// eslint-disable-next-line @typescript-eslint/ban-ts-comment\n',
      `// @ts-expect-error: Fix required in ${externalLibs}\n`,
    ]

    const layer = stack[0]
    const { sourceInfo, targetInfo } = layer
    const beg = getNodePos(context, targetInfo.nodeId).beg
    promptFix.choices.push({
      description: `Disable the error with a comment. Problem is in an external library ${chalk.green(externalLibs)}.`,
      beg,
      end: beg,
      replace: comment.join(''),
    })
    promptFixes.push(promptFix)
    context.captured = true
  }
}
