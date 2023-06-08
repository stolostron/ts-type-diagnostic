import chalk from 'chalk'
import ts from 'typescript'
import { ErrorType } from '../types'
import { getNodeLink, typeToStringLike } from '../utils'

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
export function whenSimpleTypesDontMatch({ stack, context, suggest }) {
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
          const onode = context.cache.startToOutputNode[sourceInfo.nodeId]
          context.cache.fixes.push({ pos: onode.pos, end: onode.end, replace: `'${sourceInfo.nodeText}'` })
          //suggest(`Add quotes to '${source}'`, sourceInfo.nodeLink)
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
