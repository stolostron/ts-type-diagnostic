/* Copyright Contributors to the Open Cluster Management project */

import ts from 'typescript'

import {
  getFullName,
  getNodeDeclaration,
  getNodeLink,
  getText,
  getTypeLink,
  isArrayType,
  isFunctionLikeKind,
  isStructuredType,
  typeToString,
  typeToStringLike,
} from './utils'
import { compareTypes, compareWithPlaceholder, getPlaceholderStack } from './compareUtils'

//======================================================================
//======================================================================
//======================================================================
//   _____ _           _   ____            _     _
//  |  ___(_)_ __   __| | |  _ \ _ __ ___ | |__ | | ___ _ __ ___  ___
//  | |_  | | '_ \ / _` | | |_) | '__/ _ \| '_ \| |/ _ \ '_ ` _ \/ __|
//  |  _| | | | | | (_| | |  __/| | | (_) | |_) | |  __/ | | | | \__ \
//  |_|   |_|_| |_|\__,_| |_|   |_|  \___/|_.__/|_|\___|_| |_| |_|___/

//======================================================================
//======================================================================
//======================================================================
// ERROR JUST SAYS THERE'S A CONFLICT, BUT NOT WHAT TYPES ARE IN CONFLICT
export function findProblems(programContext, code, errorNode: ts.Node, node: ts.Node, nodeId, cache) {
  const context: {
    code: any
    node: ts.Node
    nodeId: number
    errorNode?: ts.Node
    arrayItems?: ts.Node[]
    cache: any
    sourceDeclared?: ts.Node
    targetDeclared?: ts.Node
    problems: { problems: any[]; stack: any[]; context: any }[]
  } = {
    ...programContext,
    code,
    node,
    nodeId,
    errorNode,
    cache,
    problems: [],
  }

  let children = node.getChildren()
  switch (node.kind) {
    //======================================================================
    //================= FUNCTION RETURN  ==========================
    //======================================================================
    case ts.SyntaxKind.ReturnStatement:
      findReturnStatementTargetAndSourceToCompare(node, undefined, context)
      break

    //======================================================================
    //===============  FUNCTION CALL ======================================
    //======================================================================
    case ts.SyntaxKind.CallExpression: {
      // if the function is a property of an object, where is that object defined
      if (children[0].kind === ts.SyntaxKind.PropertyAccessExpression) {
        const objectName = children[0].getFirstToken()
        if (objectName) {
          context.targetDeclared = getNodeDeclaration(objectName, cache)
        }
      }
      findFunctionCallTargetAndSourceToCompare(node, errorNode, context)
      break
    }
    //======================================================================
    //=========== PROPERTY ACCESS (object.property)  =================================
    //======================================================================
    case ts.SyntaxKind.PropertyAccessExpression: {
      const sourceNode = children[children.length - 1]
      const targetNode = children[0]
      createPropertyAccessTargetAndSourceToCompare(targetNode, sourceNode, context)
      break
    }
    //======================================================================
    //=========== DECLARATION  =================================
    //======================================================================
    case ts.SyntaxKind.VariableDeclaration: {
      const sourceNode = children[children.length - 1]
      const targetNode = children[0]
      findAssignmentTargetAndSourceToCompare(targetNode, sourceNode, context)
      break
    }
    //======================================================================
    //============== ASSIGNMENT  =================================
    //======================================================================
    case ts.SyntaxKind.ExpressionStatement: {
      // get the whole expression (left = right)
      const statement = node as ts.ExpressionStatement
      children = statement.expression.getChildren()
      const target = children[0]
      const source = children[2]
      if (source && target) {
        findAssignmentTargetAndSourceToCompare(target, source, context)
      }
      break
    }
    default:
      console.log(`For error ${code}, missing support for kind === ${node.kind}`)
      console.log(getNodeLink(node))
      break
  }
  return context.problems
}

