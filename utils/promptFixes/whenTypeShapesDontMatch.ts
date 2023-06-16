import chalk from 'chalk'
import { isStructuredType, isFunctionType } from '../utils'

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
export function whenTypeShapesDontMatch({ problems, stack, context, addChoice, sourceName, targetName }) {
  if (context.captured || !problems.length) return
  const { checker, cache, sourceMap, targetMap } = context
  const layer = stack[0]
  const { sourceInfo, targetInfo } = layer
  targetInfo.type = cache.getType(targetInfo?.typeId)
  if (!isStructuredType(targetInfo.type) && !isFunctionType(checker, targetInfo.type)) return
  const declarationz = targetInfo.type.getSymbol()?.getDeclarations()

  if (sourceInfo.isPlaceholder) {
    const r = 0
  } else {
    sourceInfo.type = cache.getType(sourceInfo?.typeId)
    if (isStructuredType(sourceInfo.type)) {
      const declarations = sourceInfo.type.getSymbol()?.getDeclarations()

      const sdf = declarations[0].getText()
      const problem = problems[0]
      const g = 0
    }
  }

  // addChoice(sourceInfo, targetInfo, (outputNode: ts.Node) => {
  //   return {
  //     description: `Convert type of ${sourceName} '${source}' to 'number' by removing quotes from ${source}`,
  //     replace: `${sourceInfo.nodeText.replace(/['"]+/g, '')}`,
  //     beg: outputNode.getStart(),
  //     end: outputNode.getEnd(),
  //   }
  // })
}
// ===============================================================================
// when you use 'resource', but you should 'resource.resource' instead %-)
// ===============================================================================

// // some shape suggestions
// didYouMeanThisChildProperty(context)
// suggestPartialInterfaces(context)

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
