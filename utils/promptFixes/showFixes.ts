/* Copyright Contributors to the Open Cluster Management project */

import chalk from 'chalk'
import inquirer from 'inquirer'
import ts from 'typescript'
import groupBy from 'lodash/groupBy'

import { whenArraysDontMatch } from './whenArraysDontMatch'
import { whenUndefinedTypeDoesntMatch } from './whenUndefinedTypeDoesntMatch'
import { whenNeverType } from './whenNeverType'
import { whenPrototypesDontMatch } from './whenPrototypesDontMatch'
import { whenMismatchedOrMissingTypes } from './whenMismatchedOrMissingTypes'
import { IPromptFix, ReplacementType } from '../types'
import { cacheFile, saveOutput } from '../cacheFile'
import { getNodeLink, typeToStringLike, getNodeModules, getInferredInterface, capitalize } from '../utils'

//======================================================================
//======================================================================
//======================================================================
//   ____  _                                                     _      __ _
//  / ___|| |__   _____      __  _ __  _ __ ___  _ __ ___  _ __ | |_   / _(_)_  _____  ___
//  \___ \| '_ \ / _ \ \ /\ / / | '_ \| '__/ _ \| '_ ` _ \| '_ \| __| | |_| \ \/ / _ \/ __|
//   ___) | | | | (_) \ V  V /  | |_) | | | (_) | | | | | | |_) | |_  |  _| |>  <  __/\__ \
//  |____/|_| |_|\___/ \_/\_/   | .__/|_|  \___/|_| |_| |_| .__/ \__| |_| |_/_/\_\___||___/
//                              |_|                       |_|
//======================================================================
//======================================================================
//======================================================================

export async function showPromptFixes(problems, context, stack) {
  // prompt user for which fix they want, fixes if any
  const promptFixes: IPromptFix[] = []
  const whenContext = {
    problems,
    context,
    stack,
    sourceName: context.functionName ? 'argument' : 'source',
    targetName: context.functionName ? 'parameter' : 'target',
    suggest: suggest.bind(null, context),
    addChoice: addChoice.bind(null, context, promptFixes),
  }
  whenPrototypesDontMatch(whenContext)
  whenArraysDontMatch(whenContext)
  whenMismatchedOrMissingTypes(whenContext)
  whenUndefinedTypeDoesntMatch(whenContext)
  whenNeverType(whenContext)
  return await chooseFixes(promptFixes, context)
}

//======================================================================
//======================================================================
//======================================================================
//    ____                _                                                 _      __ _
//   / ___|_ __ ___  __ _| |_ ___    __ _   _ __  _ __ ___  _ __ ___  _ __ | |_   / _(_)_  __
//  | |   | '__/ _ \/ _` | __/ _ \  / _` | | '_ \| '__/ _ \| '_ ` _ \| '_ \| __| | |_| \ \/ /
//  | |___| | |  __/ (_| | ||  __/ | (_| | | |_) | | | (_) | | | | | | |_) | |_  |  _| |>  <
//   \____|_|  \___|\__,_|\__\___|  \__,_| | .__/|_|  \___/|_| |_| |_| .__/ \__| |_| |_/_/\_\
//                                         |_|                       |_|
//======================================================================
//======================================================================
//======================================================================

