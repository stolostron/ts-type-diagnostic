import chalk from 'chalk'
import { isStructuredType } from '../utils'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   ____  _
//  / ___|| |__   __ _ _ __   ___
//  \___ \| '_ \ / _` | '_ \ / _ \
//   ___) | | | | (_| | |_) |  __/
//  |____/|_| |_|\__,_| .__/ \___|
//                    |_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenTypeShapesDontMatch(context) {
  if (context.captured) return
  const layer = context.stack[context.stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (!isStructuredType(sourceInfo.type) && !isStructuredType(targetInfo.type)) return

  // some shape suggestions
  didYouMeanThisChildProperty(context)
  suggestPartialInterfaces(context)
}
// ===============================================================================
// when you use 'resource', but you should 'resource.resource' instead %-)
// ===============================================================================
function didYouMeanThisChildProperty({ suggest, context, stack }) {
  if (context.sourceMap) {
    const layer = stack[stack.length - 1]
    const { sourceInfo, targetInfo } = layer
    const match: any = Object.values(context.sourceMap).find((source: any) => {
      return !source.isFunc && source.typeText === targetInfo.typeText
    })
    if (match) {
      suggest(
        `Did you mean to use this ${chalk.magenta(
          `${sourceInfo.nodeText}.${match.nodeText}`
        )} instead of this ${chalk.magenta(sourceInfo.nodeText)}`,
        targetInfo.nodeLink
      )
    }
  }
}
// ===============================================================================
// when one side is has lots of required properties
// ===============================================================================
function suggestPartialInterfaces({ suggest, context }) {
  const partialInterfaces: any[] = []
  if (Object.keys(context?.missingInterfaceMaps?.sourceInterfaceMap || {}).length > 0) {
    Object.values(context.missingInterfaceMaps.sourceInterfaceMap).forEach((inter: any) => {
      const altParentInfo = inter[0].altParentInfo
      if (altParentInfo) {
        partialInterfaces.push(altParentInfo)
      }
    })
  }
  if (partialInterfaces.length) {
    partialInterfaces.forEach((altParentInfo) => {
      suggest(
        `Make the missing properties optional using ${chalk.greenBright(
          `interface Partial<${altParentInfo.typeText}>`
        )}`,
        altParentInfo.nodeLink
      )
    })
  }
}
