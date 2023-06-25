/* Copyright Contributors to the Open Cluster Management project */
import ts from 'typescript'
import chalk from 'chalk'
import { IShapeProblem, ITypeProblem, MAX_COLUMN_WIDTH } from './types'
import path from 'path'

export function getPropertyInfo(prop: ts.Symbol, context, type?: ts.Type, pseudo?: boolean) {
  const { checker } = context
  const declarations = prop?.declarations
  if (Array.isArray(declarations)) {
    let fullText
    const declaration = declarations[0]
    type = type || checker.getTypeAtLocation(declaration)
    let typeText = typeToString(checker, type!)
    const isOpt = !!(prop.flags & ts.SymbolFlags.Optional)
    const isFunc = isFunctionType(checker, type!)
    const propName = prop.getName()
    if (pseudo) {
      let preface = `${propName}${isOpt ? '?' : ''}:`
      switch (true) {
        case !!(prop.flags & ts.SymbolFlags.Interface):
          preface = 'interface'
          break
        case !!(prop.flags & ts.SymbolFlags.Class):
          preface = 'class'
          break
        case !!(prop.flags & ts.SymbolFlags.TypeAlias):
          preface = 'type'
          break
      }
      fullText = `${preface} ${typeText}`
    } else {
      fullText = getPropertyInfoText(checker, declaration, type)
      const declaredType = fullText.split(':').pop()?.trim()
      if (type && type['intrinsicName'] && declaredType !== typeText) {
        fullText += ` as ${typeText}`
      }
      if (type!.flags & ts.TypeFlags.Literal) {
        fullText += ` as ${ts.TypeFlags[type!.flags]}`
      }
      typeText = declaredType || typeText
    }
    return {
      nodeText: propName,
      typeText,
      isOpt,
      isFunc,
      fullText,
      typeId: context.cache.saveType(type),
      nodeId: context.cache.saveNode(declaration),
      nodeLink: getNodeLink(declaration),
      declaration,
    }
  }
  return { typeText: '', fullText: '', nodeLink: '' }
}

export function getTypeMap(checker: ts.TypeChecker, type: ts.Type, context) {
  if (!type) return
  if ((type as any).placeholderInfo) return (type as any).placeholderInfo
  const map = {}
  type.getProperties().forEach((prop) => {
    let info = {}
    prop = prop['syntheticOrigin'] || prop
    const propName = prop.escapedName as string
    const { nodeText, fullText, isOpt, isFunc, nodeLink, typeText, typeId, nodeId, declaration } = getPropertyInfo(
      prop,
      context,
      undefined
    )

    // see if type symbol was added thru another declaration
    const parentInfo = type.symbol ? getPropertyInfo(type.symbol, context, undefined, true) : undefined
    let altParentInfo: { fullText: string; nodeLink?: string } | undefined = undefined
    if (parentInfo && declaration?.parent) {
      const altParentType = checker.getTypeAtLocation(declaration?.parent)
      const otherInfo = getPropertyInfo(altParentType.symbol, context, undefined, true)
      altParentInfo = otherInfo.nodeLink !== parentInfo.nodeLink ? otherInfo : undefined
    }
    info = {
      isOpt,
      isFunc,
      nodeText,
      fullText,
      typeId,
      nodeId,
      typeText,
      nodeLink,
      parentInfo,
      altParentInfo,
    }
    map[propName] = info
  })
  return map
}

export function getPropText(prop: ts.Symbol) {
  const declarations = prop?.declarations
  if (Array.isArray(declarations)) {
    const declaration = declarations[0]
    return declaration
      .getText()
      .split('\n')
      .map((seg) => seg.trimStart())
      .join(' ')
  }
  return ''
}

export function getPropertyInfoText(checker, node, type) {
  const text = node.getText()
  const lines = text.split('\n')
  if (lines.length > 1) {
    return `${node.name ? `${node.name.escapedText}: ` : ''}${getSimpleInferredInterface(checker, type)}`
  }
  return text
}

export function getNodeText(node) {
  return node.getChildren().length > 1
    ? ''
    : node
        .getText()
        .split('\n')
        .map((seg) => seg.trimStart())
        .join(' ')
}

export function getFullText(nodeText, typeText) {
  return nodeText === typeText || !nodeText || nodeText.startsWith('{') ? typeText : `${nodeText}: ${typeText}`
}

