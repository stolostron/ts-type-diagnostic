import chalk from 'chalk'
import ts from 'typescript'
import { ErrorType, IPromptFix } from '../types'
import { typeToStringLike, getNodePos } from '../utils'

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
export function whenSimpleTypesDontMatch({ stack, context, promptFixes }) {
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
              promptFix.choices.push({
                description: `Convert ${sourceTitle} ${source} to 'number' by removing quotes from ${source}`,
                ...getNodePos(context, sourceInfo.nodeId),
                replace: `${sourceInfo.nodeText.replace(/['"]+/g, '')}`,
              })
            } else {
              promptFix.choices.push({
                description: `Convert ${sourceTitle} ${source} to 'number' with Number(${source})`,
                ...getNodePos(context, sourceInfo.nodeId),
                replace: `Number(${sourceInfo.nodeText})`,
              })
            }
          }
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
        promptFix.choices.push({
          description: `Convert ${sourceTitle} ${source} to 'boolean' with double exclamation: !!${source}`,
          ...getNodePos(context, sourceInfo.nodeId),
          replace: `!!${sourceInfo.nodeText}`,
        })
        break
    }

    // Union type-- get location of type declaration and replace with a union
    const sourceTypeLike = typeToStringLike(checker, sourceInfo.type)
    const nodeId = context.targetDeclared ? context.targetDeclared.getStart() : targetInfo.nodeId
    let node = context.cache.startToOutputNode[nodeId]
    const children = node.parent.getChildren()
    let beg = node.getEnd()
    let end = beg
    if (children[1].kind === ts.SyntaxKind.ColonToken) {
      beg = children[1].getStart()
      end = children[2].getEnd()
    }
    promptFix.choices.push({
      description: `Union ${targetTitle} ${target} with '${sourceTypeLike}' like this ${chalk.green(
        `${targetInfo.fullText} | ${sourceTypeLike}`
      )}`,
      replace: `:${targetInfo.typeText} | ${sourceTypeLike}`,
      beg,
      end,
    })
    promptFixes.push(promptFix)
  }
}
