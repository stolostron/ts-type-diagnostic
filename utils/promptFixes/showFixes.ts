/* Copyright Contributors to the Open Cluster Management project */

import chalk from 'chalk'
import inquirer from 'inquirer'

import { whenArraysDontMatch } from './whenArraysDontMatch'
import { whenUndefinedTypeDoesntMatch } from './whenUndefinedTypeDoesntMatch'
import { whenNeverType } from './whenNeverType'
import { whenPrototypesDontMatch } from './whenPrototypesDontMatch'
import { whenMismatchedOrMissingTypes } from './whenMismatchedOrMissingTypes'
import { IPromptFix, ReplacementType } from '../types'
import { cacheFile, saveOutput } from '../cacheFile'
import ts from 'typescript'
import { getNodeLink, typeToStringLike } from '../utils'

//======================================================================
//======================================================================
//======================================================================
//   ____                            _     _____ _
//  |  _ \ _ __ ___  _ __ ___  _ __ | |_  |  ___(_)_  _____  ___
//  | |_) | '__/ _ \| '_ ` _ \| '_ \| __| | |_  | \ \/ / _ \/ __|
//  |  __/| | | (_) | | | | | | |_) | |_  |  _| | |>  <  __/\__ \
//  |_|   |_|  \___/|_| |_| |_| .__/ \__| |_|   |_/_/\_\___||___/
//                            |_|
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

function addChoice(context, promptFixes, prompt, description, nodeInfos) {
  const { cache, fileCache } = context

  // get this fix
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
  // get replacements for this choice
  const libs = new Set()
  nodeInfos.forEach(({ primeInfo, otherInfo, type }) => {
    // get output node (location in output file we will be making changes)
    let inputNode = cache.getNode(primeInfo.declaredId || primeInfo.nodeId)
    let fileName = inputNode.getSourceFile().fileName
    // can't make changes to a library
    if (fileName.indexOf('/node_modules/') !== -1) {
      const arr = fileName.split('node_modules/')[1].split('/')
      let lib = arr[0]
      if (lib.startsWith('@')) {
        lib += `/${arr[1]}`
      }
      libs.add(lib)
    } else {
      let outputCache = fileCache[fileName]
      if (!outputCache) {
        outputCache = fileCache[fileName] = cacheFile(inputNode.getSourceFile())
      }
      const outputNode = outputCache.startToOutputNode[inputNode.getStart()]
      const replacement = getReplacement(context, type, fileName, outputNode, primeInfo, otherInfo)
      if (replacement) {
        replacements.push(replacement)
      }
    }
  })

  if (libs.size) {
    const externalLibs = `'${Array.from(libs).join(', ')}'`
    suggest(
      context,
      `Problem is in an external library ${chalk.green(externalLibs)}. Ignore the error`,
      getNodeLink(context.errorNode),
      [
        '// eslint-disable-next-line @typescript-eslint/ban-ts-comment',
        `// @ts-expect-error: Fix required in ${externalLibs}`,
      ]
    )
  } else if (replacements.length) {
    // add choice
    choice.replacements = replacements.flat()
    sourceFix.choices.push(choice)
  }
}

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
              sourceFixes.every((fix) => {
                return (
                  fix.replacements.findIndex(
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

export async function applyFixes(fileCache) {
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
        const replacements = fixes.replacements.flat()

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
  console.log(chalk.whiteBright(`${msg}${codeMsg ? ` ${codeMsg}` : ''}${linkMsg ? ` here: ${linkMsg}` : ''}`))
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
    case ReplacementType.disableError: {
      // const comment = [
      //   '// eslint-disable-next-line @typescript-eslint/ban-ts-comment\n',
      //   `// @ts-expect-error: Fix required in ${externalLibs}\n`,
      // ]
      break
    }
    case ReplacementType.deleteProperty: {
      break
    }
    case ReplacementType.makeInterfacePartial: {
      break
    }
  }
}