function getStringLike(type) {
  switch (true) {
    case !!(type.flags & ts.TypeFlags.StringLike):
      return 'string'
    case !!(type.flags & ts.TypeFlags.NumberLike):
      return 'number'
    case !!(type.flags & ts.TypeFlags.BooleanLike):
      return 'boolean'
    case !!(type.flags & ts.TypeFlags.BigIntLike):
      return 'bigint'
  }
  return undefined
}

export function typeToStringLike(checker: ts.TypeChecker, type: ts.Type) {
  let like
  if (type['types']) {
    const set = new Set()
    if (
      type['types'].every((t) => {
        like = getStringLike(t)
        set.add(like)
        return !!like
      })
    ) {
      return Array.from(set).join(' | ')
    }
  } else {
    like = getStringLike(type)
    if (like) return like
  }
  return typeToString(checker, type)
}

export function typeToString(checker: ts.TypeChecker, type: ts.Type) {
  return getSimpleInferredInterface(checker, type)
}

export function getSimpleInferredInterface(checker, type) {
  const inferred = getInferredInterface(checker, type, false)
  if (Array.isArray(inferred)) {
    return `{${inferred
      .map((val) => {
        return typeof val !== 'object' ? val.toString() : '{ .. }'
      })
      .join(' | ')}}`
  } else if (typeof inferred === 'object') {
    if (inferred.__isSimple) {
      return inferred.type
    } else {
      const keys = Object.keys(inferred)
      if (keys.length === 1) {
        const key = keys[0]
        const type = inferred[key]
        if (typeof type === 'object') {
          return `{ ${key}: { ${Object.keys(type).join(', ')} }}`
        } else {
          return `{ ${key}: ${type} }`
        }
      } else {
        return `{ ${keys.join(', ')} }`
      }
    }
  }
  return inferred
}

export function getInferredInterface(checker, type, useAny) {
  const symbol = type.getSymbol()
  if (isSimpleType(type) || isFunctionType(checker, type) || !symbol || symbol.flags & ts.SymbolFlags.TypeLiteral) {
    return checker.typeToString(type)
  } else if (type['types']) {
    return type['types'].map((t) => {
      return getInferredInterface(checker, t, useAny)
    })
  } else if (symbol.flags & ts.SymbolFlags.ObjectLiteral) {
    const declaration = symbol.getDeclarations()[0]
    const inner = {}
    const children = declaration.properties || declaration.parameters
    children.forEach((prop) => {
      const type = checker.getTypeAtLocation(prop)
      const isOpt = !!(prop.flags & ts.SymbolFlags.Optional)
      const name = `${prop.name.escapedText}${isOpt ? '?' : ''}`
      inner[name] = getInferredInterface(checker, type, useAny)
    })
    return inner
  } else {
    return useAny ? `any /* ${symbol.escapedName} */` : symbol.escapedName
  }
}

export function min(maxs, type, max = MAX_COLUMN_WIDTH) {
  type = type.replace(' | undefined', '').replace(/\\n/g, '')
  if (type.length > max) {
    type = `${type.substr(0, max / 4)}...${type.substr(-max / 2)}  ${maxs ? addNote(maxs, type) : ''}`
  }
  return type
}

export function typeInterfaces(key, map, moreMap) {
  if (key) {
    const prop = map[key]
    const interfaceKey = prop?.altParentInfo?.fullText || '-none-'
    let props = moreMap[interfaceKey]
    if (!props) {
      props = moreMap[interfaceKey] = []
    }
    props.push(prop)
  }
}

export function asTypeInterfaces(conflicts, targetMap, sourceMap) {
  const targetInterfaceMap = {}
  const sourceInterfaceMap = {}
  conflicts.forEach(({ target, source }) => {
    typeInterfaces(target, targetMap, targetInterfaceMap)
    typeInterfaces(source, sourceMap, sourceInterfaceMap)
  })
  return { targetInterfaceMap, sourceInterfaceMap }
}

