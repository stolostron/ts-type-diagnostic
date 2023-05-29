#!/usr/bin/env node

import { startSniffing } from './src/theHound'

let isVerbose
const fileNames = process.argv.slice(2).filter((arg) => {
  if (arg.startsWith('-')) {
    if (arg.startsWith('-v') || arg.startsWith('--v')) isVerbose = true
    return false
  }
  return true
})

startSniffing(fileNames, isVerbose)
