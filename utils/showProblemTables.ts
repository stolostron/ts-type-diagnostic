/* Copyright Contributors to the Open Cluster Management project */

import chalk from 'chalk'
import { Table } from 'console-table-printer'

import {
  DiffTableType,
  ErrorType,
  IShapeProblem,
  ITypeProblem,
  MAX_SHOWN_PROP_MISMATCH,
  MatchType,
  isShapeProblem,
} from './types'
import { simpleTypeComparision } from './compareTypes'
import {
  addLink,
  addNote,
  andMore,
  asTypeInterfaces,
  getNodeLink,
  getTypeLink,
  getTypeMap,
  isLikeTypes,
  isNeverType,
  isSimpleType,
  min,
} from './utils'

//======================================================================
//======================================================================
//======================================================================
//   ____                _         _____     _     _
//  / ___|_ __ ___  __ _| |_ ___  |_   _|_ _| |__ | | ___
// | |   | '__/ _ \/ _` | __/ _ \   | |/ _` | '_ \| |/ _ \
// | |___| | |  __/ (_| | ||  __/   | | (_| | |_) | |  __/
//  \____|_|  \___|\__,_|\__\___|   |_|\__,_|_.__/|_|\___|

//======================================================================
//======================================================================
//======================================================================

// DISPLAY CONFLICTS IN A TABLE
//   a) TYPE CONFLICTS
//   b) TYPE SHAPE CONFICTS
//   c) FUNCTION CALL CONFLICTS

export function showProblemTables(problems, context, stack) {
  //======================================================================
  //========= INITIALIZE THE COLUMNS =====================
  //======================================================================
  // FOR TYPE CONFLICTS, TARGET IS ON THE LEFT AND SOURCE IS ON THE RIGHT TO MATCH 'TARGET = SOURCE' CONVENTION
  // FOR FUNCTION CALLS, THE ORDER IS REVERSED TO MATCH FUNC(ARG) ==> CONST FUNC(PARAM) CONVENTION
  const { code, callMismatch, sourceTitle = 'Source', targetTitle = 'Target', sourceLink, targetDeclared } = context
  let { targetLink } = context
  if (context.targetDeclared) {
    targetLink = getNodeLink(targetDeclared)
  }
  const columns: {
    name: string
    minLen?: number
    title: string
    alignment: string
  }[] = []
  if (callMismatch) {
    columns.push({
      name: 'arg',
      title: 'Arg',
      alignment: 'right',
    })
    columns.push({
      name: 'source', // on the left
      minLen: 60,
      title: `${sourceTitle}: ${sourceLink}`,
      alignment: 'left',
    })
    columns.push({
      name: 'parm',
      title: 'Prm',
      alignment: 'right',
    })
    columns.push({
      name: 'target', // on the right
      minLen: 60,
      title: `${targetTitle}: ${targetLink} ${sourceLink === targetLink ? '(same)' : ''}`,
      alignment: 'left',
    })
  } else {
    columns.push({
      name: 'target', // on the left
      minLen: 60,
      title: `${targetTitle}: ${targetLink}`,
      alignment: 'left',
    })
    columns.push({
      name: 'source', // on the right
      minLen: 60,
      title: `${sourceTitle}: ${sourceLink} ${sourceLink === targetLink ? '(same)' : ''}`,
      alignment: 'left',
    })
  }

  // keep table notes
  context.notes = {
    links: [],
    maxs: [],
    interfaces: [],
  }

  //======================================================================
  //========= CREATE/FILL THE TABLE =====================
  //======================================================================
  const p = new Table({
    columns,
  })

  let errorType: ErrorType = ErrorType.none
  if (callMismatch) {
    // calls showConflicts() from within
    errorType = showCallingArgumentConflicts(p, problems, context, stack)
  } else {
    errorType = showConflicts(p, problems, context, stack)
  }

  //======================================================================
  //======================================================================
  //======================================================================
  //   _____     _     _        _____ _ _   _
  //  |_   _|_ _| |__ | | ___  |_   _(_) |_| | ___
  //    | |/ _` | '_ \| |/ _ \   | | | | __| |/ _ \
  //    | | (_| | |_) | |  __/   | | | | |_| |  __/
  //    |_|\__,_|_.__/|_|\___|   |_| |_|\__|_|\___|
  //======================================================================
  //======================================================================
  //======================================================================

  let specs
  context.errorType = errorType
  switch (errorType) {
    case ErrorType.simpleToObject:
    case ErrorType.mismatch:
    case ErrorType.misslike:
    case ErrorType.objectToSimple:
    case ErrorType.arrayToNonArray:
    case ErrorType.nonArrayToArray:
    case ErrorType.propMismatch:
      specs = `${targetTitle} type !== ${sourceTitle} type`
      break
    case ErrorType.sourcePropMissing:
      specs = `${sourceTitle} has too ${chalk.red('few')} properties`
      break
    case ErrorType.targetPropMissing:
      specs = `${sourceTitle} has too ${chalk.red('many')} properties`
      break
    case ErrorType.bothMissing:
      specs = `Both sides have ${chalk.red('missing')} properties`
      break
    case ErrorType.mustDeclare:
      specs = `${targetTitle} ${chalk.yellow('needs declaration')}`
      break
    case ErrorType.missingIndex:
      specs = `The map is ${chalk.red('missing')} an index property`
      break
    case ErrorType.both:
      specs = `Both sides have ${chalk.yellow('mismatched')} and ${chalk.red('missing')} properties`
      break
    case ErrorType.tooManyArgs:
      specs = `Too ${chalk.red('many')} calling arguments`
      break
    case ErrorType.tooFewArgs:
      specs = `Too ${chalk.red('few')} calling arguments`
      break
  }

  console.log(`TS${code}: ${specs} (${context.nodeId})`)

  // print the table
  p.printTable()
}