//======================================================================
//======================================================================
//======================================================================
//   ____                            _              _
//  |  _ \ _ __ ___  _ __   ___ _ __| |_ _   _     / \   ___ ___ ___  ___ ___
//  | |_) | '__/ _ \| '_ \ / _ \ '__| __| | | |   / _ \ / __/ __/ _ \/ __/ __|
//  |  __/| | | (_) | |_) |  __/ |  | |_| |_| |  / ___ \ (_| (_|  __/\__ \__ \
//  |_|   |_|  \___/| .__/ \___|_|   \__|\__, | /_/   \_\___\___\___||___/___/
//                  |_|                  |___/
//======================================================================
//======================================================================
//======================================================================
// when a.b.c = 4 but c doesn't exist yet
function createPropertyAccessTargetAndSourceToCompare(targetNode: ts.Node, sourceNode: ts.Node, context) {
  const { checker } = context
  const targetType: ts.Type = checker.getTypeAtLocation(targetNode)
  const targetTypeText = typeToString(checker, targetType)
  const targetInfo = {
    nodeText: getText(targetNode),
    typeText: targetTypeText,
    typeId: context.cache.saveType(targetType),
    fullText: getFullName(targetNode, targetTypeText),
    nodeLink: getNodeLink(targetNode),
  }

  // try to get the type of the accessor using the original expression (a = b)
  let typeText = 'unknown'
  const expression = ts.findAncestor(context.errorNode, (node) => {
    return !!node && node.kind === ts.SyntaxKind.ExpressionStatement
  })
  if (expression) {
    const statement = expression as ts.ExpressionStatement
    const children = statement.expression.getChildren()
    typeText = typeToStringLike(checker, checker.getTypeAtLocation(children[2]))
  }

  const nodeText = getText(sourceNode)
  const placeholderInfo = {
    nodeText,
    typeText,
    nodeLink: getNodeLink(sourceNode),
    node: sourceNode,
    fullText: getFullName(nodeText, typeText),
    placeholderTargetKey: nodeText, //will be missing in target but that's the point
  }

  context = {
    ...context,
    prefix: 'The object',
    sourceNode,
    targetNode,
    sourceLink: placeholderInfo.nodeLink,
    targetLink: targetInfo.nodeLink,
    targetDeclared: getNodeDeclaration(targetNode, context.cache),
    targetTitle: 'Object',
    sourceTitle: 'Property',
    missingAccess: true,
    hadPayoff: true,
  }
  const { problems, stack } = compareWithPlaceholder(targetInfo, placeholderInfo, context)

  context.problems.push({ problems, stack, context })
}

//======================================================================
//======================================================================
//======================================================================
//     _            _                                  _
//    / \   ___ ___(_) __ _ _ __  _ __ ___   ___ _ __ | |_
//   / _ \ / __/ __| |/ _` | '_ \| '_ ` _ \ / _ \ '_ \| __|
//  / ___ \\__ \__ \ | (_| | | | | | | | | |  __/ | | | |_
// /_/   \_\___/___/_|\__, |_| |_|_| |_| |_|\___|_| |_|\__|
//                    |___/
//======================================================================
//======================================================================
//======================================================================

