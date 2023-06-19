/* Copyright Contributors to the Open Cluster Management project */

import cloneDeep from 'lodash/cloneDeep'
import ts from 'typescript'
import { INodeInfo, IPlaceholderInfo, IShapeProblem, ITypeProblem, MatchType } from './types'
import {
  filterProblems,
  findParentExpression,
  getFullName,
  getPropText,
  getPropertyInfo,
  getTypeLink,
  isArrayType,
  isLikeTypes,
  isNeverType,
  isSimpleType,
  isStructuredType,
  mergeShapeProblems,
  typeToString,
} from './utils'
import { getNodeDeclaration } from './cacheFile'

//======================================================================
//======================================================================
//======================================================================
//   ____                                       _____
//  / ___|___  _ __ ___  _ __   __ _ _ __ ___  |_   _|   _ _ __   ___  ___
// | |   / _ \| '_ ` _ \| '_ \ / _` | '__/ _ \   | || | | | '_ \ / _ \/ __|
// | |__| (_) | | | | | | |_) | (_| | | |  __/   | || |_| | |_) |  __/\__ \
//  \____\___/|_| |_| |_| .__/ \__,_|_|  \___|   |_| \__, | .__/ \___||___/
//                      |_|                          |___/|_|
//======================================================================
//======================================================================
//======================================================================

// COMPARE TARGET TYPE WITH SOURCE TYPE
//   a) IF THE TYPES HAVE PROPERTIES, COMPARE THOSE PROPERTIES TOO
//   b) KEEP TRACK OF WHAT INNER TYPE WE'RE LOOKING AT ON A STACK

