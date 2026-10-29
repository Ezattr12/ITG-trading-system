/**
 * Single re-export point for @itg/calc — the one source of
 * financial calculations in this repo (packages/calc). The MCP
 * server never re-implements a calculation; it imports the same
 * pure functions the web app uses.
 *
 * The relative path (rather than the `@itg/calc` package name)
 * lets `tsc -p tsconfig.build.json` emit the calc sources into
 * dist/ alongside the server, so the compiled server runs with
 * plain `node` and no transpiler.
 */
export * from "../../../packages/calc/src/index.js";
