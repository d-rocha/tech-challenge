// Native CJS boundary: usable by Node ESM runner and Playwright's TS/CJS config loader.
const { resolve } = require('node:path');
const frontend = resolve(__dirname, '..');
module.exports = {
  frontend,
  repository: resolve(frontend, '../..'),
  composeFile: resolve(__dirname, 'docker-compose.yml'),
};
