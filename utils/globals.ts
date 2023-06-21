import ts from 'typescript'
declare global {
  var rootPath: string
  var homedir: string
  var options: ts.CompilerOptions
  var isVerbose: boolean
}

export {}
