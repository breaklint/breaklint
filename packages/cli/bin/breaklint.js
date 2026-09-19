#!/usr/bin/env node
import { runCliAndExit } from "../dist/cli.js";

await runCliAndExit(process.argv.slice(2));