export function andMore(interfaces, conflicts, { sourceInterfaceMap, targetInterfaceMap }) {
  let base = `                ...and ${conflicts.length - 6} more ...`
  ;[sourceInterfaceMap, targetInterfaceMap].forEach((map = {}) => {
    Object.keys(map).forEach((key, inx) => {
      const props = map[key]
      if (props[0].altParentInfo) {
        const num = String.fromCharCode('\u2474'.charCodeAt(0) + inx)
        interfaces.push(`\n${num}  ${key}: ${props[0].altParentInfo.nodeLink}}`)
        interfaces.push(chalk.red(`${props.map(({ nodeText }) => nodeText).join(', ')}`))
        base += `${num}  `
      }
    })
  })
  return base
}

export function addNote(maxs: string[], note?: string) {
  const num = String.fromCharCode('\u24B6'.charCodeAt(0) + maxs.length)
  maxs.push(`${chalk.bold(num)} ${note}`)
  return num
}

export function addLink(links: string[], spacer, link?: string, color?: string) {
  const num = String.fromCharCode('\u2460'.charCodeAt(0) + links.length)
  let fullNote = `${chalk.bold(num)}${spacer}${link}`
  if (color) fullNote = chalk[color](fullNote)
  links.push(fullNote)
  return num
}

export function isSimpleType(type: ts.Type | ts.TypeFlags) {
  const flags = type['flags'] ? type['flags'] : type
  return (
    !(
      flags & ts.TypeFlags.StructuredType ||
      flags & ts.TypeFlags.Undefined ||
      flags & ts.TypeFlags.Never ||
      flags & ts.TypeFlags.Null
    ) || !!(flags & ts.TypeFlags.Boolean)
  )
}

export function isNeverType(type: ts.Type) {
  if (type.flags & ts.TypeFlags.Object) {
    const typeArguments = type['typeArguments']
    if (!Array.isArray(typeArguments) || typeArguments.length !== 1) {
      return false
    }
    type = typeArguments[0]
  }
  return type.flags & ts.TypeFlags.Never
}

export function isLikeTypes(source: ts.Type | ts.TypeFlags, target: ts.Type | ts.TypeFlags) {
  const sourceFlags = source['flags'] ? source['flags'] : source
  const targetFlags = target['flags'] ? target['flags'] : target
  return [
    ts.TypeFlags.StringLike,
    ts.TypeFlags.BigIntLike,
    ts.TypeFlags.NumberLike,
    ts.TypeFlags.ESSymbolLike,
    ts.TypeFlags.EnumLiteral,
  ].some((flag) => {
    return sourceFlags & flag && targetFlags & flag
  })
}

export function isStructuredType(type: ts.Type | ts.TypeFlags | undefined) {
  if (type) {
    const flags = type['flags'] ? type['flags'] : type
    return !!(flags & ts.TypeFlags.StructuredType)
  }
  return false
}

export function isArrayType(checker: ts.TypeChecker, type: ts.Type) {
  return checker.typeToTypeNode(type, undefined, 0)?.kind === ts.SyntaxKind.ArrayType
}

export function isFunctionType(checker: ts.TypeChecker, type: ts.Type) {
  return checker.typeToTypeNode(type, undefined, 0)?.kind === ts.SyntaxKind.FunctionType
}

export function getTypeLink(type: ts.Type) {
  const declarations = type.getSymbol()?.getDeclarations()
  return getNodeLink(declarations ? declarations[0] : undefined)
}

export function findParentExpression(expression) {
  while (expression.expression) {
    expression = expression.expression
    if ([ts.SyntaxKind.Identifier, ts.SyntaxKind.PropertyAccessExpression].includes(expression.kind)) {
      return expression
    }
  }
  return undefined
}

