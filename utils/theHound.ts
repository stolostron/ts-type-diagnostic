/* Copyright Contributors to the Open Cluster Management project */

import cloneDeep from 'lodash/cloneDeep'
import path from 'path'
import ts from 'typescript'
import { findProblems } from './findProblems'
import { getNodeBlockId, getNodeLink, isFunctionLikeKind } from './utils'
import { showProblemTables, showTableNotes } from './showProblemTables'
import { showSuggestions } from './showSuggestions'

let options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.CommonJS,
}
let checker: ts.TypeChecker
let isVerbose = false

// errors we ignore
const ignoreTheseErrors = [6133, 2304, 2448, 2454]

//======================================================================
//======================================================================
//======================================================================
//      _                                    _
//     / \  _   _  __ _ _ __ ___   ___ _ __ | |_
//    / _ \| | | |/ _` | '_ ` _ \ / _ \ '_ \| __|
//   / ___ \ |_| | (_| | | | | | |  __/ | | | |_
//  /_/   \_\__,_|\__, |_| |_| |_|\___|_| |_|\__|
//                |___/
//======================================================================
//======================================================================
//======================================================================

export function startSniffing(fileNames: string | any[] | readonly string[], verbose: boolean) {
  // Read tsconfig.json file
  if (Array.isArray(fileNames) && fileNames.length > 0) {
    const tsconfigPath = ts.findConfigFile(fileNames[0], ts.sys.fileExists, 'tsconfig.json')
    if (tsconfigPath) {
      const tsconfigFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
      options = ts.parseJsonConfigFileContent(tsconfigFile.config, ts.sys, path.dirname(tsconfigPath)).options
    } else {
      options = {
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS,
      }
    }
    isVerbose = verbose
    //options.isolatedModules = false
    console.log('starting...')
    const program = ts.createProgram(fileNames, options)
    checker = program.getTypeChecker()
    const syntactic = program.getSyntacticDiagnostics()
    console.log('looking...')
    augmentDiagnostics(program.getSemanticDiagnostics(), fileNames)
    if (!!syntactic.length) {
      console.log('Warning: there were syntax errors.')
    }
  } else {
    console.log('No files specified.')
  }
}

function augmentDiagnostics(semanticDiagnostics: readonly ts.Diagnostic[], fileNames: string[]) {
  let hadProblem = false
  let anyProblem = false
  const fileMap = {}
  const missingSupport: string[] = []
  const processedNodes = new Set()
  console.log('\n\n')
  const programContext = {
    options,
    checker,
    isVerbose,
  }
  semanticDiagnostics.forEach(({ code: errorCode, file, start }) => {
    if (file && fileNames.includes(file.fileName)) {
      let cache = fileMap[file.fileName]
      if (!cache) {
        cache = fileMap[file.fileName] = cacheNodes(file)
      }
      if (start) {
        let errorNode = cache.startToNode[start]
        if (errorNode) {
          if (!ignoreTheseErrors.includes(errorCode)) {
            hadProblem = false
            const normalizedNode = getNormalizedErrorNode(errorNode)
            // compiler might throw multiple errors for the same problem -- only process one of them
            const nodeId = normalizedNode.getStart()
            if (!processedNodes.has(nodeId)) {
              findProblems(programContext, errorCode, errorNode, normalizedNode, nodeId, cache).forEach(
                ({ problems, stack, context }) => {
                  showProblemTables(problems, context, stack)
                  showSuggestions(problems, context, stack)
                  showTableNotes(problems, context)
                  console.log('\n\n')
                  processedNodes.add(nodeId)
                  hadProblem = true
                }
              )
              if (!hadProblem) {
                missingSupport.push(
                  `For error ${errorCode}, missing support ${ts.SyntaxKind[normalizedNode.kind]} ${nodeId}`
                )
                missingSupport.push(`${getNodeLink(normalizedNode)}\n`)
              }
            }
          }
          anyProblem = anyProblem || hadProblem
        }
      }
    }
  })

  if (missingSupport.length > 0) {
    missingSupport.forEach((miss) => console.log(miss))
  }
  if (!anyProblem) {
    console.log(`\n--no squirrels--`)
  }
  console.log('\n\n--------------------------------------------------------------------------')
}

function getNormalizedErrorNode(errorNode: ts.Node) {
  const errorType = checker.getTypeAtLocation(errorNode)
  return (
    ts.findAncestor(errorNode, (node) => {
      return (
        !!node &&
        (node.kind === ts.SyntaxKind.ReturnStatement ||
          node.kind === ts.SyntaxKind.VariableDeclaration ||
          node.kind === ts.SyntaxKind.ExpressionStatement ||
          (node.kind === ts.SyntaxKind.PropertyAccessExpression && !!(errorType.flags & ts.TypeFlags.Any)) ||
          node.kind === ts.SyntaxKind.CallExpression)
      )
    }) || errorNode
  )
}

