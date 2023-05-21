#!/usr/bin/env node

import * as yargs from 'yargs'
import { startSniffing } from './the-hound'

let args = yargs.option('verbose', {
  alias: 'v',
  demand: false,
}).argv

startSniffing(args._, args.verbose)