function findAssignmentTargetAndSourceToCompare(targetNode: ts.Node, sourceNode: ts.Node, context) {
  const { checker } = context
  const targetType: ts.Type = checker.getTypeAtLocation(targetNode)
  const targetTypeText = typeToString(checker, targetType)
  const targetInfo = {
    nodeText: getText(targetNode),
    typeText: targetTypeText,
    typeId: context.cache.saveType(targetType),
    fullText: getFullName(targetNode, targetTypeText),
    nodeLink: getNodeLink(targetNode),
  }
  let sourceType: ts.Type = checker.getTypeAtLocation(sourceNode)

  //======================================================================
  //===============  ASSIGN ARRAY ==========================
  //======================================================================
  // a = [b]
  const arrayItems = context.cache.arrayItemsToTarget[targetNode.getStart()]
  if (arrayItems && isArrayType(checker, targetType)) {
    return findArrayItemTargetAndSourceToCompare(arrayItems, targetType, targetInfo, context)

    //======================================================================
    //===============  ASSIGN FUNCTION RETURN ==========================
    //======================================================================
  } else if (isFunctionLikeKind(sourceNode.kind)) {
    // a = b()
    // if function, need to make sure each type returned can be assigned to target
    const returns = context.cache.containerToReturns[sourceNode.getStart()]
    if (returns) {
      let hadPayoff = false
      returns.forEach((rn) => {
        if (hadPayoff) {
          console.log('\n\n')
        }
        hadPayoff = findReturnStatementTargetAndSourceToCompare(rn, targetType, context)
      })
      return hadPayoff
    } else {
      //======================================================================
      //===============   ASSIGN LITERAL ==========================
      //======================================================================
      // a = '123'
      let children = sourceNode.getChildren()
      sourceNode = children[children.length - 1]
      if (sourceNode.kind === ts.SyntaxKind.CallExpression) {
        children = sourceNode.getChildren()
        sourceType = checker.getSignaturesOfType(checker.getTypeAtLocation(children[0]), 0)[0].getReturnType()
      } else {
        sourceType = checker.getTypeAtLocation(sourceNode)
      }
    }
  } else if (sourceNode.kind === ts.SyntaxKind.ElementAccessExpression) {
    // when map[key] but compiler can't infer an index
    const children = sourceNode.getChildren()
    const mapType = checker.getTypeAtLocation(children[0])
    const indexTypeText = typeToStringLike(checker, checker.getTypeAtLocation(children[2]))
    if (
      !checker.getIndexInfosOfType(mapType).some(({ keyType }) => {
        return typeToStringLike(checker, keyType) === indexTypeText
      })
    ) {
      const targetType: ts.Type = mapType
      const targetTypeText = typeToString(checker, targetType)
      const targetInfo = {
        nodeText: targetTypeText,
        typeText: targetTypeText,
        typeId: context.cache.saveType(targetType),
        fullText: getFullName(targetTypeText, targetTypeText),
        nodeLink: getTypeLink(targetType),
      }

      // ex: [key: string]: string
      const nodeText = `[key: ${indexTypeText}]`
      const typeText = 'any'
      const placeholderInfo = {
        nodeText,
        typeText,
        nodeLink: getNodeLink(sourceNode),
        node: sourceNode,
        fullText: getFullName(nodeText, typeText),
        placeholderTargetKey: nodeText, //will be missing in target but that's the point
      }

      context = {
        ...context,
        sourceNode,
        targetNode,
        targetDeclared: getNodeDeclaration(targetNode, context.cache),
        sourceLink: placeholderInfo.nodeLink,
        targetLink: targetInfo.nodeLink,
        targetTitle: 'Map',
        sourceTitle: 'Index',
        missingIndex: true,
        hadPayoff: true,
      }

      const { problems, stack } = compareWithPlaceholder(targetInfo, placeholderInfo, context)

      context.problems.push({ problems, stack, context })
    }
  }

  const sourceTypeText = typeToString(checker, sourceType)
  const sourceInfo = {
    nodeText: getText(sourceNode),
    typeText: sourceTypeText,
    typeId: context.cache.saveType(sourceType),
    fullText: getFullName(sourceNode, sourceTypeText),
    nodeLink: getNodeLink(sourceNode),
  }

  // individual array items mismatch the target
  const pathContext = {
    ...context,
    prefix: isStructuredType(targetType) || isStructuredType(sourceType) ? 'Object' : 'One side',
    sourceNode,
    targetNode,
    sourceLink: getNodeLink(sourceNode),
    targetLink: getNodeLink(targetNode),
    targetDeclared: getNodeDeclaration(targetNode, context.cache),
    hadPayoff: false,
  }
  compareTypes(targetType, sourceType, getPlaceholderStack(targetInfo, sourceInfo, pathContext), pathContext)

  return pathContext.hadPayoff
}

//======================================================================
//======================================================================
//======================================================================
//  _____                 _   _               ____      _
// |  ___|   _ _ __   ___| |_(_) ___  _ __   |  _ \ ___| |_ _   _ _ __ _ __
// | |_ | | | | '_ \ / __| __| |/ _ \| '_ \  | |_) / _ \ __| | | | '__| '_ \
// |  _|| |_| | | | | (__| |_| | (_) | | | | |  _ <  __/ |_| |_| | |  | | | |
// |_|   \__,_|_| |_|\___|\__|_|\___/|_| |_| |_| \_\___|\__|\__,_|_|  |_| |_|
//======================================================================
//======================================================================
//======================================================================

