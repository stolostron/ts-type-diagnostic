import chalk from 'chalk'
import { isFunctionType } from '../utils'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   ____            _        _
//  |  _ \ _ __ ___ | |_ ___ | |_ _   _ _ __   ___  ___
//  | |_) | '__/ _ \| __/ _ \| __| | | | '_ \ / _ \/ __|
//  |  __/| | | (_) | || (_) | |_| |_| | |_) |  __/\__ \
//  |_|   |_|  \___/ \__\___/ \__|\__, | .__/ \___||___/
//                                |___/|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenPrototypesDontMatch({ suggest, context, stack }) {
  if (context.captured) return
  const { checker } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (sourceInfo.isPlaceholder) return
  const isTargetFunction = isFunctionType(checker, targetInfo.type)
  const isSourceFunction = isFunctionType(checker, sourceInfo.type)
  if (isTargetFunction || isSourceFunction) {
    if (isTargetFunction === isSourceFunction) {
      // DOESN'T DO MISMATCHED PROTOTYPES YET
    } else if (isTargetFunction) {
      if (context.callMismatch) {
        suggest('Your calling arguments might be out of order', sourceInfo.nodeLink)
        suggest(
          `Otherwise argument ${chalk.greenBright(context.errorIndex + 1)} must have a function type`,
          targetInfo.nodeLink,
          `${targetInfo.typeText}`
        )
      }
    } else {
      suggest(
        `Did you mean to call the ${chalk.greenBright(`${sourceInfo.name} ( )`)} function first`,
        sourceInfo.nodeLink
      )
      suggest(
        `Otherwise ${chalk.greenBright(targetInfo.name)} must have a function type`,
        targetInfo.nodeLink,
        `${targetInfo.name}: ${sourceInfo.typeText}`
      )
    }
  }
}
