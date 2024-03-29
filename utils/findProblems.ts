/* Copyright Contributors to the Open Cluster Management project */

import ts from 'typescript'
import stringSimilarity from 'string-similarity'
import chalk from 'chalk'
import {
  getFullText,
  getNodeLink,
  getNodeText,
  getTypeLink,
  isArrayType,
  isFunctionLikeKind,
  typeToString,
  typeToStringLike,
} from './utils'
import { compareAttributes, compareTypes, compareWithPlaceholder, getPlaceholderStack } from './compareTypes'
import { IProblemCache } from './types'
import { getNodeBlockId, getNodeDeclaration } from './cacheFile'

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
export function findProblems(programContext, code, errorNode: ts.Node, node: ts.Node, problemBeg, cache) {
  const context: IProblemCache = {
    ...programContext,
    code,
    node,
    problemBeg,
    errorNode,
    cache,
    problems: [],
  }

  let children = node.getChildren()
  switch (node.kind) {
    //======================================================================
    //================= JSX ELEMENT  ==========================
    //======================================================================
    case ts.SyntaxKind.JsxOpeningElement:
      findJSXElementTargetAndSourceToCompare(node, context)
      break
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
          context.objectDeclaration = getNodeDeclaration(objectName, context)
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
  }
  if (context.problems.length === 0) {
    otherSolutions(context)
  }
  return context.problems
}

//======================================================================
//======================================================================
//======================================================================
//    ___  _   _                 ____        _       _   _
//   / _ \| |_| |__   ___ _ __  / ___|  ___ | |_   _| |_(_) ___  _ __  ___
//  | | | | __| '_ \ / _ \ '__| \___ \ / _ \| | | | | __| |/ _ \| '_ \/ __|
//  | |_| | |_| | | |  __/ |     ___) | (_) | | |_| | |_| | (_) | | | \__ \
//   \___/ \__|_| |_|\___|_|    |____/ \___/|_|\__,_|\__|_|\___/|_| |_|___/
//======================================================================
//======================================================================
//======================================================================

