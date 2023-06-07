import chalk from 'chalk'
import { getNodeLink, typeToStringLike } from './utils'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _   _
//  | \ | | _____   _____ _ __
//  |  \| |/ _ \ \ / / _ \ '__|
//  | |\  |  __/\ V /  __/ |
//  |_| \_|\___| \_/ \___|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenNeverType({ suggest, problems, context, stack }) {
  if (context.captured) return
  const { checker } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (problems[0]?.sourceInfo.typeText === 'never[]' && context.targetDeclared) {
    suggest(
      `Declare the following type for ${chalk.green(context.targetDeclared.name.text)}`,
      getNodeLink(context.targetDeclared),
      [`${context.targetDeclared.name.text}: ${targetInfo.typeText}[]`]
    )
  } else if (problems[0]?.targetInfo.typeText.startsWith('never')) {
    suggest(`If the 'never' type was explicitly declared, determine what code path led to this point and fix it.`)
    suggest(
      `Otherwise the compiler wants you to declare the type of ${chalk.green(targetInfo.nodeText)} to ${chalk.green(
        typeToStringLike(checker, sourceInfo.type)
      )}`,
      context.targetDeclared ? getNodeLink(context.targetDeclared) : targetInfo.nodeLink
    )
  }
}
