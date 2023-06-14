import chalk from 'chalk'
import ts from 'typescript'
import { ErrorType } from '../types'
import { typeToStringLike } from '../utils'

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
export function whenSimpleTypesDontMatch({ stack, context, addChoice, sourceName, targetName }) {
  if (context.captured) return
  const { checker, functionName } = context
  const layer = stack[stack.length - 1]
  const { sourceInfo, targetInfo } = layer
  if (context.errorType === ErrorType.mismatch) {
    const suffix = functionName ? `in function ${functionName}(): ` : ''
    addChoice = addChoice.bind(null, `Fix this mismatch ${suffix}?`)
    const source = chalk.green(sourceInfo.nodeText)
    const target = chalk.green(targetInfo.nodeText)
    switch (true) {
      case !!(targetInfo.type.flags & ts.TypeFlags.NumberLike):
        if (sourceInfo.type.flags & ts.TypeFlags.Literal) {
          if (sourceInfo.type.flags & ts.TypeFlags.StringLiteral) {
            if (!Number.isNaN(Number(sourceInfo.nodeText.replace(/["']/g, '')))) {
              addChoice(sourceInfo, targetInfo, (outputNode: ts.Node) => {
                return {
                  description: `Convert type of ${sourceName} '${source}' to 'number' by removing quotes from ${source}`,
                  replace: `${sourceInfo.nodeText.replace(/['"]+/g, '')}`,
                  beg: outputNode.getStart(),
                  end: outputNode.getEnd(),
                }
              })
            } else {
              addChoice(sourceInfo, targetInfo, (outputNode: ts.Node) => {
                return {
                  description: `Convert type of ${sourceName} '${source}' to 'number' with Number(${source})`,
                  replace: `Number(${sourceInfo.nodeText})`,
                  beg: outputNode.getStart(),
                  end: outputNode.getEnd(),
                }
              })
            }
          }
        }
        break
      case !!(targetInfo.type.flags & ts.TypeFlags.StringLike):
        if (!Number.isNaN(Number(sourceInfo.nodeText))) {
          addChoice(sourceInfo, targetInfo, (outputNode: ts.Node) => {
            return {
              description: `Convert type of ${sourceName} '${source}' to 'string' by adding quotes to '${source}'`,
              replace: `'${sourceInfo.nodeText}'`,
              beg: outputNode.getStart(),
              end: outputNode.getEnd(),
            }
          })
        } else {
          addChoice(sourceInfo, targetInfo, (outputNode: ts.Node) => {
            return {
              description: `Convert type of ${sourceName} '${source}' to 'string' with this ${source}.toString()`,
              replace: `${sourceInfo.nodeText.replace(/['"]+/g, '')}`,
              beg: outputNode.getEnd(),
              end: outputNode.getEnd(),
            }
          })
        }
        break
      case !!(targetInfo.type.flags & ts.TypeFlags.BooleanLike):
        addChoice(sourceInfo, targetInfo, (outputNode: ts.Node) => {
          return {
            description: `Convert type of ${sourceName} '${source}' to 'boolean' with double exclamation: !!${source}`,
            replace: `!!${sourceInfo.nodeText}`,
            beg: outputNode.getStart(),
            end: outputNode.getEnd(),
          }
        })
        break
    }

    // Union type-- get location of type declaration and replace with a union
    addChoice(targetInfo, sourceInfo, (outputNode: ts.Node) => {
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
      const sourceTypeLike = typeToStringLike(checker, sourceInfo.type)
      return {
        description: `Union type of ${targetName} '${target}' with '${sourceTypeLike}' like this ${chalk.green(
          `${targetInfo.fullText} | ${sourceTypeLike}`
        )}`,
        replace: `:${targetInfo.typeText} | ${sourceTypeLike}`,
        beg,
        end,
      }
    })
  }
}