export function compareTypes(targetType, sourceType, stack, context, bothWays?: boolean) {
  const { checker } = context
  let typeProblem: ITypeProblem | undefined = undefined
  let shapeProblems: IShapeProblem[] = []
  let recurses: any[] = []
  const propertyTypes: any = []

  //======================================================================
  //================ [TARGET] = [SOURCE]  =================================
  //======================================================================
  // break out type arrays [targetType] = [sourceType]
  const sourceIsArray = isArrayType(checker, sourceType)
  const targetIsArray = isArrayType(checker, targetType)
  if (sourceIsArray || targetIsArray) {
    if (sourceIsArray === targetIsArray) {
      const sourceArr = sourceType.typeArguments
      const targetArr = targetType.typeArguments
      if (sourceArr.length === targetArr.length) {
        return sourceArr.every((source, inx) => {
          const target = targetArr[inx]
          return compareTypes(target, source, stack, context, bothWays)
        })
      }
    }
    //======================================================================
    //====== PROBLEM: ARRAY MISMATCH ================
    //======================================================================
    const sourceTypeText = typeToString(checker, sourceType)
    const targetTypeText = typeToString(checker, targetType)
    typeProblem = {
      sourceIsArray,
      targetIsArray,
      sourceInfo: { typeId: context.cache.saveType(sourceType), typeText: sourceTypeText },
      targetInfo: { typeId: context.cache.saveType(targetType), typeText: targetTypeText },
    }
    context.problems.push({ problems: [typeProblem], stack, context })
    return false
  } else {
    //======================================================================
    //=========== TARGET|TARGET|TARGET = SOURCE|SOURCE|SOURCE ===================
    //======================================================================
    const sources = sourceType.types || [sourceType]
    const targets = targetType.types || [targetType]
    if (
      // every SOURCE type must match at least one TARGET type
      !sources.every((source) => {
        return targets.some((target) => {
          //just need one TARGET to match
          // but it's got to be just one target type that matches
          const sourceTypeText = typeToString(checker, source)
          const targetTypeText = typeToString(checker, target)
          //======================================================================
          //=========== TYPES MATCH--DONE! ===================
          //======================================================================
          if (sourceTypeText === targetTypeText || sourceTypeText === 'any' || targetTypeText === 'any') {
            return true // stop here, DONE
            //===================================================================================
            //===== IF CALL ARGUMENT IS A LITERAL, PARAMETER JUST HAS TO BE LIKE THE ARGUMENT  =============
            //====================================================================================
          } else if (context.callMismatch && stack.length === 1 && isLikeTypes(source, target)) {
            return true // stop here, DONE
          } else if (
            //======================================================================
            //=========== TYPES ARE SHAPES--RECURSE! ===================
            //======================================================================
            sourceTypeText !== 'undefined' && // handle undefined separately
            targetTypeText !== 'undefined' &&
            isStructuredType(source) &&
            isStructuredType(target)
          ) {
            // On first pass, make sure all properties are shared and have the same type
            let s2tProblem: any | undefined = undefined
            let t2sProblem: any | undefined = undefined
            ;({ problem: s2tProblem, recurses } = compareTypeProperties(source, target, context))
            if (bothWays !== false) {
              // On second pass, make sure all properties are shared in the opposite direction
              // Unless strictFunctionType is set to false
              ;({ problem: t2sProblem } = compareTypeProperties(target, source, context))
            }
            // If no problems, but some types were shapes, recurse into those type shapes
            if (!s2tProblem && !t2sProblem) {
              if (recurses.length) {
                propertyTypes.push(recurses)
              }
              // return true because even though there might have been problems
              // and might be future problems between other types in this union
              // all we need is one match to take us to the next level
              shapeProblems = []
              return true
            } else {
              // consolidate the errors--mismatch will be the same, etc
              // but keep missing separate for each direction
              shapeProblems.push(mergeShapeProblems(s2tProblem, t2sProblem))
            }
          } else {
            //======================================================================
            //===== PROBLEM: TYPES ARE MISMATCHED  ============================
            //======================================================================
            // RECORD PROBLEM BUT KEEP TRYING IF THERE ARE OTHER TARGET UNION TYPES
            typeProblem = {
              sourceInfo: { typeId: context.cache.saveType(source), typeText: sourceTypeText },
              targetInfo: { typeId: context.cache.saveType(target), typeText: targetTypeText },
            }
          }
          return false // keep looking for a union type match
        })
      })
    ) {
      //======================================================================
      //========= PROBLEM: NO MATCHING TARGET TYPE ========================
      //======================================================================
      // IF WE GOT HERE, SOURCE COULDN'T FIND ANY MATCHING TARGET TYPE
      const problems = filterProblems(typeProblem, shapeProblems)
      context.problems.push({ problems, stack, context })
      return false
    }
    //======================================================================
    //========= KEEP RECURSING TO FIND CONFLICT ========================
    //======================================================================
    // IF WE GOT HERE NO CONFLICTS FOUND YET,
    // SEE IF THERE ARE PROPERTY TYPES TO RECURSE INTO
    if (propertyTypes.length) {
      return propertyTypes.every((recurses) => {
        return recurses.every(({ targetType, sourceType, branch }) => {
          // KEEP A SEPARATE STACK FOR EVERY TYPE WE RECURSE INTO
          // SO WE CAN DISPLAY HOW WE GOT TO AN INNER CONFLICT
          const clonedStack = cloneDeep(stack)
          clonedStack.push({
            ...branch,
          })
          return compareTypes(targetType, sourceType, clonedStack, context, bothWays)
        })
      })
    }
  }
  return true
}

