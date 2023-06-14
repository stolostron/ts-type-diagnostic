import cloneDeep from 'lodash/cloneDeep'
import ts from 'typescript'
import { isFunctionLikeKind } from './utils'
import { IFileCache } from './types'
import * as fs from 'fs'
import prettier from 'prettier'

//======================================================================
//======================================================================
//======================================================================
//    ____           _            _____ _ _
//   / ___|__ _  ___| |__   ___  |  ___(_) | ___
//  | |   / _` |/ __| '_ \ / _ \ | |_  | | |/ _ \
//  | |__| (_| | (__| | | |  __/ |  _| | | |  __/
//   \____\__,_|\___|_| |_|\___| |_|   |_|_|\___|

//======================================================================
//======================================================================
//======================================================================
// In case the compiler combines multiple types into one type for comparison
// We need to keep track of each individual type in order to pinpoint the error
export function cacheFile(sourceFile: ts.SourceFile) {
  const cache: IFileCache = {
    sourceFile,
    startToNode: new Map<number, ts.Node>(),
    startToOutputNode: new Map<number, ts.Node>(),
    kindToNodes: new Map<ts.SyntaxKind, any[]>(),
    returnToContainer: {},
    arrayItemsToTarget: {},
    containerToReturns: {},
    blocksToDeclarations: {},
    nodeIdToNode: {},
    saveNode: (node: ts.Node) => {
      const id = `${node.getSourceFile().fileName}:${node.getStart()}`
      cache.nodeIdToNode[id] = node
      return id
    },
    getNode: (id: string) => {
      return cache.nodeIdToNode[id]
    },
    typeIdToType: {},
    saveType: (type: ts.Type) => {
      const id = type['id']
      cache.typeIdToType[id] = type
      return id
    },
    getType: (id: number) => {
      return cache.typeIdToType[id]
    },
    sourceFixes: [],
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

  // cache out file for fixes
  cacheOutput(order, cache, sourceFile)
  return cache
}

//======================================================================
//======================================================================
//======================================================================
//    ____           _             ___        _               _
//   / ___|__ _  ___| |__   ___   / _ \ _   _| |_ _ __  _   _| |_
//  | |   / _` |/ __| '_ \ / _ \ | | | | | | | __| '_ \| | | | __|
//  | |__| (_| | (__| | | |  __/ | |_| | |_| | |_| |_) | |_| | |_
//   \____\__,_|\___|_| |_|\___|  \___/ \__,_|\__| .__/ \__,_|\__|
//                                               |_|
//======================================================================
//======================================================================
//======================================================================

export function cacheOutput(order, cache, sourceFile) {
  // // preserve blank lines
  const fileName = sourceFile.fileName
  cache.outputFileString = fs.readFileSync(fileName).toString().replace(/\n\n/g, '\n/** THIS_IS_A_NEWLINE **/')
  // use this to create nodes that can be mapped to output string
  const outputFile = ts.createSourceFile(
    fileName,
    cache.outputFileString,
    ts.ScriptTarget.ES2015,
    /*setParentNodes */ true
  )
  // if we're fixing a ts, map node positions to output file positions
  function mapOutputNodes(node: ts.Node) {
    cache.startToOutputNode[order.shift() || -1] = node
    ts.forEachChild(node, mapOutputNodes)
  }
  mapOutputNodes(outputFile)
}

export function saveOutput(fileName, output) {
  // restore blank lines we preserved
  output = output.replace(/\/\*\* THIS_IS_A_NEWLINE \*\*\//g, '\n')
  // prettify the output
  const configFile = prettier.resolveConfigFile.sync(fileName)
  const options = configFile
    ? prettier.resolveConfig.sync(configFile)
    : { printWidth: 120, tabWidth: 2, semi: false, singleQuote: true }
  try {
    output = prettier.format(output, {
      parser: 'typescript',
      ...options,
    })
  } catch (e) {}
  // write output to file
  fs.writeFileSync(fileName, output)
}

export function getNodeBlockId(node: ts.Node) {
  const block = ts.findAncestor(node.parent, (node) => {
    return !!node && node.kind === ts.SyntaxKind.Block
  })
  return block ? block.getStart() : 0
}

export function getNodeDeclaration(node: ts.Node | ts.Identifier, context) {
  const declarationMap = context.cache.blocksToDeclarations[getNodeBlockId(node)]
  const varName = node.getText()
  return declarationMap && varName && declarationMap[varName] ? declarationMap[varName] : node
}
