/* Copyright Contributors to the Open Cluster Management project */

import chalk from 'chalk'
import inquirer from 'inquirer'

import { whenSimpleTypesDontMatch } from './whenSimpleTypesDontMatch'
import { whenCallArgumentsDontMatch } from './whenCallArgumentsDontMatch'
import { whenArraysDontMatch } from './whenArraysDontMatch'
import { whenUndefinedTypeDoesntMatch } from './whenUndefinedTypeDoesntMatch'
import { whenNeverType } from './whenNeverType'
import { whenPrototypesDontMatch } from './whenPrototypesDontMatch'
import { whenTypeShapesDontMatch } from './whenTypeShapesDontMatch'
import { IPromptFix } from '../types'
import { cacheFile, saveOutput } from '../cacheFile'

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
  whenCallArgumentsDontMatch(whenContext)
  //whenSimpleTypesDontMatch(whenContext)
  whenTypeShapesDontMatch(whenContext)
  whenArraysDontMatch(whenContext)
  whenUndefinedTypeDoesntMatch(whenContext)
  whenNeverType(whenContext)
  whenPrototypesDontMatch(whenContext)
  return await chooseFixes(promptFixes, context)
}

function addChoice(context, promptFixes, prompt, primaryInfo, secondaryInfo, cb) {
  const { cache, fileCache } = context

  // get output node (location in output file we will be making changes)
  const primaryNode = cache.getNode(primaryInfo.declaredId || primaryInfo.nodeId)
  const fileName = primaryNode.getSourceFile().fileName
  let outputCache = fileCache[fileName]
  if (!outputCache) {
    outputCache = fileCache[fileName] = cacheFile(primaryNode.getSourceFile())
  }
  const outputNode = outputCache.startToOutputNode[primaryNode.getStart()]

  // get current choices
  let sourceFix = promptFixes.find((fix) => fix.prompt === prompt)
  if (!sourceFix) {
    sourceFix = {
      prompt,
      choices: [],
    }
    promptFixes.push(sourceFix)
  }

  // add choice
  const choice = cb(outputNode)
  choice.fileName = fileName
  sourceFix.choices.push(choice)

  //   If node has a node declaration
  //    node == declaration
  // node.getSourceFile
  // If source file is in node_modules
  //    Fix = Change fix to //comment disable
  // Else
  //    Get filename cache from  sourceFixCache
  //     If empty,
  //         Const mapNodeOrder={}
  //         If nodeToSource if empty
  //            Create output file
  //            mapNodesToSource()
  //     Get nodeToOutputfile from sourceFixCache
  //    If undefined
  //       load sourceFile into string
  //    Fix = cb(node from output file)
  // If fixes already have a fix at fix’s beg, no prompt
  //    Just console.log fix’s description
  // Else
  //    Show prompt
  //    Add to fixes on this file
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
        const fix = choices.find((choice) => choice.description === pick.fix)
        if (fix) {
          fix.description = `${chalk.white(prompt)}: ${fix.description}`
          context.fileCache[fix.fileName].sourceFixes.push(fix)
        }
      }
    }
  }
  return anyQuit
}

export async function applyFixes(fileCache) {
  let anyFixes = false
  for (const fileName of Object.keys(fileCache)) {
    const { sourceFixes } = fileCache[fileName]
    if (sourceFixes.length) {
      const shortName = fileName.split('/').pop()
      if (await shouldApplyFixes(shortName, sourceFixes)) {
        // get the output file as text
        let output: string = fileCache[fileName].outputFileString
        // apply the fixes--last first to preserve positions of above changes
        sourceFixes.sort((a: { beg: number }, b: { beg: number }) => {
          return b.beg - a.beg
        })
        sourceFixes.forEach(({ beg, end, replace }) => {
          output = `${output.substring(0, beg)}${replace}${output.substring(end)}`
        })

        saveOutput(fileName, output)
        console.log(`\n--${chalk.cyanBright(shortName)} saved--`)
      }
      anyFixes = true
    }
  }
  if (!anyFixes) {
    console.log(`\n--no automatic fixes--`)
  }
}

async function shouldApplyFixes(fileName, sourceFixes) {
  if (!sourceFixes.length) return false
  console.log(`\n\nSave fixes for ${chalk.cyanBright(fileName)}?`)
  sourceFixes.forEach((fix: { description: string }) => console.log(` ${fix.description}`))
  const questions = [
    {
      type: 'confirm',
      name: 'toBeFixed',
      message: 'Save?',
      default: true,
    },
  ]
  const answer = await inquirer.prompt(questions)
  return answer.toBeFixed
}

function suggest(context, msg: string, link?: string, code?: string) {
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