function findReturnStatementTargetAndSourceToCompare(node: ts.Node, containerType: ts.Type | undefined, context) {
  const { checker, options } = context
  const children = node.getChildren()
  // source is return type
  const sourceType: ts.Type = checker.getTypeAtLocation(children[1])
  // target is container type
  const container = context.cache.returnToContainer[node.getStart()]
  if (container) {
    containerType = containerType || checker.getTypeAtLocation(container)
    const targetType: ts.Type = checker.getSignaturesOfType(containerType, 0)[0].getReturnType()
    const targetTypeText = typeToString(checker, targetType)
    const sourceLink = getNodeLink(node)
    const targetLink = getNodeLink(container)
    const sourceTypeText = typeToString(checker, checker.getTypeAtLocation(node))
    const targetInfo = {
      nodeText: container.parent?.symbol?.getName(),
      typeText: targetTypeText,
      typeId: context.cache.saveType(targetType),
      fullText: getFullName(
        container.parent.kind !== ts.SyntaxKind.SourceFile ? `${container.parent?.symbol?.getName()}: ` : '',
        targetTypeText
      ),
      nodeLink: getNodeLink(container),
    }

    const arrayItems = context.cache.arrayItemsToTarget[node.getStart()]
    if (arrayItems) {
      return findArrayItemTargetAndSourceToCompare(arrayItems, targetType, targetInfo, context)
    } else {
      const sourceInfo = {
        nodeText: getText(node),
        typeText: sourceTypeText.replace('return ', ''),
        typeId: context.cache.saveType(sourceType),
        fullText: getText(node),
        nodeLink: getNodeLink(node),
      }
      const pathContext = {
        ...context,
        sourceNode: node,
        targetNode: container,
        prefix: 'The return type',
        sourceLink,
        targetLink,
        sourceTitle: 'Return',
        hadPayoff: false,
      }
      compareTypes(
        targetType,
        sourceType,
        [
          {
            targetInfo,
            sourceInfo,
          },
        ],
        pathContext,
        options.strictFunctionTypes
      )
      return pathContext.hadPayoff
    }
  }
  return false
}
//======================================================================
//======================================================================
//======================================================================
//  _____                 _   _                ____      _ _
// |  ___|   _ _ __   ___| |_(_) ___  _ __    / ___|__ _| | |
// | |_ | | | | '_ \ / __| __| |/ _ \| '_ \  | |   / _` | | |
// |  _|| |_| | | | | (__| |_| | (_) | | | | | |__| (_| | | |
// |_|   \__,_|_| |_|\___|\__|_|\___/|_| |_|  \____\__,_|_|_|
//======================================================================
//======================================================================
//======================================================================

function findFunctionCallTargetAndSourceToCompare(node: ts.Node, errorNode, context) {
  const { checker } = context
  const children = node.getChildren()
  // signature of function being called
  let tooManyArguments = false
  let tooFewArguments = false
  const type = checker.getTypeAtLocation(children[0])
  const signature = checker.getSignaturesOfType(type, 0)[0]
  if (signature) {
    // create calling pairs
    // calling arguments are the sources
    // function parameters are the targets
    const args = children[2].getChildren().filter((node) => node.kind !== ts.SyntaxKind.CommaToken)
    const params = signature.getParameters()
    const callingPairs = Array.from(Array(Math.max(args.length, params.length)).keys()).map((inx) => {
      let sourceInfo, targetInfo
      if (inx < args.length) {
        const arg = args[inx]
        const name = getText(arg)
        const type = checker.getTypeAtLocation(arg)
        const typeText = typeToStringLike(checker, type)
        sourceInfo = {
          name,
          type,
          typeText,
          typeId: context.cache.saveType(type),
          fullText: getFullName(name, typeText),
          nodeLink: getNodeLink(node),
        }
      }
      if (inx < params.length) {
        const param = params[inx]
        let name = param.escapedName as string
        let isOpt
        let type = checker.getTypeOfSymbolAtLocation(param, node)
        if (type['types']) {
          const types = type['types'].filter((t) => {
            if (t.flags & ts.TypeFlags.Undefined) {
              isOpt = true
              return false
            }
            return true
          })
          if (types.length > 1) {
            type['types'] = types
          } else {
            type = types[0]
          }
        } else {
          isOpt = !!(param.valueDeclaration && param.valueDeclaration.flags)
        }
        const typeText = typeToStringLike(checker, type)
        if (isOpt) name = name + '?'
        targetInfo = {
          name,
          type,
          typeText,
          typeId: context.cache.saveType(type),
          fullText: getFullName(name, typeText),
          nodeLink: getNodeLink(param.valueDeclaration),
          isOpt,
        }
      }
      // too many arguments
      tooManyArguments = !targetInfo
      tooFewArguments = !!(targetInfo && !sourceInfo && !targetInfo.isOpt)
      return { sourceInfo, targetInfo }
    })

    // individual array items mismatch the target
    const errorIndex = args.findIndex((node) => node === errorNode)
    // for each arg, compare its type to call parameter type
    // calling arguments are the sources
    // function parameters are the targets
    callingPairs.some(({ sourceInfo, targetInfo }, inx) => {
      // number of arguments mismatch
      if (tooManyArguments || tooFewArguments) {
        const func = getNodeDeclaration(children[0], context.cache)
        const pathContext = {
          ...context,
          callingPairs,
          errorIndex,
          callMismatch: true,
          tooFewArguments,
          tooManyArguments,
          sourceLink: getNodeLink(node),
          targetLink: getNodeLink(func),
          sourceTitle: 'Caller',
          targetTitle: 'Callee',
        }
        context.problems.push({
          problems: [],
          stack: [
            {
              sourceInfo: sourceInfo || {},
              targetInfo: targetInfo || {},
            },
          ],
          context: pathContext,
        })
        return true
      } else if (!sourceInfo) {
        // arg is missing but param is optional
        return true
      }

      // if argument is an Array, see if we're passing an array literal and compare each object literal type
      if (isArrayType(checker, sourceInfo.type)) {
        const arrayNode = ts.findAncestor(args[inx], (node) => {
          return !!node && node.kind === ts.SyntaxKind.VariableDeclaration
        })
        if (arrayNode) {
          const arrayItems = context.cache.arrayItemsToTarget[arrayNode.getStart()]
          if (arrayItems) {
            const targetType = sourceInfo.type
            const targetInfo = sourceInfo
            delete targetInfo.type
            findArrayItemTargetAndSourceToCompare(arrayItems, targetType, targetInfo, context)
            return context.problems.length > 0 // stops on first conflict just like typescript
          }
        }
      }

      // individual array items mismatch the target
      const pathContext = {
        ...context,
        callingPairs,
        errorIndex,
        callMismatch: true,
        tooManyArguments,
        prefix: 'The calling argument type',
        sourceLink: sourceInfo.nodeLink,
        targetLink: targetInfo?.nodeLink,
        sourceTitle: 'Caller',
        targetTitle: 'Callee',
        hadPayoff: false,
      }
      const remaining = callingPairs.length - inx - 1
      if (remaining) {
        pathContext.remaining = remaining === 1 ? `one argument` : `${remaining} arguments`
      }
      // calling arguments are the sources
      // function parameters are the targets
      const targetType = targetInfo.type
      const sourceType = sourceInfo.type
      delete targetInfo.type
      delete sourceInfo.type
      compareTypes(
        targetType,
        sourceType,
        [
          {
            sourceInfo,
            targetInfo,
          },
        ],
        pathContext
      )
      return pathContext.hadPayoff // stops on first conflict just like typescript
    })
  } else {
    console.log(`For error ${context.code}, missing signature for ${typeToString(checker, type)}`)
    console.log(getNodeLink(node))
    console.log('\n\n')
  }
}