function addChoice(context, promptFixes, prompt, description, nodeInfos) {
  const { cache, fileCache } = context

  // if any changes would be to node modules, just use a suggestion
  const nodeModules = getNodeModules(cache, nodeInfos)
  if (nodeModules) {
    suggest(
      context,
      `Problem is in an external library ${chalk.green(nodeModules)}. Ignore the error`,
      getNodeLink(context.errorNode),
      [
        '// eslint-disable-next-line @typescript-eslint/ban-ts-comment',
        `// @ts-expect-error: Fix required in ${nodeModules}`,
      ]
    )
    return
  }

  // else add a choice
  let sourceFix = promptFixes.find((fix) => fix.prompt === prompt)
  if (!sourceFix) {
    sourceFix = {
      prompt,
      choices: [],
    }
    promptFixes.push(sourceFix)
  }
  const replacements: any = []
  const choice = {
    description,
    replacements,
  }

  // all changes that require a new interface
  const { remainingInfos } = getObjectLiteralInfos(context, choice, nodeInfos)

  // changes that don't require a new interface
  remainingInfos.forEach(({ primeInfo, otherInfo, type }) => {
    // get output node (location in output file we will be making changes)
    let inputNode = cache.getNode(primeInfo.declaredId || primeInfo.nodeId)
    let fileName = inputNode.getSourceFile().fileName
    let outputCache = fileCache[fileName]
    if (!outputCache) {
      outputCache = fileCache[fileName] = cacheFile(inputNode.getSourceFile())
    }
    const outputNode = outputCache.startToOutputNode[inputNode.getStart()]
    const replacement = getReplacement(context, type, fileName, outputNode, primeInfo, otherInfo)
    if (replacement) {
      replacements.push(replacement)
    }
  })

  // add choice
  if (replacements.length) {
    sourceFix.choices.push(choice)
  }
}

//======================================================================
//======================================================================
//======================================================================
//    ____      _      __ _                       _                                     _
//   / ___| ___| |_   / _(_)_  __  _ __ ___ _ __ | | __ _  ___ ___ _ __ ___   ___ _ __ | |_
//  | |  _ / _ \ __| | |_| \ \/ / | '__/ _ \ '_ \| |/ _` |/ __/ _ \ '_ ` _ \ / _ \ '_ \| __|
//  | |_| |  __/ |_  |  _| |>  <  | | |  __/ |_) | | (_| | (_|  __/ | | | | |  __/ | | | |_
//   \____|\___|\__| |_| |_/_/\_\ |_|  \___| .__/|_|\__,_|\___\___|_| |_| |_|\___|_| |_|\__|
//                                         |_|
//======================================================================
//======================================================================
//======================================================================