//======================================================================
//======================================================================
//======================================================================
//   ____      _ _   _____     _     _
//  / ___|__ _| | | |_   _|_ _| |__ | | ___
// | |   / _` | | |   | |/ _` | '_ \| |/ _ \
// | |__| (_| | | |   | | (_| | |_) | |  __/
//  \____\__,_|_|_|   |_|\__,_|_.__/|_|\___|
//======================================================================
//======================================================================
//======================================================================
function showCallingArgumentConflicts(p, problems, context, stack): ErrorType {
  const { checker } = context
  let errorType: ErrorType = ErrorType.none
  context.callingPairs.forEach(({ sourceInfo, targetInfo }, inx) => {
    if (sourceInfo && targetInfo) {
      const { typeId: sourceTypeId, typeText: sourceTypeText, fullText: sourceFullText } = sourceInfo
      const { typeId: targetTypeId, typeText: targetTypeText, fullText: targetFullText } = targetInfo
      const sourceType = (sourceInfo.type = context.cache.getType(sourceTypeId))
      const targetType = (targetInfo.type = context.cache.getType(targetTypeId))
      if (inx !== context.errorIndex) {
        let skipRow = false
        let color = 'green'
        if (sourceTypeText !== targetTypeText) {
          if (context.errorIndex === -1 && errorType === ErrorType.none && problems && problems.length) {
            errorType = showConflicts(p, problems, context, stack, inx + 1)
            skipRow = true
          }
          switch (simpleTypeComparision(checker, sourceType, targetType)) {
            case MatchType.mismatch:
            case MatchType.bigley:
              color = 'yellow'
              break
            case MatchType.never:
              color = 'magenta'
              break
            case MatchType.recurse:
              color = 'cyan'
              break
            default:
              color = 'green'
              break
          }
        }
        if (!skipRow) {
          p.addRow(
            {
              arg: inx + 1,
              parm: inx + 1,
              source: `${min(context.notes.maxs, sourceFullText)}`,
              target: `${min(context.notes.maxs, targetFullText)}`,
            },
            { color }
          )
        }
      } else {
        // FOR THE ARGUMENT THAT HAD THE ACTUAL COMPILER ERROR, SHOW ITS FULL TYPE CONFLICT
        errorType = showConflicts(p, problems, context, stack, inx + 1)
      }
    } else if (targetInfo) {
      const isOpt = targetInfo.isOpt
      if (!isOpt) errorType = ErrorType.tooFewArgs
      p.addRow(
        {
          arg: `${isOpt ? '' : `\u25B6 ${inx + 1}`}`,
          parm: inx + 1,
          target: `${min(context.notes.maxs, targetInfo.fullText)}`,
          source: '',
        },
        { color: isOpt ? 'green' : 'red' }
      )
    } else {
      errorType = ErrorType.tooManyArgs
      p.addRow(
        {
          arg: `\u25B6 ${inx + 1}`,
          parm: '',
          source: `${min(context.notes.maxs, sourceInfo.fullText)}`,
          target: '',
        },
        { color: 'red' }
      )
    }
  })
  return errorType
}

