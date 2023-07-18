/* Copyright Contributors to the Open Cluster Management project */

import chalk from 'chalk'
import { Table } from 'console-table-printer'

import { DiffTableType, ErrorType, IShapeProblem, ITypeProblem, MAX_SHOWN_PROP_MISMATCH, isShapeProblem } from './types'
import {
  addLink,
  addNote,
  andMore,
  asTypeInterfaces,
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
  const { code, callMismatch, sourceTitle = 'Source', targetTitle = 'Target' } = context
  const sourceLink = context.sourceLink.split('/').slice(-3).join('/')
  const targetLink = context.targetLink.split('/').slice(-3).join('/')
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
      specs = `${targetTitle} has too ${chalk.red('many')} properties`
      break
    case ErrorType.targetPropMissing:
      specs = `${targetTitle} has too ${chalk.red('few')} properties`
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
    case ErrorType.attrMismatch:
      specs = `Component is ${chalk.yellow('mismatched')} with these JSX attributes`
      break
    case ErrorType.attrWrong:
      specs = `Component is ${chalk.red('missing')} these JSX attributes`
      break
    case ErrorType.attrBoth:
      specs = `Component is ${chalk.yellow('mismatched')} and ${chalk.red('missing')} these JSX attributes`
      break
  }

  console.log(`TS${code}: ${specs} (${context.problemBeg})`)

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
  let errorType: ErrorType = ErrorType.none
  context.callingPairs.forEach(({ sourceInfo, targetInfo }, inx) => {
    if (sourceInfo && targetInfo) {
      const { typeText: sourceTypeText, fullText: sourceFullText } = sourceInfo
      const { typeText: targetTypeText, fullText: targetFullText } = targetInfo
      if (inx !== context.errorIndex) {
        let skipRow = false
        let color = 'green'
        if (sourceTypeText !== targetTypeText) {
          if (context.errorIndex === -1 && errorType === ErrorType.none && problems && problems.length) {
            errorType = showConflicts(p, problems, context, stack, inx + 1)
            skipRow = true
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
  const { checker } = context
  // display the path we took to get here
  let spacer = ''

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
    let target
    let source
    if (context.callMismatch) {
      source = `${min(maxs, sourceInfo?.fullText)}  ${addLink(links, '  ', sourceInfo.nodeLink, color)}`
      target = `${min(maxs, targetInfo?.fullText)}  ${addLink(links, '  ', targetInfo.nodeLink, color)}`
    } else {
      target = `${min(maxs, targetInfo?.fullText)}  ${addLink(links, '  ', targetInfo.nodeLink, color)}`
      source = `${min(maxs, sourceInfo?.fullText)}  ${addLink(links, '  ', sourceInfo.nodeLink, color)}`
    }
    const row: any = {
      target,
      source,
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
        target: `${min(maxs, targetInfo?.fullText)}  ${addLink(links, '  ', targetInfo.nodeLink, color)}`,
        source: !sourceInfo.isPlaceholder
          ? `${min(maxs, sourceInfo?.fullText)}  ${addLink(links, '  ', sourceInfo.nodeLink, color)}`
          : '',
      }
      if (arg) {
        row.arg = arg
        row.parm = arg
      }
      p.addRow(row, { color })
    } else {
      p.addRow(
        {
          target: `${spacer}└${min(maxs, targetInfo.fullText)} ${addLink(links, spacer + '  ', targetInfo.nodeLink)}`,
          source: !sourceInfo.isPlaceholder
            ? `${spacer}└${min(maxs, sourceInfo.fullText)}  ${addLink(links, spacer + '  ', sourceInfo.nodeLink)}`
            : '',
        },
        { color }
      )
    }
    spacer += '  '
  })
  spacer += '  '

  //======================================================================
  //========= FILL IN THE PROPERTY ROWS ====================================
  //======================================================================

  const originalSpace = spacer
  const showingMultipleProblems = problems.length > 1 // showing multiple union types as a possible match
  if (showingMultipleProblems) spacer += '  '
  problems.forEach((problem) => {
    let {
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
      targetMap = context.targetMap = getTypeMap(checker, targetType, context)
      sourceType = context.cache.getType(problem.sourceInfo.typeId)
      sourceMap = context.sourceMap = getTypeMap(checker, sourceType, context)
    } else if (sourceInfo.placeholderTarget || context.placeholderInfo) {
      const placeholderInfo = context.placeholderInfo
      const key = placeholderInfo.placeholderTarget.key
      const parentLayer = stack[stack.length - 1]
      targetType = context.cache.getType(parentLayer.targetInfo.typeId)
      targetMap = context.targetMap = getTypeMap(checker, targetType, context)
      sourceMap[key] = placeholderInfo
      const targetProp = targetMap[key]
      reversed.contextual = Object.keys(targetMap).filter((k) => k !== key)
      if (targetProp) {
        mismatch.push(key)
      } else {
        missing.push(key)
      }
    } else if (sourceInfo.attributeProblems) {
      const parentLayer = stack[stack.length - 1]
      targetType = context.cache.getType(parentLayer.targetInfo.typeId)
      targetMap = context.targetMap = getTypeMap(checker, targetType, context)
      sourceMap = sourceInfo.attributeProblems.sourceMap
      missing = sourceInfo.attributeProblems.missing
      mismatch = sourceInfo.attributeProblems.mismatch
      reversed.missing = sourceInfo.attributeProblems.reverse
      const sourceKeys = Object.keys(sourceMap)
      reversed.contextual = Object.keys(targetMap).filter((k) => !sourceKeys.includes(k))
    }

    // TYPENAME ROW -- if showing multiple types
    if (showingMultipleProblems) {
      p.addRow(
        {
          target: `${originalSpace}${min(maxs, problem.targetInfo.typeText)}  ${addLink(
            links,
            '  ',
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
        if (inx === 0 && targetText.split('|').length > 1 && !global.isVerbose) {
          targetText = `${propName}: ${sourceMap[propName].typeText} | ... ${addNote(maxs, targetText)}`
        }
        if (inx === 1) {
          targetText = `${targetText}  ${addLink(links, spacer, targetMap[propName].nodeLink, colors[inx])}`
          sourceText = `${sourceText}  ${addLink(links, spacer, sourceMap[propName].nodeLink, colors[inx])}`
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
      errorType = context.isJSXProblem ? ErrorType.attrBoth : ErrorType.both
    } else if (missing.length || (reversed && reversed.missing.length)) {
      if (context.missingIndex) {
        errorType = ErrorType.missingIndex
      } else if (missing.length && reversed && reversed.missing.length) {
        errorType = context.isJSXProblem ? ErrorType.attrWrong : ErrorType.bothMissing
      } else if (missing.length) {
        errorType = context.isJSXProblem ? ErrorType.attrWrong : ErrorType.targetPropMissing
      } else {
        errorType = ErrorType.sourcePropMissing
      }
    } else if (mismatch.length) {
      errorType = context.isJSXProblem ? ErrorType.attrMismatch : ErrorType.propMismatch
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
            if (
              global.isVerbose &&
              !showingMultipleProblems &&
              targetMap[target].altParentInfo &&
              targetMap[target].altParentInfo.fullText !== lastTargetParent
            ) {
              lastTargetParent = targetMap[target].altParentInfo.fullText
              targetParent = `${spacer} -${min(maxs, targetMap[target].altParentInfo.fullText)}  ${
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
              !hideLinks ? addLink(links, spacer + bump, targetMap[target].nodeLink, clr) : ''
            }`
          } else {
            target = ''
          }
          if (source && sourceMap[source]) {
            if (
              global.isVerbose &&
              !showingMultipleProblems &&
              sourceMap[source].altParentInfo &&
              sourceMap[source].altParentInfo.fullText !== lastSourceParent
            ) {
              lastSourceParent = sourceMap[source].altParentInfo.fullText
              sourceParent = `${spacer} ─${min(maxs, sourceMap[source].altParentInfo.fullText)}  ${
                !hideLinks ? addLink(links, spacer, sourceMap[source].altParentInfo.nodeLink) : ''
              }`
            }
            const bump = lastSourceParent ? '   ' : ''
            clr = sourceMap[source].isOpt ? 'green' : color
            source = `${spacer + bump}${min(maxs, sourceMap[source].fullText)}  ${
              !hideLinks ? addLink(links, spacer + bump, sourceMap[source].nodeLink, clr) : ''
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
          let source = ''
          let target = ''
          const more = andMore(interfaces, conflicts, interfaceMaps)
          if (Object.keys(targetMap).length > Object.keys(sourceMap).length) {
            target = more
          } else {
            source = more
          }
          p.addRow(
            {
              source,
              target,
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
  const { hadSuggestions, notes } = context
  const { maxs, links, interfaces } = notes

  // print the table notes:
  if (!hadSuggestions || global.isVerbose) {
    links.forEach((link) => console.log(link))
  }

  if (global.isVerbose) {
    maxs.forEach((max) => console.log(max))
    interfaces.forEach((inter) => console.log(inter))
  }
}
