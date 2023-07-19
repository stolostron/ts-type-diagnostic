/* Copyright Contributors to the Open Cluster Management project */

import path from 'path'
import ts from 'typescript'
import { findProblems } from './findProblems'
import { getClosestTarget, getNodeLink, getFileLink } from './utils'
import { showProblemTables, showTableNotes } from './showTables'
import { applyFixes, showPromptFixes } from './promptFixes/showFixes'
import { cacheFile } from './cacheFile'
import os from 'os'
import './globals'
import chalk from 'chalk'
import inquirer from 'inquirer'

global.options = {
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.CommonJS,
}
global.isVerbose = false
let checker: ts.TypeChecker

// errors we ignore
const ignoreTheseErrors = [6133, 6142, 2304, 2305, 2448, 2454, 2593, 7005, 7006, 7016, 7031]

//======================================================================
//======================================================================
//======================================================================
//   ____        _  __  __ _
//  / ___| _ __ (_)/ _|/ _(_)_ __   __ _
//  \___ \| '_ \| | |_| |_| | '_ \ / _` |
//   ___) | | | | |  _|  _| | | | | (_| |
//  |____/|_| |_|_|_| |_| |_|_| |_|\__, |
//                                 |___/
//======================================================================
//======================================================================
//======================================================================

export async function startSniffing(fileNames: string | any[] | readonly string[], verbose: boolean) {
  // Read tsconfig.json file
  if (Array.isArray(fileNames) && fileNames.length > 0) {
    const tsconfigPath = ts.findConfigFile(fileNames[0], ts.sys.fileExists, 'tsconfig.json')
    if (tsconfigPath) {
      const tsconfigFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
      global.options = ts.parseJsonConfigFileContent(tsconfigFile.config, ts.sys, path.dirname(tsconfigPath)).options
      global.rootPath = tsconfigPath
    }
    global.isVerbose = verbose
    global.homedir = os.homedir()

    console.log("Waking 'the hound'...")
    const program = ts.createProgram(fileNames, options)
    checker = program.getTypeChecker()
    const syntaxErrors = program.getSyntacticDiagnostics()
    if (!(await fixSyntax(syntaxErrors))) {
      console.log("Releasing 'the hound'...")
      startFixing(program.getSemanticDiagnostics(), fileNames)
    }
  } else {
    console.log('No files specified.')
  }
}

//======================================================================
//======================================================================
//======================================================================
//   _____ _      _
//  |  ___(_)_  _(_)_ __   __ _
//  | |_  | \ \/ / | '_ \ / _` |
//  |  _| | |>  <| | | | | (_| |
//  |_|   |_/_/\_\_|_| |_|\__, |
//                        |___/
//======================================================================
//======================================================================
//======================================================================
async function startFixing(semanticDiagnostics: readonly ts.Diagnostic[], fileNames: string[]) {
  let hadProblem = false
  let anyProblem = false
  const fileCache = {}
  const missingSupport: string[] = []
  const processedNodes = new Set()
  console.log('\n\n')

  const programContext = {
    checker,
    fileCache,
  }

  let allProblems: { problems: any[]; suggestions?: string[]; stack: any[]; context: any }[] = []
  semanticDiagnostics.forEach(({ code: errorCode, file, start }) => {
    if (file && fileNames.includes(file.fileName)) {
      const fileName = file.fileName
      let cache = fileCache[fileName]
      if (!cache) {
        cache = fileCache[fileName] = cacheFile(file)
      }
      if (start) {
        let errorNode = cache.startToNode[start]
        if (errorNode) {
          if (!ignoreTheseErrors.includes(errorCode)) {
            hadProblem = false
            const closestTargetNode = getClosestTarget(checker, errorNode)
            start = closestTargetNode.getStart()
            // compiler might throw multiple errors for the same problem -- only process one of them
            if (!processedNodes.has(start)) {
              const problems = findProblems(programContext, errorCode, errorNode, closestTargetNode, start, cache)
              if (problems.length) {
                allProblems = [...allProblems, ...problems]
                processedNodes.add(start)
                hadProblem = true
              } else {
                missingSupport.push(
                  `For error ${errorCode}, missing support ${ts.SyntaxKind[closestTargetNode.kind]} ${start}`
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

  // show problems, prompt for fixes
  let anyQuit = false
  for (const problem of allProblems) {
    const { problems, suggestions, stack, context } = problem
    if (suggestions) {
      suggestions.forEach((sug) => console.log(sug))
    } else {
      showProblemTables(problems, context, stack)
      showTableNotes(problems, context)
      anyQuit = await showPromptFixes(problems, context, stack)
      console.log('\n\n')
      if (anyQuit) {
        break
      }
    }
  }
  if (anyQuit) return

  // apply fixes, save files
  if (anyProblem) {
    await applyFixes(checker, fileCache)
  }

  // show things we didn't know how to process
  if (missingSupport.length > 0) {
    missingSupport.forEach((miss) => console.log(miss))
  } else if (!anyProblem) {
    console.log(`\n--no squirrels--`)
  }
  console.log('\n\n--------------------------------------------------------------------------')
}

export async function fixSyntax(syntaxErrors) {
  if (syntaxErrors.length) {
    console.log('\n\nWarning: for best results, fix syntax errors before fixing semantic errors:\n')
    syntaxErrors.forEach(({ code, messageText, file, start }) => {
      console.log(`  ${code} ${messageText}\n     ${chalk.blue(getFileLink(file, start))}`)
    })
    const questions = [
      {
        type: 'confirm',
        name: 'toBeFixed',
        message: '\n\nStop to fix syntax errors?',
        default: false,
      },
    ]
    const answer = await inquirer.prompt(questions)
    return answer.toBeFixed
  }
  return false
}