//======================================================================
//======================================================================
//======================================================================
//  _____                   _____     _     _
// |_   _|   _ _ __   ___  |_   _|_ _| |__ | | ___
//   | || | | | '_ \ / _ \   | |/ _` | '_ \| |/ _ \
//   | || |_| | |_) |  __/   | | (_| | |_) | |  __/
//   |_| \__, | .__/ \___|   |_|\__,_|_.__/|_|\___|
//       |___/|_|
//======================================================================
//======================================================================
//======================================================================

function showConflicts(p, problems: (ITypeProblem | IShapeProblem)[], context, stack, arg?): ErrorType {
  const { checker, isVerbose } = context
  // display the path we took to get here
  let spacer = ''
  // let lastTargetType
  // let lastSourceType

  // reinflate types
  const { sourceInfo, targetInfo } = stack[stack.length - 1]
  targetInfo.type = context.cache.getType(targetInfo?.typeId)
  sourceInfo.type = context.cache.getType(sourceInfo?.typeId)

  const { notes } = context
  const { maxs, links, interfaces } = notes
  let errorType: ErrorType = ErrorType.none
  let color: string = 'green'
  //======================================================================
  //========= FILL TYPE CONFLICT ROW ====================================
  //======================================================================
  // just a one row conflict--ONE AND DONE
  if (stack.length === 1 && !stack[0].sourceInfo.isPlaceholder && !isShapeProblem(problems[0])) {
    const { sourceInfo, targetInfo } = stack[stack.length - 1]
    const { sourceIsArray, targetIsArray } = problems[0] as ITypeProblem
    const targetTypeText = targetInfo?.typeText
    const sourceTypeText = sourceInfo?.typeText
    const targetType = targetInfo?.type
    const sourceType = sourceInfo?.type

    // else show type differences
    if (isNeverType(sourceType) || isNeverType(targetType)) {
      errorType = ErrorType.mustDeclare
      color = 'red'
    } else if (sourceIsArray !== targetIsArray) {
      errorType = sourceIsArray ? ErrorType.arrayToNonArray : ErrorType.nonArrayToArray
      color = 'yellow'
    } else if (targetTypeText !== sourceTypeText) {
      const isSourceSimple = isSimpleType(sourceType)
      const isTargetSimple = isSimpleType(targetType)
      if (isLikeTypes(sourceType, targetType)) {
        errorType = ErrorType.misslike
        color = 'yellow'
      } else if (isSourceSimple && isTargetSimple) {
        errorType = ErrorType.mismatch
        color = 'yellow'
      } else {
        errorType = isSourceSimple ? ErrorType.simpleToObject : ErrorType.objectToSimple
        color = 'yellow'
      }
    }
    const row: any = {
      target: `${min(maxs, targetInfo?.fullText)}`,
      source: `${min(maxs, sourceInfo?.fullText)}`,
    }
    if (arg) {
      row.arg = arg //`\u25B6 ${arg}`
      row.parm = arg //`\u25B6 ${arg}`
    }
    p.addRow(row, { color })
    return errorType
  }

  //======================================================================
  //======================================================================
  //======================================================================
  //  ____                            _           _____     _     _
  // |  _ \ _ __ ___  _ __   ___ _ __| |_ _   _  |_   _|_ _| |__ | | ___
  // | |_) | '__/ _ \| '_ \ / _ \ '__| __| | | |   | |/ _` | '_ \| |/ _ \
  // |  __/| | | (_) | |_) |  __/ |  | |_| |_| |   | | (_| | |_) | |  __/
  // |_|   |_|  \___/| .__/ \___|_|   \__|\__, |   |_|\__,_|_.__/|_|\___|
  //                 |_|                  |___/
  //======================================================================
  //======================================================================
  //======================================================================

  //======================================================================
  //========= FILL IN THE PARENT ROWS ====================================
  //======================================================================
  stack.forEach((layer, inx) => {
    const { sourceInfo, targetInfo } = layer
    if (inx === 0) {
      const row: any = {
        target: `${min(maxs, targetInfo?.fullText)}`,
        source: !sourceInfo.isPlaceholder ? `${min(maxs, sourceInfo?.fullText)}` : '',
      }
      if (arg) {
        row.arg = arg //`\u25B6 ${arg}`
        row.parm = arg //`\u25B6 ${arg}`
      }
      p.addRow(row, { color })
      spacer += '  '
    } else {
      p.addRow(
        {
          target: `${spacer}└${min(maxs, targetInfo.fullText)} ${addLink(
            links,
            spacer,
            targetInfo.fullText,
            targetInfo.nodeLink
          )}`,
          source: !sourceInfo.isPlaceholder
            ? `${spacer}└${min(maxs, sourceInfo.fullText)}  ${addLink(
                links,
                spacer,
                sourceInfo.fullText,
                sourceInfo.nodeLink
              )}`
            : '',
        },
        { color }
      )
      spacer += '  '
    }
  })

  //======================================================================
  //========= FILL IN THE PROPERTY ROWS ====================================
  //======================================================================

  const originalSpace = spacer
  const showingMultipleProblems = problems.length > 1 // showing multiple union types as a possible match
  if (showingMultipleProblems) spacer += '  '
  problems.forEach((problem) => {
    const {
      mismatch = [],
      misslike = [],
      matched = [],
      missing = [],
      unchecked = [],
      contextual = [],
      reversed = { missing: [], contextual: [] },
      sourceInfo,
    } = problem as IShapeProblem
    let targetType
    let sourceType
    let targetMap
    let sourceMap = {}
    if (isShapeProblem(problem)) {
      targetType = context.cache.getType(problem.targetInfo.typeId)
      targetMap = context.targetMap = getTypeMap(checker, targetType, context, misslike)
      sourceType = context.cache.getType(problem.sourceInfo.typeId)
      sourceMap = context.sourceMap = getTypeMap(checker, sourceType, context, misslike)
    } else if (sourceInfo.placeholderTargetKey || context.placeholderInfo) {
      const placeholderInfo = sourceInfo.placeholderTargetKey ? sourceInfo : context.placeholderInfo
      const key = placeholderInfo.placeholderTargetKey
      const parentLayer = stack[stack.length - 1]
      targetType = context.cache.getType(parentLayer.targetInfo.typeId)
      targetMap = context.targetMap = getTypeMap(checker, targetType, context, misslike)
      sourceMap[key] = placeholderInfo
      const targetProp = targetMap[key]
      reversed.contextual = Object.keys(targetMap).filter((k) => k !== key)
      if (targetProp) {
        mismatch.push(key)
      } else {
        missing.push(key)
      }
    }

    // TYPENAME ROW -- if showing multiple types
    if (showingMultipleProblems) {
      p.addRow(
        {
          target: `${originalSpace}${min(maxs, problem.targetInfo.typeText)}  ${addLink(
            links,
            '  ',
            problem.targetInfo.typeText,
            getTypeLink(targetType),
            'green'
          )}`,
          source: '',
        },
        { color: 'green' }
      )
    }

    // MATCHED/UNCHECKED rows
    const colors = ['green', 'cyan']
    ;[matched, unchecked].forEach((arr, inx) => {
      arr.forEach((propName) => {
        let targetText = targetMap[propName].fullText
        let sourceText = sourceMap[propName].fullText
        if (inx === 0 && targetText.split('|').length > 1 && !isVerbose) {
          targetText = `${propName}: ${sourceMap[propName].typeText} | ... ${addNote(maxs, targetText)}`
        }
        if (inx === 1) {
          targetText = `${targetText}  ${addLink(
            links,
            spacer,
            targetMap[propName].fullText,
            targetMap[propName].nodeLink,
            colors[inx]
          )}`
          sourceText = `${sourceText}  ${addLink(
            links,
            spacer,
            sourceMap[propName].fullText,
            sourceMap[propName].nodeLink,
            colors[inx]
          )}`
        }

        p.addRow(
          {
            target: `${spacer}${min(maxs, targetText)}`,
            source: `${spacer}${min(maxs, sourceText)}`,
          },
          { color: colors[inx] }
        )
      })
    })

    // MISMATCH/MISSLIKE rows
    const mismatchArr: DiffTableType = mismatch.map((propName) => {
      return { source: propName, target: propName }
    })
    const misslikeArr: DiffTableType = misslike.map((propName) => {
      return { source: propName, target: propName }
    })

    // MISSING/REVERSE MISSING rows
    const missingArr: DiffTableType = missing.map((propName) => {
      return { source: propName }
    })
    if (reversed) {
      reversed.missing.forEach((propName, inx) => {
        if (inx < missingArr.length) {
          missingArr[inx].target = propName
        } else {
          missingArr.push({ target: propName })
        }
      })
    }

    // SORT CONFLICTING TYPES BY THEIR PARENT INTERFACE IF ANY
    context.externalLinks = []
    context.mismatchInterfaceMaps = asTypeInterfaces(mismatchArr, targetMap, sourceMap)
    context.misslikeInterfaceMaps = asTypeInterfaces(misslikeArr, targetMap, sourceMap)
    context.missingInterfaceMaps = asTypeInterfaces(missingArr, targetMap, sourceMap)

    displayDifferences(mismatchArr, 'yellow', context.mismatchInterfaceMaps)
    displayDifferences(misslikeArr, 'yellow', context.misslikeInterfaceMaps)
    displayDifferences(missingArr, 'red', context.missingInterfaceMaps)

    // CONTEXTUAL rows
    if (contextual.length || (reversed && reversed.contextual)) {
      const contextualArr: DiffTableType = contextual.map((propName) => {
        return { source: propName }
      })
      if (reversed && reversed.contextual) {
        reversed.contextual.forEach((propName, inx) => {
          if (inx < contextualArr.length) {
            contextualArr[inx].target = propName
          } else {
            contextualArr.push({ target: propName })
          }
        })
      }
      displayDifferences(contextualArr, 'green', {}, true)
    }

    if (misslike.length) {
      errorType = ErrorType.misslike
    } else if (missing.length && mismatch.length) {
      errorType = ErrorType.both
    } else if (missing.length || (reversed && reversed.missing.length)) {
      if (context.missingIndex) {
        errorType = ErrorType.missingIndex
      } else if (missing.length && reversed && reversed.missing.length) {
        errorType = ErrorType.bothMissing
      } else if (missing.length) {
        errorType = ErrorType.targetPropMissing
      } else {
        errorType = ErrorType.sourcePropMissing
      }
    } else if (mismatch.length) {
      errorType = ErrorType.propMismatch
    }

    //======================================================================
    //========= DISPLAY TYPE PROPERTY CONFLICTS ================
    //======================================================================

    function displayDifferences(conflicts: DiffTableType, color: string, interfaceMaps, hideLinks?: boolean) {
      let lastSourceParent: string
      let lastTargetParent: string
      hideLinks = hideLinks || showingMultipleProblems
      conflicts.some(({ target, source }, inx) => {
        let sourceParent: string | undefined
        let targetParent: string | undefined
        let clr = color
        if (inx < MAX_SHOWN_PROP_MISMATCH) {
          if (target && targetMap[target]) {
            if (targetMap[target].nodeLink.indexOf('node_modules/') !== -1) {
              context.externalLinks.push(targetMap[target].nodeLink)
            }
            if (
              isVerbose &&
              !showingMultipleProblems &&
              targetMap[target].altParentInfo &&
              targetMap[target].altParentInfo.fullText !== lastTargetParent
            ) {
              lastTargetParent = targetMap[target].altParentInfo.fullText
              targetParent = `${spacer}└─${min(maxs, targetMap[target].altParentInfo.fullText)}  ${
                showingMultipleProblems
                  ? ''
                  : addLink(
                      links,
                      spacer,
                      targetMap[target].altParentInfo.fullText,
                      targetMap[target].altParentInfo.nodeLink
                    )
              }`
            }
            const bump = lastTargetParent ? '   ' : ''
            clr = targetMap[target].isOpt ? 'green' : color
            target = `${spacer + bump}${min(maxs, targetMap[target].fullText)}  ${
              !hideLinks
                ? addLink(links, spacer + bump, targetMap[target].fullText, targetMap[target].nodeLink, clr)
                : ''
            }`
          } else {
            target = ''
          }
          if (source && sourceMap[source]) {
            if (sourceMap[source].nodeLink.indexOf('node_modules/') !== -1) {
              context.externalLinks.push(sourceMap[source].nodeLink)
            }
            if (
              isVerbose &&
              !showingMultipleProblems &&
              sourceMap[source].altParentInfo &&
              sourceMap[source].altParentInfo.fullText !== lastSourceParent
            ) {
              lastSourceParent = sourceMap[source].altParentInfo.fullText
              sourceParent = `${spacer}└─${min(maxs, sourceMap[source].altParentInfo.fullText)}  ${
                !hideLinks
                  ? addLink(
                      links,
                      spacer,
                      sourceMap[source].altParentInfo.fullText,
                      sourceMap[source].altParentInfo.nodeLink
                    )
                  : ''
              }`
            }
            const bump = lastSourceParent ? '   ' : ''
            clr = sourceMap[source].isOpt ? 'green' : color
            source = `${spacer + bump}${min(maxs, sourceMap[source].fullText)}  ${
              !hideLinks
                ? addLink(links, spacer + bump, sourceMap[source].fullText, sourceMap[source].nodeLink, clr)
                : ''
            }`
          } else {
            source = ''
          }
          if (sourceParent || targetParent) {
            p.addRow(
              {
                source: sourceParent,
                target: targetParent,
              },
              { color: 'green' }
            )
            sourceParent = targetParent = undefined
          }
          p.addRow(
            {
              source,
              target,
            },
            { color: clr }
          )
          return false
        } else {
          p.addRow(
            {
              source: andMore(interfaces, conflicts, interfaceMaps),
              target: '',
            },
            { color: clr }
          )
          return true
        }
      })
    }
  })
  return errorType
}

