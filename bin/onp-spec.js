#!/usr/bin/env node
import { run } from '../src/cli.js';

// process.exitCode (not process.exit()): guarantees stdout flush on pipes.
// With process.exit(), large outputs (audit --json) were truncated at ~8KB.
run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`error: ${err.message}`);
    process.exitCode = 2;
  }
);
