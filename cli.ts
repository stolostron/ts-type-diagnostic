#!/usr/bin/env node

import { startSniffing } from './utils/theHound'

let isFix: boolean = false
let isVerbose: boolean = false
const fileNames = process.argv.slice(2).filter((arg) => {
  if (arg.startsWith('-')) {
    if (arg.startsWith('-v') || arg.startsWith('--v')) isVerbose = true
    if (arg.startsWith('-f') || arg.startsWith('--f')) isFix = true
    return false
  }
  return true
})

startSniffing(fileNames, isVerbose, isFix)