function otherSolutions(context) {
  const { cache, code, errorNode } = context
  const suggestions: string[] = []

  if (errorNode.kind === ts.SyntaxKind.Identifier) {
    const arrayExpression = ts.findAncestor(errorNode, (node) => {
      return !!node && node.kind === ts.SyntaxKind.ArrayLiteralExpression
    })
    if (arrayExpression) {
      suggestions.push(`TS${code}: Unknown variable in array ${chalk.red(errorNode.escapedText)}`)
      const blockId = getNodeBlockId(arrayExpression)
      let declareMap = cache.blocksToDeclarations[blockId]
      const matches = stringSimilarity.findBestMatch(errorNode.escapedText, Object.keys(declareMap))
      const {
        bestMatch: { rating, target },
      } = matches
      if (rating > 0.6) {
        suggestions.push(chalk.white(`Did you mean to use ${chalk.redBright(target)} instead here?`))
        suggestions.push(chalk.blue(`  ${getNodeLink(arrayExpression)}`))
      }
      context.problems.push({ suggestions, context })
      return
    }
  }

  console.log(`For error ${code}, missing support for kind === ${errorNode.kind}`)
  console.log(getNodeLink(errorNode))
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
  const targetDeclaration = getNodeDeclaration(targetNode, context)
  const targetNodeText = getNodeText(targetNode)
  const targetInfo = {
    nodeText: targetNodeText,
    typeText: targetTypeText,
    fullText: getFullText(targetNodeText, targetTypeText),
    nodeLink: getNodeLink(targetNode),
    typeId: context.cache.saveType(targetType),
    nodeId: context.cache.saveNode(targetDeclaration),
    declaredId: context.cache.saveNode(targetDeclaration),
  }

  // try to get the type of the accessor using the original expression (a = b)
  let typeText = 'any'
  const expression = ts.findAncestor(context.errorNode, (node) => {
    return (
      !!node && (node.kind === ts.SyntaxKind.ExpressionStatement || node.kind === ts.SyntaxKind.ElementAccessExpression)
    )
  })
  if (expression) {
    const statement = expression as ts.ExpressionStatement
    const children = statement.expression.getChildren()
    typeText = typeToStringLike(checker, checker.getTypeAtLocation(children[2]))
  }

  const sourceNodeText = getNodeText(sourceNode)
  const placeholderInfo = {
    nodeText: sourceNodeText,
    typeText,
    nodeLink: getNodeLink(sourceNode),
    node: sourceNode,
    fullText: getFullText(sourceNodeText, typeText),
    targetKey: sourceNodeText,
  }

  context = {
    ...context,
    sourceNode,
    targetNode,
    sourceLink: placeholderInfo.nodeLink,
    targetLink: targetInfo.nodeLink,
    targetTitle: 'Object',
    sourceTitle: 'Property',
    missingAccess: true,
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
  const targetDeclaration = getNodeDeclaration(targetNode, context)
  const targetNodeText = getNodeText(targetNode)
  const targetInfo = {
    nodeText: targetNodeText,
    typeText: targetTypeText,
    fullText: getFullText(targetNodeText, targetTypeText),
    nodeLink: getNodeLink(targetDeclaration),
    typeId: context.cache.saveType(targetType),
    nodeId: context.cache.saveNode(targetNode),
    declaredId: context.cache.saveNode(targetDeclaration),
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
      let hadProblem = false
      returns.forEach((rn) => {
        findReturnStatementTargetAndSourceToCompare(rn, targetType, context)
        hadProblem = context.problems.length > 0
      })
      return hadProblem
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
      const targetDeclaration = getNodeDeclaration(targetNode, context)
      const targetInfo = {
        nodeText: targetTypeText,
        typeText: targetTypeText,
        typeId: context.cache.saveType(targetType),
        fullText: getFullText(targetTypeText, targetTypeText),
        nodeLink: getTypeLink(targetType),
        declaredId: context.cache.saveNode(targetDeclaration),
      }

      // ex: [key: string]: string
      const nodeText = `[key: ${indexTypeText}]`
      const typeText = 'any'
      const placeholderInfo = {
        nodeText,
        typeText,
        nodeLink: getNodeLink(sourceNode),
        node: sourceNode,
        fullText: getFullText(nodeText, typeText),
        placeholderTarget: {
          key: nodeText,
          typeId: targetInfo.typeId,
        },
      }

      context = {
        ...context,
        sourceNode,
        targetNode,
        sourceLink: placeholderInfo.nodeLink,
        targetLink: targetInfo.nodeLink,
        targetTitle: 'Map',
        sourceTitle: 'Index',
        missingIndex: true,
      }

      const { problems, stack } = compareWithPlaceholder(targetInfo, placeholderInfo, context)

      context.problems.push({ problems, stack, context })
    }
  }

  const sourceNodeText = getNodeText(sourceNode)
  const sourceTypeText = typeToString(checker, sourceType)
  const sourceInfo = {
    nodeText: sourceNodeText,
    typeText: sourceTypeText,
    fullText: getFullText(sourceNodeText, sourceTypeText),
    nodeLink: getNodeLink(sourceNode),
    typeId: context.cache.saveType(sourceType),
    nodeId: context.cache.saveNode(sourceNode),
  }

  // individual array items mismatch the target
  const pathContext = {
    ...context,
    sourceNode,
    targetNode,
    sourceLink: getNodeLink(sourceNode),
  }
  const stack = getPlaceholderStack(targetInfo, sourceInfo, pathContext)
  pathContext.targetLink = stack[0].targetInfo.nodeLink
  compareTypes(targetType, sourceType, stack, pathContext)
  return pathContext.problems.length > 0
}

//======================================================================
//======================================================================
//======================================================================
//       _ ______  __  _____ _                           _
//      | / ___\ \/ / | ____| | ___ _ __ ___   ___ _ __ | |_
//   _  | \___ \\  /  |  _| | |/ _ \ '_ ` _ \ / _ \ '_ \| __|
//  | |_| |___) /  \  | |___| |  __/ | | | | |  __/ | | | |_
//   \___/|____/_/\_\ |_____|_|\___|_| |_| |_|\___|_| |_|\__|

//======================================================================
//======================================================================
//======================================================================

