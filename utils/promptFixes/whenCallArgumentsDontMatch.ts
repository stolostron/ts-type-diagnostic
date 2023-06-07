import chalk from 'chalk'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//      _                                         _
//     / \   _ __ __ _ _   _ _ __ ___   ___ _ __ | |_ ___
//    / _ \ | '__/ _` | | | | '_ ` _ \ / _ \ '_ \| __/ __|
//   / ___ \| | | (_| | |_| | | | | | |  __/ | | | |_\__ \
//  /_/   \_\_|  \__, |\__,_|_| |_| |_|\___|_| |_|\__|___/
//               |___/
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenCallArgumentsDontMatch({ context, suggest }) {
  if (context.captured) return
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
