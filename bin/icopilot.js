#!/usr/bin/env node
// iCopilot entrypoint — delegates to the compiled ESM bundle.
import('../dist/index.js').catch((err) => {
  console.error('\x1b[31m[icopilot] fatal:\x1b[0m', err?.stack || err);
  process.exit(1);
});
