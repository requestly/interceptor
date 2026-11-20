// Unit tests for the recorder's pure modules. Compiles them with the repo's own tsc and runs them with
// Node's built-in test runner, so no test dependency is added. Run from mv3: npm run test:recorder
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const mv3 = path.resolve(__dirname, "../..");
const outDir = path.join(mv3, ".test-build");

fs.rmSync(outDir, { recursive: true, force: true });

const compile = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", path.join(__dirname, "tsconfig.json")],
  { stdio: "inherit", cwd: mv3 }
);
if (compile.status !== 0) process.exit(compile.status === null ? 1 : compile.status);

const compiledDir = path.join(outDir, "mv3/tests/recorder");
const files = fs
  .readdirSync(compiledDir)
  .filter((file) => file.endsWith(".test.js"))
  .map((file) => path.join(compiledDir, file));

const run = spawnSync(process.execPath, ["--require", path.join(__dirname, "register.js"), "--test", ...files], {
  stdio: "inherit",
  cwd: mv3,
  env: { ...process.env, UPDATE_GOLDEN: process.env.UPDATE_GOLDEN || "" },
});
process.exit(run.status === null ? 1 : run.status);
