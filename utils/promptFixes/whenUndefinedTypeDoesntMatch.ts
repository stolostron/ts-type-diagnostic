import chalk from 'chalk'
import { getNodeLink, typeToStringLike } from './utils'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _   _           _       __ _                _
//  | | | |_ __   __| | ___ / _(_)_ __   ___  __| |
//  | | | | '_ \ / _` |/ _ \ |_| | '_ \ / _ \/ _` |
//  | |_| | | | | (_| |  __/  _| | | | |  __/ (_| |
//   \___/|_| |_|\__,_|\___|_| |_|_| |_|\___|\__,_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenUndefinedTypeDoesntMatch({ problems, stack, context, suggest }) {
  if (context.captured) return
  const { checker } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (problems[0]?.targetInfo.typeText === 'undefined') {
    suggest(
      `Change the type of ${chalk.green(targetInfo.nodeText)} to ${chalk.green(
        typeToStringLike(checker, sourceInfo.type)
      )}`,
      context.targetDeclared ? getNodeLink(context.targetDeclared) : targetInfo.nodeLink
    )
  } else if (problems[0]?.sourceInfo.typeText === 'undefined') {
    suggest(
      `Union ${targetInfo.nodeText} type with ${chalk.green('| undefined')}`,
      context.targetDeclared ? getNodeLink(context.targetDeclared) : targetInfo.nodeLink,
      [`${chalk.greenBright(`${targetInfo.typeText} | undefined`)}`]
    )
  }
}
