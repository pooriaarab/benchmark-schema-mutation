#!/usr/bin/env node
import { createCli } from "benchmark-core";
import { benchmark } from "./benchmark.js";
process.exitCode = await createCli(benchmark, { bin: "benchmark-schema-mutation" }).main(process.argv.slice(2));
