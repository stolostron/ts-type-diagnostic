import chalk from 'chalk'
import { isStructuredType, isFunctionType } from '../utils'
import { ErrorType, ReplacementType } from '../types'

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _____
//  |_   _|   _ _ __   ___  ___
//    | || | | | '_ \ / _ \/ __|
//    | || |_| | |_) |  __/\__ \
//    |_| \__, | .__/ \___||___/
//        |___/|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
export function whenMismatchedOrMissingTypes({ problems, stack, context, suggest, addChoice, sourceName, targetName }) {
  if (context.captured || !problems.length) return
  const { errorType, checker, cache, functionName } = context

  const layer = stack[0]
  const { sourceInfo, targetInfo } = layer
  switch (true) {
    //
    // SIMPLE MISMATCH
    case errorType === ErrorType.mismatch: {
      const suffix = functionName ? ` in function ${functionName}()` : ''
      const source = chalk.green(sourceInfo.nodeText)
      const target = chalk.green(targetInfo.nodeText)
      addChoice = addChoice.bind(null, `Fix ${targetName} ${target} type !== ${sourceName} ${source} type${suffix}?`)
      addChoice(`Convert ${sourceName} ${source} type`, [
        { primeInfo: sourceInfo, otherInfo: targetInfo, type: ReplacementType.convertType },
      ])
      addChoice(`Union ${targetName} ${target} type`, [
        { primeInfo: targetInfo, otherInfo: sourceInfo, type: ReplacementType.unionType },
      ])
      break
    }

    //
    // MAKES NO SENSE
    case errorType === ErrorType.simpleToObject:
      if (!functionName) {
        console.log('Assigning a single variable to an object makes no sense')
      }
      break

    //
    // MAKES NO SENSE
    case errorType === ErrorType.objectToSimple:
      if (!functionName) {
        suggest(
          `Did you mean to assign just one property of the ${chalk.greenBright(sourceInfo.fullText)} object`,
          sourceInfo.nodeLink
        )
      }
      break

    //
    // PLACEHOLDER
    case sourceInfo.isPlaceholder: {
      const { targetMap, placeholderInfo } = context
      const targetKey = placeholderInfo.placeholderTarget.key
      const targetType = context.cache.getType(placeholderInfo.placeholderTarget.typeId)
      const declarations = targetType.getSymbol()?.getDeclarations()
      const skdf = declarations[0].getText()
      const d = declarations[0].getChildren()
      //   missingIndex = 12,

      const ti = targetMap[targetKey]
      if (ti) {
        const r = 0
      } else {
        const f = 0
      }
      break
    }

    //
    // PROPERTY MISMATCH
    case errorType === ErrorType.propMismatch:
      break

    //
    // MISSING PROPERTY
    case errorType === ErrorType.sourcePropMissing ||
      errorType === ErrorType.targetPropMissing ||
      errorType === ErrorType.bothMissing:
      break

    //
    // MISSING AND MISMATCHED PROPERTY
    case errorType === ErrorType.both:
      break

    //  errorType === ErrorType.misslike
    // errorType === ErrorType.mustDeclare
  }

  // // const layer = stack[0]
  // // const { sourceInfo, targetInfo } = layer
  // targetInfo.type = cache.getType(targetInfo?.typeId)
  // if (!isStructuredType(targetInfo.type) && !isFunctionType(checker, targetInfo.type)) return

  // // if source is a place holder, we're just updating the target type
  // if (sourceInfo.isPlaceholder) {
  //   const { targetMap, placeholderInfo } = context
  //   const targetKey = placeholderInfo.placeholderTarget.key
  //   const targetType = context.cache.getType(placeholderInfo.placeholderTarget.typeId)
  //   const declarations = targetType.getSymbol()?.getDeclarations()
  //   const skdf = declarations[0].getText()
  //   const d = declarations[0].getChildren()

  //   const ti = targetMap[targetKey]
  //   if (ti) {
  //     const r = 0
  //   } else {
  //     const f = 0
  //   }

  //   // const targetType = context.cache.getType(problem.targetInfo.typeId)
  //   // const declarationz = targetType.getSymbol()?.getDeclarations()
  //   // if (!declarationz || declarationz.length === 0) {
  //   //   const df = 0
  //   // }
  //   // const skdf = declarationz[0].getText()
  // } else {
  //   sourceInfo.type = cache.getType(sourceInfo?.typeId)
  //   if (isStructuredType(sourceInfo.type)) {
  //     const declarations = sourceInfo.type.getSymbol()?.getDeclarations()

  //     const sdf = declarations[0].getText()
  //     const g = 0
  //   }
  // }

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
