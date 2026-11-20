// Resolves the extension's `common/*` alias to the compiled copy under .test-build.
const Module = require("module");
const path = require("path");

const commonRoot = path.resolve(__dirname, "../../.test-build/common/src");
const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  const aliased = request.startsWith("common/") ? path.join(commonRoot, request.slice("common/".length)) : request;
  return resolveFilename.call(this, aliased, ...rest);
};
