import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startProxy } from './proxy.mjs';
import { runChild } from './child-process.mjs';
import { safeArguments } from './cli.mjs';
import { choosePorts } from './ports.mjs';
import { frontend, externalDirectory, composeArgs, docker, assertBinding, cleanupProject, waitReady } from './owned-stack.mjs';

const argumentsForTests = safeArguments(process.argv.slice(2));
const ports = await choosePorts();
const parent = process.env.E2E_OUTPUT_DIR ? resolve(process.env.E2E_OUTPUT_DIR) : tmpdir();
externalDirectory(parent);
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, 'beneficiary-e2e-'));
const state = { project: `nxt-e2e-${randomBytes(12).toString('hex')}`, owner: randomBytes(16).toString('hex'), output, ...ports };
const env = { ...process.env, E2E_OWNER: state.owner, E2E_API_PORT: String(state.apiPort), E2E_WEB_PORT: String(state.webPort) };
let active;
let interrupted = 0;
let proxy;
let failure = 0;
let attemptedCompose = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    interrupted = code;
    active?.kill('SIGTERM');
  });
}
async function run(command, args, extraEnv = {}) {
  if (interrupted) throw new Error('Run interrupted');
  await runChild(command, args, { cwd: frontend, env: { ...env, ...extraEnv },
    log: join(output, 'runner.log'), onChild: child => { active = child; } });
  if (interrupted) throw new Error('Run interrupted');
}
function diagnosticWrite(filename, contents, append = false) {
  try {
    (append ? appendFileSync : writeFileSync)(join(output, filename), contents);
  } catch (error) {
    failure = 1;
    console.error(`Artifact write failed (${filename}): ${error.message}`);
  }
}
console.log(`Disposable project: ${state.project}\nArtifacts: ${output}`);
try {
  writeFileSync(join(output, 'ownership.json'), JSON.stringify(state, null, 2));
  await run(process.execPath, ['--test', resolve(frontend, 'e2e/infrastructure.test.mjs')]);
  attemptedCompose = true;
  await run('docker', composeArgs(state, ['up', '--build', '-d']));
  assertBinding(state, 'api');
  assertBinding(state, 'web');
  await waitReady(state);
  await waitReady(state, '/', state.webPort);
  proxy = await startProxy(state);
  state.proxy = proxy.url;
  const stateFile = join(output, 'state.json');
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  await run(process.execPath, [resolve(frontend, 'node_modules/@playwright/test/cli.js'), 'test', ...argumentsForTests], { E2E_STATE: stateFile });
} catch (error) {
  failure = 1;
  console.error(error.message);
  diagnosticWrite('runner.log', `\n${error.stack}\n`, true);
} finally {
  try {
    if (attemptedCompose) {
      const logs = docker(composeArgs(state, ['logs', '--no-color']), { env });
      writeFileSync(join(output, 'compose.log'), logs);
    }
  } catch (error) {
    failure = 1;
    console.error(`Log capture failed: ${error.message}`);
  }
  try { await proxy?.close(); } catch (error) { failure = 1; console.error(error.message); }
  try {
    if (attemptedCompose) cleanupProject(state, { env });
  } catch (error) {
    failure = 1;
    console.error(`Owned cleanup failed: ${error.message}`);
  }
  const exitCode = interrupted || failure;
  diagnosticWrite('result.json', JSON.stringify({ project: state.project, exitCode, interrupted, output }, null, 2));
  console.log(`Artifacts retained: ${output}\nExit: ${interrupted || failure}`);
  process.exitCode = interrupted || failure;
}