// ===============================================================================
// ===============================================================================
// ===============================================================================
//   ____  _                                 _
//  / ___|| |__   _____      __  _ __   ___ | |_ ___  ___
//  \___ \| '_ \ / _ \ \ /\ / / | '_ \ / _ \| __/ _ \/ __|
//   ___) | | | | (_) \ V  V /  | | | | (_) | ||  __/\__ \
//  |____/|_| |_|\___/ \_/\_/   |_| |_|\___/ \__\___||___/
// ===============================================================================
// ===============================================================================
// ===============================================================================

export function showTableNotes(problems, context) {
  const { isVerbose } = context
  const { hadSuggestions, notes } = context
  const { maxs, links, interfaces } = notes
  if (isVerbose) {
    if (problems[0].unchecked && problems[0].unchecked.length) {
      console.log(`( ${chalk.cyan(problems[0].unchecked.join(', '))} cannot be checked until problems are resolved )`)
    }
    if (context.remaining) {
      console.log(`( ${chalk.cyan(context.remaining)} cannot be checked until problems are resolved )`)
    }
  }

  // print the table notes:
  if (!hadSuggestions || isVerbose) {
    links.forEach((link) => console.log(link))
  }

  if (isVerbose) {
    maxs.forEach((max) => console.log(max))
    interfaces.forEach((inter) => console.log(inter))
  }
}
