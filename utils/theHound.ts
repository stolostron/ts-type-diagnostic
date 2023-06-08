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
  const fixMap = {}
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
      const fileName = file.fileName
      let cache = fileMap[fileName]
      if (!cache) {
        let outputFile: ts.SourceFile | undefined
        if (isFix) {
          // to preserve blank lines
          fixMap[fileName] = fs.readFileSync(fileName).toString().replace(/\n\n/g, '\n/** THIS_IS_A_NEWLINE **/')
          // use this to create nodes that can be mapped to output string
          outputFile = ts.createSourceFile(fileName, fixMap[fileName], ts.ScriptTarget.ES2015, /*setParentNodes */ true)
        }
        cache = fileMap[fileName] = cacheNodes(file, outputFile)
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
    Object.entries(fileMap).forEach(([fileName, { fixes }]) => {
      // if we fixed some stuff, output it
      if (fixes.length) {
        //const printer = ts.createPrinter({ removeComments: false })

        // get the output text
        let output: string = fixMap[fileName]

        // apply the fixes--last first to preserve positions of above changes
        fixes.sort((a: { pos: number }, b: { pos: number }) => {
          return b.pos - a.pos
        })
        fixes.forEach(({ pos, end, replace }) => {
          output = `${output.substring(0, pos)}${replace}${output.substring(end)}`
        })

        // restore blank lines we preserved
        output = output.replace(/\/\*\* THIS_IS_A_NEWLINE \*\*\//g, '\n')

        // prettify the output
        const configFile = prettier.resolveConfigFile.sync(fileName)
        const options = configFile
          ? prettier.resolveConfig.sync(configFile)
          : { printWidth: 120, tabWidth: 2, semi: false, singleQuote: true }
        output = prettier.format(output, {
          parser: 'typescript',
          ...options,
        })

        // write output to file
        fs.writeFileSync(fileName, output)
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
function cacheNodes(sourceFile: ts.SourceFile, outputFile?: ts.SourceFile) {
  const cache: ICache = {
    startToNode: new Map<number, ts.Node>(),
    kindToNodes: new Map<ts.SyntaxKind, any[]>(),
    returnToContainer: {},
    arrayItemsToTarget: {},
    containerToReturns: {},
    blocksToDeclarations: {},
    typeIdToType: {},
    startToOutputNode: new Map<number, { pos: number; end: number }>(),
    fixes: [],
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

  // if we're fixing a ts, map node positions to output file positions
  if (outputFile) {
    function mapOutputNodes(node: ts.Node) {
      cache.startToOutputNode[order.shift() || -1] = { pos: node.getStart(), end: node.getEnd() }
      ts.forEachChild(node, mapOutputNodes)
    }
    mapOutputNodes(outputFile)
  }

  Object.entries(cache.kindToNodes).forEach(([kind, nodes]) => {
    switch (Number(kind)) {
      // FOR A SIMPLE TARGET = SOURCE,
      // THE ERROR WILL BE ON THIS LINE BUT THE TARGET/SOURCE CAN BE DEFINED ON ANOTHER LINE
      // REMEMBER WHERE THEY"RE LOCATED FOR THE HERELINK IN THE SUGGESTIONS
      case ts.SyntaxKind.VariableDeclaration:
        nodes.forEach((node: ts.Node) => {
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
        nodes.forEach((returnNode: { parent: ts.Node | undefined; getStart: () => string | number }) => {
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
        nodes.forEach((node: ts.Node) => {
          const arrayNode =
            ts.findAncestor(node, (node) => {
              return (
                !!node &&
                (node.kind === ts.SyntaxKind.VariableDeclaration ||
                  node.kind === ts.SyntaxKind.BinaryExpression ||
                  node.kind === ts.SyntaxKind.ReturnStatement)
              )
            }) || node

          let arrayItems = cache.arrayItemsToTarget[arrayNode.getStart()]
          if (!arrayItems) {
            arrayItems = cache.arrayItemsToTarget[arrayNode.getStart()] = []
          }
          const syntaxList = node.getChildren().find(({ kind }) => kind === ts.SyntaxKind.SyntaxList)
          if (syntaxList) {
            const items = syntaxList.getChildren()
            let objectLiterals = syntaxList
              .getChildren()
              .filter(({ kind }) => kind === ts.SyntaxKind.ObjectLiteralExpression)
            if (syntaxList.getChildren().length === 0 && objectLiterals.length === 0) {
              const fake = cloneDeep(syntaxList)
              // @ts-expect-error
              fake['kind'] = ts.SyntaxKind.ObjectLiteralExpression
              fake['properties'] = ts.factory.createObjectLiteralExpression([]).properties
              objectLiterals = [fake]
            }
            arrayItems.push(items)
          }

          cache.arrayItemsToTarget[arrayNode.getStart()] = arrayItems.flat()
        })

        break
    }
  })
  return cache
}
