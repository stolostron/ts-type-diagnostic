/* Copyright Contributors to the Open Cluster Management project */
export const MAX_SHOWN_PROP_MISMATCH = 6
export const MAX_COLUMN_WIDTH = 80

export enum MatchType {
  match = 0,
  mismatch = 1, // simple !== simple
  bigley = 2, // shape !== simple
  never = 3,
  recurse = 4, // can't decide till we recurse into a shape
}

export enum ErrorType {
  none = 0,
  mismatch = 1,
  misslike = 2,
  objectToSimple = 3,
  simpleToObject = 4,
  arrayToNonArray = 5,
  nonArrayToArray = 6,
  sourcePropMissing = 7,
  targetPropMissing = 8,
  propMismatch = 9,
  bothMissing = 10,
  both = 11,
  missingIndex = 12,
  mustDeclare = 13,
  tooManyArgs = 14,
  tooFewArgs = 15,
}

export interface IPlaceholder {
  isPlaceholder?: boolean
}
export interface IPlaceholderInfo extends IPlaceholder {
  // when comparing with a placeholder (source) what key in target are we comparing
  placeholderTargetKey?: string
}

export interface ITypeInfo extends IPlaceholderInfo {
  typeText: string
  typeId?: number
}

export interface INodeInfo extends ITypeInfo {
  nodeText?: string
  fullText?: string
  nodeLink?: string
}

export interface IProblem {
  sourceInfo: INodeInfo
  targetInfo: INodeInfo
}

export interface ITypeProblem extends IProblem {
  sourceIsArray?: boolean
  targetIsArray?: boolean
}

export interface IShapeProblem extends IProblem {
  matched: string[] // property name that exists in both types and has the same type
  mismatch: string[] // property name that exists in both types and has the different types
  misslike: string[] // mismatched but between stringliteral and string, etc
  missing: string[] // missing on the other side
  optional: string[] // missing on the other type but optional
  unchecked: string[] // child shape types not yet checked because of the problem in this type
  contextual?: string[] // added for context with placeholders
  reversed?: {
    // when compared in the other direction
    missing: string[]
    optional: string[]
    contextual?: string[]
  }
  overlap: number // when there's a type union, use to find the type that has the best overlap
  total: number
  isShapeProblem: true
}

export function isShapeProblem(object: any): object is IShapeProblem {
  return 'isShapeProblem' in object
}

export type DiffTableType = { source?: string; target?: string }[]
