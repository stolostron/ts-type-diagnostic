import chalk from 'chalk'
import { ErrorType } from '../types'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//      _
//     / \   _ __ _ __ __ _ _   _
//    / _ \ | '__| '__/ _` | | | |
//   / ___ \| |  | | | (_| | |_| |
//  /_/   \_\_|  |_|  \__,_|\__, |
//                          |___/
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenArraysDontMatch({ stack, suggest, context }) {
  if (context.captured) return
  context.captured = context.errorType === ErrorType.nonArrayToArray || context.errorType === ErrorType.arrayToNonArray
  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  switch (context.errorType) {
    case ErrorType.arrayToNonArray:
      suggest(
        `Did you mean to assign just one element of the ${chalk.greenBright(sourceInfo.nodeText)} array`,
        sourceInfo.nodeLink
      )
      break
    case ErrorType.nonArrayToArray:
      suggest(
        `Did you mean to push ${chalk.greenBright(sourceInfo.nodeText)} onto the ${chalk.greenBright(
          targetInfo.nodeText
        )} array`,
        targetInfo.nodeLink
      )
      break
  }
}