//======================================================================
//======================================================================
//======================================================================
//   ____                                       ____                            _   _
//  / ___|___  _ __ ___  _ __   __ _ _ __ ___  |  _ \ _ __ ___  _ __   ___ _ __| |_(_) ___  ___
// | |   / _ \| '_ ` _ \| '_ \ / _` | '__/ _ \ | |_) | '__/ _ \| '_ \ / _ \ '__| __| |/ _ \/ __|
// | |__| (_) | | | | | | |_) | (_| | | |  __/ |  __/| | | (_) | |_) |  __/ |  | |_| |  __/\__ \
//  \____\___/|_| |_| |_| .__/ \__,_|_|  \___| |_|   |_|  \___/| .__/ \___|_|   \__|_|\___||___/
//                      |_|                                    |_|
//======================================================================
//======================================================================
//======================================================================
function compareTypeProperties(firstType, secondType, context) {
  const { checker } = context
  const matched: string[] = []
  const mismatch: string[] = []
  const misslike: string[] = [] //mismatch but like each other ("literal" is a string)
  const missing: string[] = []
  const optional: string[] = [] // missing but optional
  const unchecked: string[] = []
  const recurses: any = []
  const sourceTypeText = typeToString(checker, firstType)
  const targetTypeText = typeToString(checker, secondType)
  const properties = firstType.getProperties()
  properties.forEach((firstProp) => {
    firstProp = firstProp?.syntheticOrigin || firstProp
    const propName = firstProp.escapedName as string
    const secondProp = checker.getPropertyOfType(secondType, propName)
    //======================================================================
    //========= MAKE SURE TARGET AND SOURCE HAVE THE SAME PROPERTY ========================
    //======================================================================
    if (secondProp) {
      const firstPropType = checker.getTypeOfSymbol(firstProp)
      const secondPropType = checker.getTypeOfSymbol(secondProp)
      switch (simpleTypeComparision(checker, firstPropType, secondPropType)) {
        default:
        case MatchType.mismatch:
        case MatchType.bigley:
        case MatchType.never:
          if (getPropText(firstProp) === getPropText(secondProp)) {
            misslike.push(propName)
          } else {
            mismatch.push(propName)
          }
          break
        case MatchType.recurse:
          // else recurse the complex types of these properties
          unchecked.push(propName)
          recurses.push({
            targetType: secondPropType,
            sourceType: firstPropType,
            branch: {
              sourceInfo: getPropertyInfo(firstProp, context, firstPropType),
              targetInfo: getPropertyInfo(secondProp, context, secondPropType),
            },
          })
          break
        case MatchType.match:
          matched.push(propName)
          break
      }
    } else if (firstProp.flags & ts.SymbolFlags.Optional) {
      optional.push(propName)
    } else {
      missing.push(propName)
    }
  })

  let problem: IShapeProblem | undefined = undefined
  if (mismatch.length !== 0 || missing.length !== 0 || misslike.length !== 0) {
    problem = {
      matched,
      mismatch,
      missing,
      misslike,
      optional,
      unchecked,
      overlap: matched.length + unchecked.length,
      total: properties.length,
      sourceInfo: {
        typeId: context.cache.saveType(firstType),
        typeText: sourceTypeText,
      },
      targetInfo: {
        typeId: context.cache.saveType(secondType),
        typeText: targetTypeText,
      },
      isShapeProblem: true,
    }
  }
  return { problem, recurses }
}

//======================================================================
//======================================================================
//======================================================================
//  ____  _                 _         ____
// / ___|(_)_ __ ___  _ __ | | ___   / ___|___  _ __ ___  _ __   __ _ _ __ ___
// \___ \| | '_ ` _ \| '_ \| |/ _ \ | |   / _ \| '_ ` _ \| '_ \ / _` | '__/ _ \
//  ___) | | | | | | | |_) | |  __/ | |__| (_) | | | | | | |_) | (_| | | |  __/
// |____/|_|_| |_| |_| .__/|_|\___|  \____\___/|_| |_| |_| .__/ \__,_|_|  \___|
//                   |_|                                 |_|
//======================================================================
//======================================================================
//======================================================================

// a type compare without recursing into shapes
export const simpleTypeComparision = (checker, firstType: ts.Type, secondType) => {
  const firstPropTypeText = typeToString(checker, firstType)
  const secondPropTypeText = typeToString(checker, secondType)
  if (
    firstPropTypeText !== secondPropTypeText &&
    firstPropTypeText !== 'any' &&
    secondPropTypeText !== 'any' &&
    !simpleUnionPropTypeMatch(checker, firstType, secondType)
  ) {
    if (isSimpleType(firstType) && isSimpleType(secondType)) {
      return MatchType.mismatch
    } else if (isSimpleType(firstType) || isSimpleType(secondType)) {
      return MatchType.bigley
    } else if (isNeverType(firstType) || isNeverType(secondType)) {
      return MatchType.never
    } else {
      return MatchType.recurse
    }
  }
  return MatchType.match
}

// if one side is 'string' and the other side is 'number | string | boolean' is a match
const simpleUnionPropTypeMatch = (checker, firstPropType, secondPropType) => {
  if (firstPropType.types || secondPropType.types) {
    let firstPropArr = (firstPropType.types || [firstPropType])
      .filter((type) => isSimpleType(type))
      .map((type) => typeToString(checker, type))
    let secondPropArr = (secondPropType.types || [secondPropType])
      .filter((type) => isSimpleType(type))
      .map((type) => typeToString(checker, type))
    if (firstPropArr.length > secondPropArr.length) [secondPropArr, firstPropArr] = [firstPropArr, secondPropArr]
    return secondPropArr.some((type) => {
      return firstPropArr.includes(type)
    })
  }
  return false
}

