/* Copyright Contributors to the Open Cluster Management project */

import cloneDeep from 'lodash/cloneDeep'
import path from 'path'
import * as fs from 'fs'
import ts from 'typescript'
import prettier from 'prettier'
import { findProblems } from './findProblems'
import { getNodeBlockId, getNodeLink, isFunctionLikeKind } from './utils'
import { showProblemTables, showTableNotes } from './showProblemTables'
import { showPromptFixes } from './promptFixes/showPromptFixes'
import { ICache } from './types'

let options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.CommonJS,
}
let checker: ts.TypeChecker
let isVerbose = false
let isFix = false

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

export function startSniffing(fileNames: string | any[] | readonly string[], verbose: boolean, fix: boolean) {
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
    isFix = true // fix
    isVerbose = verbose
    //options.isolatedModules = false
    console.log('starting...')
    const program = ts.createProgram(fileNames, options)
    checker = program.getTypeChecker()
    const syntactic = program.getSyntacticDiagnostics()
    if (syntactic.length) {
      console.log('Warning: there are syntax errors.')
      if (isFix) {
        console.log('Cannot fix any files.')
        isFix = false
      }
    }
    console.log(isFix ? 'fixing...' : 'looking...')
    augmentDiagnostics(program.getSemanticDiagnostics(), fileNames)
  } else {
    console.log('No files specified.')
  }
}

function augmentDiagnostics(semanticDiagnostics: readonly ts.Diagnostic[], fileNames: string[]) {
  let hadProblem = false
  let anyProblem = false
  const fileMap = Map<string, ICache>
  const missingSupport: string[] = []
  const processedNodes = new Set()
  console.log('\n\n')
  const programContext = {
    options,
    checker,
    isVerbose,
    isFix,
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
            const closestTargetNode = getClosestTarget(errorNode)
            const nodeId = closestTargetNode.getStart()
            // compiler might throw multiple errors for the same problem -- only process one of them
            if (!processedNodes.has(nodeId)) {
              findProblems(programContext, errorCode, errorNode, closestTargetNode, nodeId, cache).forEach(
                ({ problems, stack, context }) => {
                  showProblemTables(problems, context, stack)
                  if (isFix) {
                    showPromptFixes(problems, context, stack)
                  } else {
                    showTableNotes(problems, context)
                  }
                  console.log('\n\n')
                  processedNodes.add(nodeId)
                  hadProblem = true
                }
              )
              if (!hadProblem) {
                missingSupport.push(
                  `For error ${errorCode}, missing support ${ts.SyntaxKind[closestTargetNode.kind]} ${nodeId}`
                )
                missingSupport.push(`${getNodeLink(closestTargetNode)}\n`)
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
  } else if (isFix) {
    Object.entries(fileMap).forEach(([fileName, { hasFixes, outputFile }]) => {
      // if we fixed some stuff, output it
      if (hasFixes) {
        const printer = ts.createPrinter({ removeComments: false })
        // restore blank lines we preserved
        let output = printer.printFile(outputFile).replace(/\/\*\* THIS_IS_A_NEWLINE \*\*\//g, '\n')

        // prettify
        const configFile = prettier.resolveConfigFile.sync(fileName)
        const options = configFile
          ? prettier.resolveConfig.sync(configFile)
          : { printWidth: 120, tabWidth: 2, semi: false, singleQuote: true }
        output = prettier.format(output, {
          parser: 'typescript',
          ...options,
        })

        // write file
        fs.writeFileSync(outputFile.fileName, output)
      }
    })
  }
  console.log('\n\n--------------------------------------------------------------------------')
}

function getClosestTarget(errorNode: ts.Node) {
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
  const cache: ICache = {
    startToNode: {},
    kindToNodes: new Map<ts.SyntaxKind, any[]>(),
    returnToContainer: {},
    arrayItemsToTarget: {},
    containerToReturns: {},
    blocksToDeclarations: {},
    typeIdToType: {},
    startToOutputNode: {},
    saveType: (type: ts.Type) => {
      const id = type['id']
      cache.typeIdToType[id] = type
      return id
    },
    getType: (id: number) => {
      return cache.typeIdToType[id]
    },
  }

  const order: number[] = []
  function mapNodes(node: ts.Node) {
    // STORE BY START OF NODE WHICH IS UNIQUE
    const start = node.getStart()
    cache.startToNode[start] = node
    order.push(start)

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

  // if we're fixing a ts, open an output and map from input nodes to output nodes
  if (isFix) {
    // need to replace blank lines with a comment to keep blank lines in the output
    const input = fs.readFileSync(sourceFile.fileName).toString().replace(/\n\n/g, '\n/** THIS_IS_A_NEWLINE **/')
    cache.outputFile = ts.createSourceFile(sourceFile.fileName, input, ts.ScriptTarget.ES2015, /*setParentNodes */ true)

    function mapOutputNodes(node: ts.Node) {
      // need to use original node map keys because of blank lines
      cache.startToOutputNode[order.shift() || -1] = node
      ts.forEachChild(node, mapOutputNodes)
    }
    mapOutputNodes(cache.outputFile)
  }

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