export function getNodeLink(node: ts.Node | undefined) {
  if (node) {
    const file = node.getSourceFile()
    let fileName: string = file.fileName
    if (fileName.startsWith(process.cwd()) && !fileName.includes('node_modules/')) {
      fileName = path.relative(global.rootPath || process.argv[1], fileName)
      let arr: string[] = fileName.split('/')
      if (arr[0] === '..') arr.shift()
      fileName = arr.slice(-4).join('/')
    } else {
      fileName = fileName.split(global.homedir).join('~')
    }
    return `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
  }
  return ''
}

export function mergeShapeProblems(s2tProblem: IShapeProblem, t2sProblem: IShapeProblem): IShapeProblem {
  const problem: IShapeProblem = {
    matched: s2tProblem?.matched || [], //always the same
    mismatch: s2tProblem?.mismatch || [], //always the same
    misslike: s2tProblem?.misslike || [], //always the same
    unchecked: s2tProblem?.unchecked || [], //always the same
    missing: s2tProblem?.missing || [], // different between reversed case
    optional: s2tProblem?.optional || [],
    reversed: {
      missing: t2sProblem?.missing || [],
      optional: t2sProblem?.optional || [],
    },
    overlap: s2tProblem?.overlap || 0,
    total: Math.max(s2tProblem?.total || 0, t2sProblem?.total || 0),
    sourceInfo: s2tProblem?.sourceInfo || t2sProblem?.sourceInfo,
    targetInfo: s2tProblem?.targetInfo || t2sProblem?.targetInfo,
    isShapeProblem: true,
  }
  return problem
}

// if there's multiple problems, find a union type, find the one with the most overlap
export function filterProblems(typeProblem: ITypeProblem | undefined, shapeProblems: IShapeProblem[]) {
  let problems: any[] = []
  if (shapeProblems.length) {
    problems = shapeProblems
    if (shapeProblems.length > 1) {
      // if any miss likes, just use those
      problems = shapeProblems.filter(({ misslike }) => misslike.length > 0)
      if (problems.length === 0) {
        // sort problem with the most overlap for the smallest # of props
        shapeProblems.sort((a, b) => {
          if (a.overlap !== b.overlap) {
            return b.overlap - a.overlap
          }
          return a.total - b.total
        })
        // if the top shape problem has over 50% overlap, just show it
        // if no good overlap, show all the types, let the user decide
        const top = shapeProblems[0]
        if (
          top.overlap / (top.total - top.optional.length) > 0.5 ||
          (top.reversed && top.reversed.optional && top.overlap / (top.total - top.reversed.optional.length) > 0.5)
        ) {
          problems = [top]
        } else {
          problems = shapeProblems
        }
      }

      // if multiple types or if there's a miss like type, show the optionals too for context
      if (problems.length > 1 || (problems.length === 1 && problems[0].misslike.length > 0)) {
        problems.forEach((problem) => {
          problem.contextual = problem.optional
          if (problem.reversed) {
            problem.reversed.contextual = problem.reversed.optional
          }
        })
      }
    }
  } else {
    problems = [typeProblem]
  }
  return problems
}

export function isFunctionLikeKind(kind: ts.SyntaxKind) {
  switch (kind) {
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassStaticBlockDeclaration:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.CallSignature:
    case ts.SyntaxKind.ConstructSignature:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.DeleteExpression:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.IndexSignature:
    case ts.SyntaxKind.TypePredicate:
    case ts.SyntaxKind.ConstructorType:
    case ts.SyntaxKind.TypeQuery:
    case ts.SyntaxKind.FunctionDeclaration:
      return true
    default:
      return false
  }
}

export function getClosestTarget(checker, errorNode: ts.Node) {
  const errorType = checker.getTypeAtLocation(errorNode)
  return (
    ts.findAncestor(errorNode, (node) => {
      return (
        !!node &&
        (node.kind === ts.SyntaxKind.ReturnStatement ||
          node.kind === ts.SyntaxKind.VariableDeclaration ||
          node.kind === ts.SyntaxKind.ExpressionStatement ||
          (node.kind === ts.SyntaxKind.PropertyAccessExpression && !!(errorType.flags & ts.TypeFlags.Any)) ||
          node.kind === ts.SyntaxKind.CallExpression)
      )
    }) || errorNode
  )
}

export function getNodeModules(cache, nodeInfos) {
  const libs = new Set()
  nodeInfos.forEach(({ primeInfo }) => {
    // get output node (location in output file we will be making changes)
    let inputNode = cache.getNode(primeInfo.declaredId || primeInfo.nodeId)
    let fileName = inputNode.getSourceFile().fileName
    // can't make changes to a library
    if (fileName.indexOf('/node_modules/') !== -1) {
      const arr = fileName.split('node_modules/')[1].split('/')
      let lib = arr[0]
      if (lib.startsWith('@')) {
        lib += `/${arr[1]}`
      }
      libs.add(lib)
    }
  })
  return libs.size ? `'${Array.from(libs).join(', ')}'` : ''
}

export function capitalize(str) {
  return str[0].toUpperCase() + str.slice(1).toLowerCase()
}