function findJSXElementTargetAndSourceToCompare(node: ts.Node, context) {
  const { checker } = context
  const children = node.getChildren()
  const signatureParam = checker.getSignaturesOfType(checker.getTypeAtLocation(children[1]))[0].getParameters()[0]
  const targetNode = children[1]
  const targetType = checker.getTypeOfSymbol(signatureParam)
  const targetTypeText = typeToString(checker, targetType)
  const targetNodeText = getNodeText(targetNode)
  const targetDeclaration = checker.getTypeAtLocation(children[1]).getSymbol().getDeclarations()[0]
  const targetInfo = {
    nodeText: targetNodeText,
    typeText: targetTypeText,
    fullText: getFullText(targetNodeText, targetTypeText),
    nodeLink: getNodeLink(targetDeclaration),
    typeId: context.cache.saveType(targetType),
    nodeId: context.cache.saveNode(targetNode),
    declaredId: context.cache.saveNode(targetDeclaration),
    properties: targetType.getProperties(),
  }
  const sourceNode = children[2]
  const sourceInfo = {
    attributes: children[2]['properties'],
  }
  const pathContext = {
    ...context,
    isJSXProblem: true,
    sourceLink: getNodeLink(sourceNode),
    targetLink: targetInfo.nodeLink,
    sourceTitle: 'Attributes',
    targetTitle: 'Component',
  }
  compareAttributes(targetInfo, sourceInfo, pathContext)
  return context.problems.length > 0
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
  const { checker } = context
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
      fullText: getFullText(
        container.parent.kind !== ts.SyntaxKind.SourceFile ? `${container.parent?.symbol?.getName()}: ` : '',
        targetTypeText
      ),
      nodeLink: getNodeLink(container),
      typeId: context.cache.saveType(targetType),
      nodeId: context.cache.saveNode(container),
    }

    const arrayItems = context.cache.arrayItemsToTarget[node.getStart()]
    if (arrayItems) {
      return findArrayItemTargetAndSourceToCompare(arrayItems, targetType, targetInfo, context)
    } else {
      const sourceNodeText = node
        .getText()
        .split('\n')
        .map((seg) => seg.trimStart())
        .join(' ')

      const sourceInfo = {
        nodeText: sourceNodeText,
        typeText: sourceTypeText.replace('return ', ''),
        fullText: sourceNodeText,
        nodeLink: getNodeLink(node),
        typeId: context.cache.saveType(sourceType),
        nodeId: context.cache.saveNode(node),
      }
      const pathContext = {
        ...context,
        sourceNode: node,
        targetNode: container,
        sourceLink,
        targetLink,
        sourceTitle: 'Return',
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
        global.options.strictFunctionTypes
      )
      return pathContext.problems.length > 0
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
  const declarations = type.getSymbol()?.getDeclarations()
  if (declarations) {
    context.functionDeclared = declarations[0]
  }
  context.functionName = children[0].getText()
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
        const name = getNodeText(arg)
        const type = checker.getTypeAtLocation(arg)
        const typeText = typeToStringLike(checker, type)
        sourceInfo = {
          name,
          type,
          typeText,
          fullText: getFullText(name, typeText),
          nodeText: name,
          nodeLink: getNodeLink(node),
          typeId: context.cache.saveType(type),
          nodeId: context.cache.saveNode(arg),
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
          fullText: getFullText(name, typeText),
          nodeText: name,
          nodeLink: getNodeLink(param.valueDeclaration),
          typeId: context.cache.saveType(type),
          nodeId: context.cache.saveNode(param.valueDeclaration),
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
        const pathContext = {
          ...context,
          callingPairs,
          errorIndex,
          callMismatch: true,
          tooFewArguments,
          tooManyArguments,
          sourceLink: getNodeLink(node),
          targetLink: getNodeLink(context.functionDeclared),
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
        sourceLink: sourceInfo.nodeLink,
        targetLink: targetInfo?.nodeLink,
        sourceTitle: 'Caller',
        targetTitle: 'Callee',
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
      return context.problems.length > 0 // stops on first conflict just like typescript
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
      sourceLink: getNodeLink(sourceNode),
      targetLink: targetInfo.nodeLink,
      sourceTitle: 'Item',
      targetTitle: 'Target',
    }
    const remaining = arrayItems.length - inx - 1
    if (remaining) {
      pathContext.remaining = remaining === 1 ? `one item` : `${remaining} items`
    }
    const sourceNodeText = getNodeText(sourceNode)
    compareTypes(
      targetType,
      sourceType,
      [
        {
          sourceInfo: {
            nodeText: sourceNodeText,
            typeText: sourceTypeText,
            fullText: getFullText(sourceNodeText, sourceTypeText),
            nodeLink: getNodeLink(sourceNode),
            typeId: context.cache.saveType(sourceType),
            nodeId: context.cache.saveNode(sourceNode),
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
