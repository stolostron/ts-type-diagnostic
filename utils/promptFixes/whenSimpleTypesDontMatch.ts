import chalk from 'chalk'
import ts from 'typescript'
import { ErrorType, IPromptFix } from '../types'
import { getNodeLink, typeToStringLike, getNodePos } from '../utils'

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
export function whenSimpleTypesDontMatch({ stack, context, suggest, promptFixes }) {
  if (context.captured) return
  const { checker, sourceTitle = 'Source', targetTitle = 'Target' } = context

  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (context.errorType === ErrorType.mismatch) {
    const promptFix: IPromptFix = {
      prompt: 'Fix this mismatch?',
      choices: [],
    }
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
          promptFix.choices.push({
            description: `Convert ${sourceTitle} ${source} to 'string' by adding quotes to '${source}'`,
            ...getNodePos(context, sourceInfo.nodeId),
            replace: `'${sourceInfo.nodeText}'`,
          })
        } else {
          const end = getNodePos(context, sourceInfo.nodeId).end
          promptFix.choices.push({
            description: `Convert ${sourceTitle} ${source} to 'string' with this ${source}.toString()`,
            beg: end,
            end,
            replace: '.toString()',
          })
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
    const nodeId = context.targetDeclared ? context.targetDeclared.getStart() : targetInfo.nodeId
    promptFix.choices.push({
      description: `Union ${targetTitle} ${target} with '${sourceTypeLike}' like this ${chalk.green(
        `${targetInfo.fullText} | ${sourceTypeLike}`
      )}`,
      ...getNodePos(context, nodeId),
      replace: `${targetInfo.fullText} | ${sourceTypeLike}`,
    })
    promptFixes.push(promptFix)
  }
}
