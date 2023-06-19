import chalk from 'chalk'
import { isFunctionType } from '../utils'
import { ErrorType } from '../types'

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
  context.captured = context.errorType === ErrorType.tooManyArgs || context.errorType === ErrorType.tooFewArgs
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

  const { callingPairs } = context
  if (callingPairs && callingPairs.length > 1) {
    // see if arg types are mismatched
    const indexes: number[] = []
    if (
      // see if args are called in wrong order
      callingPairs.every(({ targetInfo }) => {
        if (targetInfo) {
          const targetTypeText = targetInfo.typeText
          return (
            callingPairs.findIndex(({ sourceInfo }, inx) => {
              if (sourceInfo) {
                const sourceTypeText = sourceInfo.typeText
                if (targetTypeText === sourceTypeText && !indexes.includes(inx + 1)) {
                  indexes.push(inx + 1)
                  return true
                }
              }
              return false
            }) !== -1
          )
        } else {
          return false
        }
      })
    ) {
      suggest(
        `Did you mean to call the arguments in this order ${chalk.greenBright(indexes.join(', '))}`,
        context.sourceLink
      )
      context.captured = true
    }
  }
}
