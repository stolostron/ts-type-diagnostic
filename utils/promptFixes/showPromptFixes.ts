/* Copyright Contributors to the Open Cluster Management project */

import chalk from 'chalk'

import { whenSimpleTypesDontMatch } from './whenSimpleTypesDontMatch'
import { whenCallArgumentsDontMatch } from './whenCallArgumentsDontMatch'
import { whenProblemIsInExternalLibrary } from './whenProblemIsInExternalLibrary'
import { whenArraysDontMatch } from './whenArraysDontMatch'
import { whenUndefinedTypeDoesntMatch } from './whenUndefinedTypeDoesntMatch'
import { whenNeverType } from './whenNeverType'
import { whenPrototypesDontMatch } from './whenPrototypesDontMatch'
import { whenTypeShapesDontMatch } from './whenTypeShapesDontMatch'

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

export function showPromptFixes(problems, context, stack) {
  // unified suggestion method
  const suggest = (msg: string, link?: string, code?: string) => {
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

  const whenContext = {
    problems,
    context,
    stack,
    suggest,
  }
  whenCallArgumentsDontMatch(whenContext)
  whenSimpleTypesDontMatch(whenContext)
  whenProblemIsInExternalLibrary(whenContext)
  whenTypeShapesDontMatch(whenContext)
  whenArraysDontMatch(whenContext)
  whenUndefinedTypeDoesntMatch(whenContext)
  whenNeverType(whenContext)
  whenPrototypesDontMatch(whenContext)
}