//======================================================================
//======================================================================
//======================================================================
//   ____  _                _           _     _              ____
//  |  _ \| | __ _  ___ ___| |__   ___ | | __| | ___ _ __   / ___|___  _ __ ___  _ __   __ _ _ __ ___
//  | |_) | |/ _` |/ __/ _ \ '_ \ / _ \| |/ _` |/ _ \ '__| | |   / _ \| '_ ` _ \| '_ \ / _` | '__/ _ \
//  |  __/| | (_| | (_|  __/ | | | (_) | | (_| |  __/ |    | |__| (_) | | | | | | |_) | (_| | | |  __/
//  |_|   |_|\__,_|\___\___|_| |_|\___/|_|\__,_|\___|_|     \____\___/|_| |_| |_| .__/ \__,_|_|  \___|
//======================================================================
//======================================================================
//======================================================================

// when the source doesn't exist but we need something to compare target with
export function compareWithPlaceholder(targetInfo, placeholderInfo, context) {
  let stack: { sourceInfo: any; targetInfo: any }[]
  if (context.targetNode.kind === ts.SyntaxKind.PropertyAccessExpression) {
    stack = getPlaceholderStack(targetInfo, placeholderInfo, context)
  } else {
    stack = [
      {
        sourceInfo: {
          isPlaceholder: true,
        },
        targetInfo,
      },
    ]
  }
  context.placeholderInfo = context.placeholderInfo || placeholderInfo
  context.targetLink = stack[0].targetInfo.nodeLink

  const problems = [
    {
      sourceInfo: placeholderInfo,
      targetInfo,
    },
  ]
  return { problems, stack }
}

// pad the stack so that inner properties line up
export function getPlaceholderStack(targetInfo, sourceInfo, context) {
  const { checker } = context
  const targetNode = context.targetNode
  let targetDeclared = getNodeDeclaration(targetNode, context)
  let stack: { targetInfo: INodeInfo; sourceInfo: INodeInfo | IPlaceholderInfo }[] = []
  let nodeText = targetNode.getText()
  let path = nodeText.split(/\W+/)
  if (path.length > 1) {
    // fix layer top
    path = path.reverse()
    let propName = (nodeText = path.shift())

    // 0 = c of a.b.c, now do a.b
    let node: ts.Node = targetNode
    let expression = targetDeclared
    do {
      // get b, then a's type
      expression = findParentExpression(expression)
      let type = checker.getTypeAtLocation(expression)
      const types = type['types'] || [type]
      types.some((t: ts.Type) => {
        const declarations = t.getProperty(propName)?.declarations
        if (Array.isArray(declarations)) {
          node = declarations[0]
          type = t
          return true
        }
        return false
      })

      // when comparing with a real variable on source side
      // remember what target key to compare against
      if (!context.placeholderInfo) {
        context.placeholderInfo = {
          ...sourceInfo,
          placeholderTarget: {
            key: sourceInfo.targetKey || nodeText,
            typeId: context.cache.saveType(type),
          },
        }
      }

      // add filler layer
      nodeText = path.shift()
      const typeText = typeToString(checker, type)
      stack.push({
        sourceInfo: {
          isPlaceholder: true,
        },
        targetInfo: {
          nodeText,
          typeText,
          typeId: context.cache.saveType(type),
          declaredId: context.cache.saveNode(node),
          fullText: getFullName(nodeText, typeText),
          nodeLink: getTypeLink(type),
        },
      })
      propName = nodeText
    } while (path.length)

    stack = stack.reverse()
    return stack
  } else {
    if (sourceInfo.targetKey) {
      context.placeholderInfo = {
        ...sourceInfo,
        placeholderTarget: {
          key: sourceInfo.targetKey || nodeText,
          typeId: targetInfo.typeId,
        },
      }
    }
    return [{ sourceInfo, targetInfo }]
  }
}
