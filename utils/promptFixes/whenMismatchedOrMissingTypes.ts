import chalk from 'chalk'
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
  const { errorType, functionName } = context

  const layer = stack[0]
  const { sourceInfo, targetInfo } = layer
  switch (true) {
    //
    // SIMPLE MISMATCH
    case errorType === ErrorType.mismatch: {
      // const suffix = functionName ? ` in function ${functionName}()` : ''
      // const source = chalk.green(sourceInfo.nodeText)
      // const target = chalk.green(targetInfo.nodeText)
      // addChoice = addChoice.bind(null, `Fix ${targetName} ${target} type !== ${sourceName} ${source} type${suffix}?`)
      // addChoice(`Convert ${sourceName} ${source} type`, [
      //   { primeInfo: sourceInfo, otherInfo: targetInfo, type: ReplacementType.convertType },
      // ])
      // addChoice(`Union ${targetName} ${target} type`, [
      //   { primeInfo: targetInfo, otherInfo: sourceInfo, type: ReplacementType.unionType },
      // ])
      // break
    }

    //
    // MAKES NO SENSE
    case errorType === ErrorType.simpleToObject:
      if (!functionName) {
        suggest(`Did you mean to use an object ${chalk.greenBright(sourceInfo.fullText)}`, sourceInfo.nodeLink)
      }
      break

    //
    // MAKES NO SENSE
    case errorType === ErrorType.objectToSimple:
      if (!functionName) {
        suggest(
          `Did you mean to assign just one property of ${chalk.greenBright(sourceInfo.fullText)}`,
          sourceInfo.nodeLink
        )
      }
      break

    //
    // PLACEHOLDER
    case sourceInfo.isPlaceholder: {
      const { targetMap, placeholderInfo } = context
      const targetKey = placeholderInfo.placeholderTarget ? placeholderInfo.placeholderTarget.key : sourceInfo.targetKey

      // mismatched type
      const placeholderTargetInfo = targetMap[targetKey]
      if (placeholderTargetInfo) {
        // const source = chalk.green(placeholderInfo.nodeText)
        // const target = chalk.green(placeholderTargetInfo.nodeText)
        // placeholderInfo.type = context.cache.getType(placeholderInfo.typeId)
        // placeholderTargetInfo.type = context.cache.getType(placeholderTargetInfo.typeId)
        // addChoice = addChoice.bind(null, `Fix ${targetName} ${target} type !== ${sourceName} ${source}?`)
        // addChoice(`Convert ${sourceName} ${source} type`, [
        //   { primeInfo: placeholderInfo, otherInfo: placeholderTargetInfo, type: ReplacementType.convertType },
        // ])
        // addChoice(`Union ${targetName} ${target} type`, [
        //   { primeInfo: placeholderTargetInfo, otherInfo: placeholderInfo, type: ReplacementType.unionType },
        // ])
      } else {
        const targetType = context.cache.getType(placeholderInfo.placeholderTarget.typeId)
        const declarations = targetType.getSymbol()?.getDeclarations()
        const declaration = declarations[0]
        const target = chalk.green(declaration.name ? declaration.name.escapedText : 'literal')
        targetInfo.declaredId = context.cache.saveNode(declaration)
        addChoice = addChoice.bind(null, `Fix missing property?`)
        if (errorType === ErrorType.missingIndex) {
          addChoice(`Add this index to ${target} map`, [
            { primeInfo: targetInfo, otherInfo: placeholderInfo, type: ReplacementType.insertProperty },
          ])
        } else {
          addChoice(`Add optional property to ${targetName} ${target} type`, [
            { primeInfo: targetInfo, otherInfo: placeholderInfo, type: ReplacementType.insertOptionalProperty },
          ])
        }
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