//======================================================================
//======================================================================
//======================================================================
//     _                           ___ _
//    / \   _ __ _ __ __ _ _   _  |_ _| |_ ___ _ __ ___  ___
//   / _ \ | '__| '__/ _` | | | |  | || __/ _ \ '_ ` _ \/ __|
//  / ___ \| |  | | | (_| | |_| |  | || ||  __/ | | | | \__ \
// /_/   \_\_|  |_|  \__,_|\__, | |___|\__\___|_| |_| |_|___/
//                         |___/
//======================================================================
//======================================================================
//======================================================================

function findArrayItemTargetAndSourceToCompare(arrayItems, targetType, targetInfo, context) {
  const { checker } = context
  // const targetType: ts.Type = checker.getTypeAtLocation(targetNode)
  // const targetTypeText = typeToString(targetType)
  // target has GOT to be an array
  targetType = targetType.typeArguments[0]
  arrayItems.some((sourceNode, inx) => {
    const sourceType: ts.Type = checker.getTypeAtLocation(sourceNode)
    const sourceTypeText = typeToString(checker, sourceType)
    const pathContext = {
      ...context,
      prefix: 'The array item type',
      sourceLink: getNodeLink(sourceNode),
      targetLink: targetInfo.nodeLink,
      sourceTitle: 'Item',
      targetTitle: 'Target',
      hadPayoff: false,
    }
    const remaining = arrayItems.length - inx - 1
    if (remaining) {
      pathContext.remaining = remaining === 1 ? `one item` : `${remaining} items`
    }
    compareTypes(
      targetType,
      sourceType,
      [
        {
          sourceInfo: {
            nodeText: getText(sourceNode),
            typeText: sourceTypeText,
            typeId: context.cache.saveType(sourceType),
            fullText: getFullName(sourceNode, sourceTypeText),
            nodeLink: getNodeLink(sourceNode),
          },
          targetInfo,
        },
      ],
      pathContext
    )
    // stop on first error-- this error might cause
    // remaining items to throw bogus errors
    return context.problems.length > 0
  })
}