//======================================================================
//======================================================================
//======================================================================
//    ____           _            _   _           _
//   / ___|__ _  ___| |__   ___  | \ | | ___   __| | ___  ___
//  | |   / _` |/ __| '_ \ / _ \ |  \| |/ _ \ / _` |/ _ \/ __|
//  | |__| (_| | (__| | | |  __/ | |\  | (_) | (_| |  __/\__ \
//   \____\__,_|\___|_| |_|\___| |_| \_|\___/ \__,_|\___||___/

//======================================================================
//======================================================================
//======================================================================
// In case the compiler combines multiple types into one type for comparison
// We need to keep track of each individual type in order to pinpoint the error
function cacheNodes(sourceFile: ts.SourceFile) {
  const cache = {
    startToNode: {},
    kindToNodes: new Map<ts.SyntaxKind, any[]>(),
    returnToContainer: {},
    arrayItemsToTarget: {},
    containerToReturns: {},
    blocksToDeclarations: {},
    typeIdToType: {},
    saveType: (type: ts.Type) => {
      const id = type['id']
      cache.typeIdToType[id] = type
      return id
    },
    getType: (id: number) => {
      return cache.typeIdToType[id]
    },
  }

  function mapNodes(node: ts.Node) {
    // STORE BY START OF NODE WHICH IS UNIQUE
    cache.startToNode[node.getStart()] = node

    // GROUP BY WHAT KIND THE NODE IS FOR BELOW
    let nodes = cache.kindToNodes[node.kind]
    if (!nodes) {
      nodes = cache.kindToNodes[node.kind] = []
    }
    nodes.push(node)

    // FOR EACH NODE IN SOURCE FILE
    ts.forEachChild(node, mapNodes)
  }
  mapNodes(sourceFile)

  Object.entries(cache.kindToNodes).forEach(([kind, nodes]) => {
    switch (Number(kind)) {
      // FOR A SIMPLE TARGET = SOURCE,
      // THE ERROR WILL BE ON THIS LINE BUT THE TARGET/SOURCE CAN BE DEFINED ON ANOTHER LINE
      // REMEMBER WHERE THEY"RE LOCATED FOR THE HERELINK IN THE SUGGESTIONS
      case ts.SyntaxKind.VariableDeclaration:
        nodes.forEach((node) => {
          const blockId = getNodeBlockId(node)
          let declareMap = cache.blocksToDeclarations[blockId]
          if (!declareMap) {
            declareMap = cache.blocksToDeclarations[blockId] = {}
          }
          declareMap[node.getChildren()[0].getText()] = node
        })
        break

      // FOR EACH 'RETURN' REMEBER WHAT ITS CONTAINER IS TO DO THAT CHECK
      case ts.SyntaxKind.ReturnStatement:
        nodes.forEach((returnNode) => {
          const container = ts.findAncestor(returnNode.parent, (node) => {
            return !!node && (isFunctionLikeKind(node.kind) || ts.isClassStaticBlockDeclaration(node))
          })
          if (container) {
            cache.returnToContainer[returnNode.getStart()] = container
            let returnNodes = cache.containerToReturns[container.getStart()]
            if (!returnNodes) {
              returnNodes = cache.containerToReturns[container.getStart()] = []
            }
            returnNodes.push(returnNode)
          }
        })
        break
      // FOR EACH LITERAL ARRAY, REMEMBER A PARENT LOCATION WE CAN REFERENCE BELOW
      case ts.SyntaxKind.ArrayLiteralExpression:
        nodes.forEach((node) => {
          const arrayNode =
            ts.findAncestor(node, (node) => {
              return (
                !!node &&
                (node.kind === ts.SyntaxKind.VariableDeclaration ||
                  node.kind === ts.SyntaxKind.BinaryExpression ||
                  node.kind === ts.SyntaxKind.ReturnStatement)
              )
            }) || node

          const syntaxList = node.getChildren().find(({ kind }) => kind === ts.SyntaxKind.SyntaxList)

          const items = syntaxList.getChildren()
          let objectLiterals = syntaxList
            .getChildren()
            .filter(({ kind }) => kind === ts.SyntaxKind.ObjectLiteralExpression)
          if (syntaxList.getChildren().length === 0 && objectLiterals.length === 0) {
            const fake = cloneDeep(syntaxList)
            fake.properties = ts.factory.createObjectLiteralExpression([]).properties
            fake.kind = ts.SyntaxKind.ObjectLiteralExpression
            objectLiterals = [fake]
          }

          let arrayItems = cache.arrayItemsToTarget[arrayNode.getStart()]
          if (!arrayItems) {
            arrayItems = cache.arrayItemsToTarget[arrayNode.getStart()] = []
          }
          arrayItems.push(items)
          cache.arrayItemsToTarget[arrayNode.getStart()] = arrayItems.flat()
        })

        break
    }
  })
  return cache
}