function getReplacement(context, type: ReplacementType, fileName, outputNode: ts.Node, primeInfo, otherInfo) {
  const { checker, cache } = context
  if (otherInfo && !otherInfo.type) {
    otherInfo.type = cache.getType(otherInfo.typeId)
  }
  switch (type) {
    case ReplacementType.convertType: {
      switch (true) {
        case !!(otherInfo.type.flags & ts.TypeFlags.NumberLike):
          if (primeInfo.type.flags & ts.TypeFlags.Literal) {
            if (primeInfo.type.flags & ts.TypeFlags.StringLiteral) {
              if (!Number.isNaN(Number(primeInfo.nodeText.replace(/["']/g, '')))) {
                return {
                  fileName,
                  replace: `${primeInfo.nodeText.replace(/['"]+/g, '')}`,
                  beg: outputNode.getStart(),
                  end: outputNode.getEnd(),
                }
              } else {
                return {
                  fileName,
                  replace: `Number(${primeInfo.nodeText})`,
                  beg: outputNode.getStart(),
                  end: outputNode.getEnd(),
                }
              }
            }
          }
          break
        case !!(otherInfo.type.flags & ts.TypeFlags.StringLike):
          if (!Number.isNaN(Number(primeInfo.nodeText))) {
            return {
              fileName,
              replace: `'${primeInfo.nodeText}'`,
              beg: outputNode.getStart(),
              end: outputNode.getEnd(),
            }
          } else {
            return {
              fileName,
              replace: `${primeInfo.nodeText.replace(/['"]+/g, '')}`,
              beg: outputNode.getEnd(),
              end: outputNode.getEnd(),
            }
          }
        case !!(otherInfo.type.flags & ts.TypeFlags.BooleanLike):
          return {
            fileName,
            replace: `!!${primeInfo.nodeText}`,
            beg: outputNode.getStart(),
            end: outputNode.getEnd(),
          }
      }

      break
    }
    case ReplacementType.unionType: {
      // Union type-- get location of type declaration and replace with a union
      let beg: number
      let end: number
      // if type declared after node, replace ': type' with union
      const children = outputNode.parent.getChildren()
      if (children[1].kind === ts.SyntaxKind.ColonToken) {
        beg = children[1].getStart()
        end = children[2].getEnd()
      } else {
        // if no type after node, insert union after node
        beg = outputNode.getEnd()
        end = beg
      }
      const sourceTypeLike = typeToStringLike(checker, otherInfo.type)
      return {
        fileName,
        replace: `:${primeInfo.typeText} | ${sourceTypeLike}`,
        beg,
        end,
      }
    }
    case ReplacementType.makeOptional: {
      const children = outputNode.parent.getChildren()
      if (children[1].kind === ts.SyntaxKind.ColonToken) {
        return {
          fileName,
          replace: '?',
          beg: children[1].getStart(),
          end: children[1].getStart(),
        }
      }
    }
    case ReplacementType.insertProperty:
    case ReplacementType.insertOptionalProperty: {
      const brace = outputNode.getChildren().filter(({ kind }) => kind === ts.SyntaxKind.CloseBraceToken)[0]
      const typeText = otherInfo.type ? typeToStringLike(checker, otherInfo.type) : otherInfo.typeText
      return {
        fileName,
        replace: `${otherInfo.nodeText}${type === ReplacementType.insertOptionalProperty ? '?' : ''}: ${typeText},`,
        beg: brace.getStart(),
        end: brace.getStart(),
      }
    }
    case ReplacementType.castType: {
      break
    }
  }
}

function getObjectLiteralInfos(context, choice, nodeInfos) {
  const { checker, cache, fileCache } = context

  // separate choice targets that are literal objects
  const literalInfos: any[] = []
  const remainingInfos: any[] = []
  nodeInfos.forEach((info) => {
    let type = info.primeInfo.type ? info.primeInfo.type : cache.getType(info.primeInfo.typeId)
    if (info.type === ReplacementType.unionType && info.primeInfo.parentInfo) {
      info.targetInfo = info.primeInfo
      info.primeInfo = info.primeInfo.parentInfo
      type = info.primeInfo.type = cache.getType(info.primeInfo.typeId)
    }
    const symbol = type.getSymbol()
    if (symbol && symbol.flags & ts.SymbolFlags.ObjectLiteral) {
      literalInfos.push(info)
    } else {
      remainingInfos.push(info)
    }
  })

  // for choices that target literal objects, create a single replacement
  if (literalInfos.length) {
    choice.description = `Create interface. ${choice.description}`
    const groupedByLiteralType = groupBy(literalInfos, 'primeInfo.typeId')
    Object.values(groupedByLiteralType).forEach((fixInfos) => {
      const targetType = fixInfos[0].primeInfo.type
      const symbol = targetType.getSymbol()
      const declarations = symbol?.getDeclarations()
      if (declarations) {
        const declaration = declarations[0]
        const inputNode = declaration.parent.getChildren()[0]

        let fileName = inputNode.getSourceFile().fileName
        let outputCache = fileCache[fileName]
        if (!outputCache) {
          outputCache = fileCache[fileName] = cacheFile(inputNode.getSourceFile())
        }
        const outputNode = outputCache.startToOutputNode[inputNode.getStart()]

        // create the information needed to create an interface replacement
        // when the choices are applied to a file
        choice.replacements.push({
          fileName,
          outputNode,
          interfaceName: `J${capitalize(outputNode.escapedText)}`,
          inferredInterface: getInferredInterface(checker, targetType, true),
          fixInfos,
        })
      }
    })
  }

  return { remainingInfos }
}

//======================================================================
//======================================================================
//======================================================================
//   ____                           _          _           _                 _
//  |  _ \ _ __ ___  ___  ___ _ __ | |_    ___| |__   ___ (_) ___ ___  ___  | |_ ___    _   _ ___  ___ _ __
//  | |_) | '__/ _ \/ __|/ _ \ '_ \| __|  / __| '_ \ / _ \| |/ __/ _ \/ __| | __/ _ \  | | | / __|/ _ \ '__|
//  |  __/| | |  __/\__ \  __/ | | | |_  | (__| | | | (_) | | (_|  __/\__ \ | || (_) | | |_| \__ \  __/ |
//  |_|   |_|  \___||___/\___|_| |_|\__|  \___|_| |_|\___/|_|\___\___||___/  \__\___/   \__,_|___/\___|_|
//======================================================================
//======================================================================
//======================================================================

async function chooseFixes(promptFixes, context) {
  let anyQuit = false
  // async/await hates map when it's user input
  for (let promptFix of promptFixes) {
    const { prompt, choices } = promptFix
    if (choices.length) {
      const questions = [
        {
          type: 'rawlist',
          name: 'fix',
          message: prompt,
          choices: ['No', 'Quit', ...choices.map((choice: any) => choice.description)],
        },
      ]
      const pick = await inquirer.prompt(questions)
      if (pick.fix === 'Quit') {
        anyQuit = true
        break
      } else if (pick.fix !== 'No') {
        const pickedFix = choices.find((choice) => choice.description === pick.fix)
        if (pickedFix) {
          const description = `${chalk.white(prompt)}: ${pickedFix.description}`
          pickedFix.replacements.forEach((replacement) => {
            const sourceFixes = context.fileCache[replacement.fileName].sourceFixes
            // if this replacement doesn't overlap another in this file
            if (
              sourceFixes.every(({ replacements }) => {
                return (
                  !!replacements[0].interfaceName ||
                  replacements.findIndex(
                    ({ beg, replace }) => beg === replacement.beg && replace === replacement.replace
                  ) === -1
                )
              })
            ) {
              let sourceFix = sourceFixes.find((sfix) => {
                sfix.description === description
              })
              if (!sourceFix) {
                sourceFix = {
                  description,
                  replacements: [],
                }
                context.fileCache[replacement.fileName].sourceFixes.push(sourceFix)
              }
              sourceFix.replacements.push(replacement)
            }
          })
        }
      }
    }
  }
  return anyQuit
}
//======================================================================
//======================================================================
//======================================================================
//      _                _                         _   ____                     __ _
//     / \   _ __  _ __ | |_   _    __ _ _ __   __| | / ___|  __ ___   _____   / _(_)_  _____  ___
//    / _ \ | '_ \| '_ \| | | | |  / _` | '_ \ / _` | \___ \ / _` \ \ / / _ \ | |_| \ \/ / _ \/ __|
//   / ___ \| |_) | |_) | | |_| | | (_| | | | | (_| |  ___) | (_| |\ V /  __/ |  _| |>  <  __/\__ \
//  /_/   \_\ .__/| .__/|_|\__, |  \__,_|_| |_|\__,_| |____/ \__,_| \_/ \___| |_| |_/_/\_\___||___/
//          |_|   |_|      |___/
//======================================================================
//======================================================================
//======================================================================

export async function applyFixes(checker, fileCache) {
  const summary: string[] = []
  const fileFixes = {}
  for (const fileName of Object.keys(fileCache)) {
    const { sourceFixes } = fileCache[fileName]
    if (sourceFixes.length) {
      const shortName = fileName.split('/').pop()
      summary.push(`  File: ${chalk.cyanBright(shortName)}`)
      const replacements: any[] = []
      fileFixes[fileName] = {
        shortName,
        output: fileCache[fileName].outputFileString,
        replacements,
      }
      sourceFixes.forEach((fix: { description: string; replacements: any[] }) => {
        summary.push(`   ${fix.description}`)
        replacements.push(fix.replacements)
      })
    }
  }

  if (summary.length) {
    console.log(`\n\nSave fixes for:`)
    summary.forEach((line) => console.log(line))
    const questions = [
      {
        type: 'confirm',
        name: 'toBeFixed',
        message: 'Save?',
        default: true,
      },
    ]
    const answer = await inquirer.prompt(questions)
    if (answer.toBeFixed) {
      console.log('')
      for (const fileName of Object.keys(fileFixes)) {
        const fixes = fileFixes[fileName]
        const replacements = getResolvedReplacements(checker, fixes.replacements.flat())

        // apply the fixes--last first to preserve positions of above changes
        replacements.sort((a: { beg: number }, b: { beg: number }) => {
          return b.beg - a.beg
        })

        // do replacements
        let output = fixes.output
        replacements.forEach(({ beg, end, replace }) => {
          output = `${output.substring(0, beg)}${replace}${output.substring(end)}`
        })

        saveOutput(fileName, output)
        console.log(`-- fixed and saved: ${chalk.cyanBright(fixes.shortName)}--`)
      }
    }
  } else {
    console.log(`\n--no automatic fixes--`)
  }
}

function getResolvedReplacements(checker, replacements) {
  const resolvedReplacements: any = []
  const interfaceReplacements: any = {}

  replacements.forEach((replacement) => {
    const { interfaceName } = replacement
    if (interfaceName) {
      let arr = interfaceReplacements[interfaceName]
      if (!arr) {
        arr = interfaceReplacements[interfaceName] = []
      }
      arr.push(replacement)
    } else {
      resolvedReplacements.push(replacement)
    }
  })

  Object.keys(interfaceReplacements).forEach((iinterface) => {
    const { fileName, interfaceName, outputNode, inferredInterface } = interfaceReplacements[iinterface][0]
    // create replacement that will add IXxx to var val: IXxx = {}
    resolvedReplacements.push({
      fileName,
      replace: `: ${interfaceName}`,
      beg: outputNode.getEnd(),
      end: outputNode.getEnd(),
    })

    // apply changes to the inferred object literal
    interfaceReplacements[iinterface].forEach(({ fixInfos }) => {
      fixInfos.forEach(({ targetInfo, otherInfo, type }) => {
        switch (type) {
          case ReplacementType.unionType:
            inferredInterface[targetInfo.nodeText] = `${inferredInterface[targetInfo.nodeText]} | ${typeToStringLike(
              checker,
              otherInfo.type
            )}`
            break
          case ReplacementType.makeOptional:
            const save = inferredInterface[targetInfo.nodeText]
            inferredInterface[targetInfo.nodeText + '?'] = save
            break
          case ReplacementType.insertProperty:
            inferredInterface[otherInfo.nodeText] = otherInfo.typeText
            break
          case ReplacementType.insertOptionalProperty:
            inferredInterface[otherInfo.nodeText + '?'] = otherInfo.typeText
            break
        }
      })
    })

    // create replacement that will contain the interface content
    const statement =
      ts.findAncestor(outputNode, (node) => {
        return !!node && node.kind === ts.SyntaxKind.VariableStatement
      }) || outputNode
    const content = JSON.stringify(inferredInterface).replace(/\\"/g, "'").replace(/"/g, '').replace(/,/g, '\n')
    const interfaceReplacement = {
      fileName,
      replace: `interface ${interfaceName} ${content}\n`,
      beg: statement.getStart(),
      end: statement.getStart(),
    }
    resolvedReplacements.push(interfaceReplacement)
  })

  return resolvedReplacements
}

//======================================================================
//======================================================================
//======================================================================
//   ____                              _
//  / ___| _   _  __ _  __ _  ___  ___| |_
//  \___ \| | | |/ _` |/ _` |/ _ \/ __| __|
//   ___) | |_| | (_| | (_| |  __/\__ \ |_
//  |____/ \__,_|\__, |\__, |\___||___/\__|
//               |___/ |___/
//======================================================================
//======================================================================
//======================================================================

function suggest(context, msg: string, link?: string, code?: string | string[]) {
  let multiLine = false
  context.hadSuggestions = true
  let codeMsg = ''
  if (code) {
    multiLine = Array.isArray(code) || code.length > 64
    if (!multiLine) {
      codeMsg = `with this ${chalk.greenBright(code)}`
    }
  }
  const linkMsg = link ? chalk.blueBright(link) : ''
  console.log(chalk.whiteBright(`${msg}${codeMsg ? ` ${codeMsg}` : ''}${linkMsg ? ` here:\n  ${linkMsg}` : ''}`))
  if (multiLine) {
    if (Array.isArray(code)) {
      code.forEach((line) => {
        console.log(`       ${chalk.greenBright(line)}`)
      })
    } else {
      console.log(chalk.greenBright(codeMsg))
    }
  }
}
