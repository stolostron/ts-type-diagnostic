/* Copyright Contributors to the Open Cluster Management project */

import chalk from 'chalk'
import ts from 'typescript'

import { ErrorType } from './types'
import { getNodeLink, isFunctionType, isStructuredType, typeToStringLike } from './utils'

//======================================================================
//======================================================================
//======================================================================
// ____                              _   _
// / ___| _   _  __ _  __ _  ___  ___| |_(_) ___  _ __  ___
// \___ \| | | |/ _` |/ _` |/ _ \/ __| __| |/ _ \| '_ \/ __|
//  ___) | |_| | (_| | (_| |  __/\__ \ |_| | (_) | | | \__ \
// |____/ \__,_|\__, |\__, |\___||___/\__|_|\___/|_| |_|___/
//              |___/ |___/
//======================================================================
//======================================================================
//======================================================================

export function showSuggestions(problems, context, stack) {
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

//======================================================================
//======================================================================
//======================================================================
//   ____  _                 _
//  / ___|(_)_ __ ___  _ __ | | ___
//  \___ \| | '_ ` _ \| '_ \| |/ _ \
//   ___) | | | | | | | |_) | |  __/
//  |____/|_|_| |_| |_| .__/|_|\___|
//                    |_|
//======================================================================
//======================================================================
//======================================================================

function whenSimpleTypesDontMatch({ stack, context, suggest }) {
  if (context.captured) return
  const { checker } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (context.errorType === ErrorType.mismatch) {
    const source = chalk.green(sourceInfo.nodeText)
    const target = chalk.green(targetInfo.nodeText)
    switch (true) {
      case !!(targetInfo.type.flags & ts.TypeFlags.NumberLike):
        if (sourceInfo.type.flags & ts.TypeFlags.Literal) {
          if (sourceInfo.type.flags & ts.TypeFlags.StringLiteral) {
            if (!Number.isNaN(Number(sourceInfo.nodeText.replace(/["']/g, '')))) {
              suggest(`Remove quotes from ${source}`, sourceInfo.nodeLink)
            }
          }
        } else {
          suggest(`Convert ${source} to number`, sourceInfo.nodeLink, `Number(${sourceInfo.nodeText})`)
        }
        break
      case !!(targetInfo.type.flags & ts.TypeFlags.StringLike):
        if (!Number.isNaN(Number(sourceInfo.nodeText))) {
          suggest(`Add quotes to '${source}'`, sourceInfo.nodeLink)
        } else {
          suggest(`Convert ${source} to string`, sourceInfo.nodeLink, `String(${sourceInfo.nodeText}).toString()`)
        }
        break
      case !!(targetInfo.type.flags & ts.TypeFlags.BooleanLike):
        suggest(
          `Convert ${source} to boolean`,
          sourceInfo.nodeLink,
          `${targetInfo.nodeText} = !!${sourceInfo.nodeText}`
        )
        break
    }
    const sourceTypeLike = typeToStringLike(checker, sourceInfo.type)
    const targetLink = context.targetDeclared ? getNodeLink(context.targetDeclared) : targetInfo.nodeLink
    suggest(
      `Union ${target} with ${chalk.green(sourceTypeLike)}`,
      targetLink,
      `${targetInfo.fullText} | ${sourceTypeLike}`
    )
  }
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//      _                                         _
//     / \   _ __ __ _ _   _ _ __ ___   ___ _ __ | |_ ___
//    / _ \ | '__/ _` | | | | '_ ` _ \ / _ \ '_ \| __/ __|
//   / ___ \| | | (_| | |_| | | | | | |  __/ | | | |_\__ \
//  /_/   \_\_|  \__, |\__,_|_| |_| |_|\___|_| |_|\__|___/
//               |___/
// ===============================================================================
// ===============================================================================
// ===============================================================================
function whenCallArgumentsDontMatch({ context, suggest }) {
  if (context.captured) return
  const { callingPairs } = context
  if (callingPairs && callingPairs.length > 1) {
    // see if arg types are mismatched
    const indexes: number[] = []
    if (
      // see if args are called in wrong order
      callingPairs.every(({ targetInfo }) => {
        if (targetInfo) {
          const targetTypeText = targetInfo.typeText
          return (
            callingPairs.findIndex(({ sourceInfo }, inx) => {
              if (sourceInfo) {
                const sourceTypeText = sourceInfo.typeText
                if (targetTypeText === sourceTypeText && !indexes.includes(inx + 1)) {
                  indexes.push(inx + 1)
                  return true
                }
              }
              return false
            }) !== -1
          )
        } else {
          return false
        }
      })
    ) {
      suggest(
        `Did you mean to call the arguments in this order ${chalk.greenBright(indexes.join(', '))}`,
        context.sourceLink
      )
      context.captured = true
    }
  }
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _____      _                        _
//  | ____|_  _| |_ ___ _ __ _ __   __ _| |
//  |  _| \ \/ / __/ _ \ '__| '_ \ / _` | |
//  | |___ >  <| ||  __/ |  | | | | (_| | |
//  |_____/_/\_\\__\___|_|  |_| |_|\__,_|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================

function whenProblemIsInExternalLibrary({ context, suggest }) {
  if (context.captured) return
  if (context?.externalLinks?.length) {
    const libs = new Set()
    context.externalLinks.forEach((link) => {
      const linkArr = link.split('node_modules/')[1].split('/')
      link = linkArr[0]
      if (link.startsWith('@')) {
        link += `/${linkArr[1]}`
      }
      libs.add(link)
    })
    const externalLibs = `'${Array.from(libs).join(', ')}'`
    suggest(
      `Problem is in an external library ${chalk.green(externalLibs)}. Ignore the error`,
      getNodeLink(context.errorNode),
      [
        '// eslint-disable-next-line @typescript-eslint/ban-ts-comment',
        `// @ts-expect-error: Fix required in ${externalLibs}`,
      ]
    )
    context.captured = false // TODO isVerbose
  }
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   ____  _
//  / ___|| |__   __ _ _ __   ___
//  \___ \| '_ \ / _` | '_ \ / _ \
//   ___) | | | | (_| | |_) |  __/
//  |____/|_| |_|\__,_| .__/ \___|
//                    |_|
// ===============================================================================
// ===============================================================================
// ===============================================================================

function whenTypeShapesDontMatch(context) {
  if (context.captured) return
  const layer = context.stack[context.stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (!isStructuredType(sourceInfo.type) && !isStructuredType(targetInfo.type)) return

  // some shape suggestions
  didYouMeanThisChildProperty(context)
  suggestPartialInterfaces(context)
}

// ===============================================================================
// when you use 'resource', but you should 'resource.resource' instead %-)
// ===============================================================================

function didYouMeanThisChildProperty({ suggest, context, stack }) {
  if (context.sourceMap) {
    const layer = stack[stack.length - 1]
    const { sourceInfo, targetInfo } = layer
    const match: any = Object.values(context.sourceMap).find((source: any) => {
      return !source.isFunc && source.typeText === targetInfo.typeText
    })
    if (match) {
      suggest(
        `Did you mean to use this ${chalk.magenta(
          `${sourceInfo.nodeText}.${match.nodeText}`
        )} instead of this ${chalk.magenta(sourceInfo.nodeText)}`,
        targetInfo.nodeLink
      )
    }
  }
}
// ===============================================================================
// when one side is has lots of required properties
// ===============================================================================
function suggestPartialInterfaces({ suggest, context }) {
  const partialInterfaces: any[] = []
  if (Object.keys(context?.missingInterfaceMaps?.sourceInterfaceMap || {}).length > 0) {
    Object.values(context.missingInterfaceMaps.sourceInterfaceMap).forEach((inter: any) => {
      const altParentInfo = inter[0].altParentInfo
      if (altParentInfo) {
        partialInterfaces.push(altParentInfo)
      }
    })
  }
  if (partialInterfaces.length) {
    partialInterfaces.forEach((altParentInfo) => {
      suggest(
        `Make the missing properties optional using ${chalk.greenBright(
          `interface Partial<${altParentInfo.typeText}>`
        )}`,
        altParentInfo.nodeLink
      )
    })
  }
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//      _
//     / \   _ __ _ __ __ _ _   _
//    / _ \ | '__| '__/ _` | | | |
//   / ___ \| |  | | | (_| | |_| |
//  /_/   \_\_|  |_|  \__,_|\__, |
//                          |___/
// ===============================================================================
// ===============================================================================
// ===============================================================================

function whenArraysDontMatch({ stack, suggest, context }) {
  if (context.captured) return
  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  switch (context.errorType) {
    case ErrorType.arrayToNonArray:
      suggest(
        `Did you mean to assign just one element of the ${chalk.greenBright(sourceInfo.nodeText)} array`,
        sourceInfo.nodeLink
      )
      break
    case ErrorType.nonArrayToArray:
      suggest(
        `Did you mean to push ${chalk.greenBright(sourceInfo.nodeText)} onto the ${chalk.greenBright(
          targetInfo.nodeText
        )} array`,
        targetInfo.nodeLink
      )
      break
  }
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _   _           _       __ _                _
//  | | | |_ __   __| | ___ / _(_)_ __   ___  __| |
//  | | | | '_ \ / _` |/ _ \ |_| | '_ \ / _ \/ _` |
//  | |_| | | | | (_| |  __/  _| | | | |  __/ (_| |
//   \___/|_| |_|\__,_|\___|_| |_|_| |_|\___|\__,_|
// ===============================================================================
// ===============================================================================
// ===============================================================================

function whenUndefinedTypeDoesntMatch({ problems, stack, context, suggest }) {
  if (context.captured) return
  const { checker } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (problems[0]?.targetInfo.typeText === 'undefined') {
    suggest(
      `Change the type of ${chalk.green(targetInfo.nodeText)} to ${chalk.green(
        typeToStringLike(checker, sourceInfo.type)
      )}`,
      context.targetDeclared ? getNodeLink(context.targetDeclared) : targetInfo.nodeLink
    )
  } else if (problems[0]?.sourceInfo.typeText === 'undefined') {
    suggest(
      `Union ${targetInfo.nodeText} type with ${chalk.green('| undefined')}`,
      context.targetDeclared ? getNodeLink(context.targetDeclared) : targetInfo.nodeLink,
      [`${chalk.greenBright(`${targetInfo.typeText} | undefined`)}`]
    )
  }
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   _   _
//  | \ | | _____   _____ _ __
//  |  \| |/ _ \ \ / / _ \ '__|
//  | |\  |  __/\ V /  __/ |
//  |_| \_|\___| \_/ \___|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
function whenNeverType({ suggest, problems, context, stack }) {
  if (context.captured) return
  const { checker } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (problems[0]?.sourceInfo.typeText === 'never[]' && context.targetDeclared) {
    suggest(
      `Declare the following type for ${chalk.green(context.targetDeclared.name.text)}`,
      getNodeLink(context.targetDeclared),
      [`${context.targetDeclared.name.text}: ${targetInfo.typeText}[]`]
    )
  } else if (problems[0]?.targetInfo.typeText.startsWith('never')) {
    suggest(`If the 'never' type was explicitly declared, determine what code path led to this point and fix it.`)
    suggest(
      `Otherwise the compiler wants you to declare the type of ${chalk.green(targetInfo.nodeText)} to ${chalk.green(
        typeToStringLike(checker, sourceInfo.type)
      )}`,
      context.targetDeclared ? getNodeLink(context.targetDeclared) : targetInfo.nodeLink
    )
  }
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   ____            _        _
//  |  _ \ _ __ ___ | |_ ___ | |_ _   _ _ __   ___  ___
//  | |_) | '__/ _ \| __/ _ \| __| | | | '_ \ / _ \/ __|
//  |  __/| | | (_) | || (_) | |_| |_| | |_) |  __/\__ \
//  |_|   |_|  \___/ \__\___/ \__|\__, | .__/ \___||___/
//                                |___/|_|
// ===============================================================================
// ===============================================================================
// ===============================================================================
function whenPrototypesDontMatch({ suggest, context, stack }) {
  if (context.captured) return
  const { checker } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  const isTargetFunction = isFunctionType(checker, targetInfo.type)
  const isSourceFunction = isFunctionType(checker, sourceInfo.type)
  if (isTargetFunction || isSourceFunction) {
    if (isTargetFunction === isSourceFunction) {
      // DOESN'T DO MISMATCHED PROTOTYPES YET
    } else if (isTargetFunction) {
      if (context.callMismatch) {
        suggest('Your calling arguments might be out of order', sourceInfo.nodeLink)
        suggest(
          `Otherwise argument ${chalk.greenBright(context.errorIndex + 1)} must have a function type`,
          targetInfo.nodeLink,
          `${targetInfo.typeText}`
        )
      }
    } else {
      suggest(
        `Did you mean to call the ${chalk.greenBright(`${sourceInfo.name} ( )`)} function first`,
        sourceInfo.nodeLink
      )
      suggest(
        `Otherwise ${chalk.greenBright(targetInfo.name)} must have a function type`,
        targetInfo.nodeLink,
        `${targetInfo.name}: ${sourceInfo.typeText}`
      )
    }
  }
}
