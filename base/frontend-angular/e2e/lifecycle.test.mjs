// Controller tests use a fake Docker executable. They never contact the Docker daemon.
// Kept separate from the automatic infrastructure suite to avoid spawning recursive runners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frontend } from './owned-stack.mjs';

const fakeDocker = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const root = process.env.CONTROLLER_ROOT;
const scenario = process.env.CONTROLLER_SCENARIO;
fs.appendFileSync(path.join(root, 'docker-calls.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] === 'compose' && args.includes('up')) {
  if (scenario === 'cleanup-failure') {
    // Successful fake startup and Playwright --list; cleanup is the only failing operation.
    const child = spawn(process.execPath, ['-e',
      'const http=require("node:http"); for(const port of [process.env.E2E_API_PORT,process.env.E2E_WEB_PORT]) http.createServer((req,res)=>res.end("{} ")).listen(Number(port),"127.0.0.1");'
    ], { env: process.env, stdio: 'ignore' });
    child.unref();
    fs.writeFileSync(path.join(root, 'fake-server-pid'), String(child.pid));
    fs.writeFileSync(path.join(root, 'fake-state.json'), JSON.stringify({
      project: args[args.indexOf('-p') + 1], owner: process.env.E2E_OWNER,
      apiPort: process.env.E2E_API_PORT, webPort: process.env.E2E_WEB_PORT,
    }));
    process.exit(0);
  }
  if (scenario === 'write-failure') {
    const output = fs.readdirSync(process.env.E2E_OUTPUT_DIR).find(name => name.startsWith('beneficiary-e2e-'));
    const log = path.join(process.env.E2E_OUTPUT_DIR, output, 'runner.log');
    fs.rmSync(log, { force: true });
    fs.mkdirSync(log);
  }
  fs.writeFileSync(path.join(root, 'fake-child-pid'), String(process.pid));
  fs.writeFileSync(path.join(root, 'ready'), 'active');
  console.log('Controlled active Docker child');
  setInterval(() => {}, 1000);
} else if (args[0] === 'compose' && args.includes('logs')) {
  console.log('Controlled fake Docker logs');
} else if (args[0] === 'compose' && args.includes('down')) {
  if (scenario === 'cleanup-failure') {
    process.kill(Number(fs.readFileSync(path.join(root, 'fake-server-pid'), 'utf8')), 'SIGTERM');
    process.exit(7);
  }
  process.exit(0);
} else if (args[0] === 'ps') {
  if (scenario === 'cleanup-failure') console.log(args.some(arg => arg.endsWith('=api')) ? 'api' : args.some(arg => arg.endsWith('=web')) ? 'web' : 'api\\nweb');
} else if (args[0] === 'inspect' && scenario === 'cleanup-failure') {
  const state = JSON.parse(fs.readFileSync(path.join(root, 'fake-state.json'), 'utf8'));
  const service = args[1];
  console.log(JSON.stringify([{ Config: { Labels: {
    'com.docker.compose.project': state.project, 'com.docker.compose.service': service, 'nxt.e2e.owner': state.owner,
  } }, NetworkSettings: { Ports: { [service === 'api' ? '8080/tcp' : '80/tcp']:
    [{ HostIp: '127.0.0.1', HostPort: state[service + 'Port'] }],
  } } }]));
} else if (['volume', 'network'].includes(args[0]) && args[1] === 'ls') {
  process.exit(0);
} else {
  console.error('Unexpected fake Docker command');
  process.exit(99);
}
`;

async function controlledRun(scenario, signal) {
  const directory = mkdtempSync(join(tmpdir(), 'e2e-controller-'));
  const bin = join(directory, 'bin');
  const artifacts = join(directory, 'artifacts');
  mkdirSync(bin);
  mkdirSync(artifacts);
  writeFileSync(join(bin, 'docker'), fakeDocker);
  chmodSync(join(bin, 'docker'), 0o700);
  const child = spawn(process.execPath, [join(frontend, 'e2e/run.mjs'), ...(scenario === 'cleanup-failure' ? ['--list'] : [])], {
    cwd: frontend, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, E2E_OUTPUT_DIR: artifacts,
      CONTROLLER_ROOT: directory, CONTROLLER_SCENARIO: scenario },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output += chunk);
  let deadline;
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, receivedSignal) => resolve({ code, signal: receivedSignal }));
    deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Controller timed out: ${output}`)); }, 20_000);
  });
  completion.catch(() => {}); // The readiness loop observes exit before awaiting completion.
  try {
    if (signal) {
      while (!existsSync(join(directory, 'ready'))) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Runner exited before active child: ${output}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      child.kill(signal);
    }
    const exit = await completion;
    const childDirectory = readdirSync(artifacts).find(name => name.startsWith('beneficiary-e2e-'));
    const result = JSON.parse(readFileSync(join(artifacts, childDirectory, 'result.json'), 'utf8'));
    const calls = readFileSync(join(directory, 'docker-calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    return { exit, result, calls, output };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const marker of ['fake-server-pid', 'fake-child-pid']) {
      if (existsSync(join(directory, marker))) {
        try { process.kill(Number(readFileSync(join(directory, marker), 'utf8')), 'SIGTERM'); } catch { /* Already removed by runner/fake cleanup. */ }
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`${signal} during active child preserves exit${code}, writes result and invokes exact owned cleanup`, async () => {
    const { exit, result, calls } = await controlledRun('signal', signal);
    assert.equal(exit.code, code);
    assert.equal(exit.signal, null);
    assert.equal(result.exitCode, code);
    assert.equal(result.interrupted, code);
    const cleanup = calls.find(args => args.includes('down'));
    assert.ok(cleanup);
    assert.equal(cleanup[cleanup.indexOf('-p') + 1], result.project);
    assert.ok(cleanup.includes('-v'));
    assert.ok(calls.find(args => args.includes('logs')));
  });
}

test('artifact streaming write failure terminates child, returns nonzero and still invokes owned cleanup', async () => {
  const { exit, result, calls, output } = await controlledRun('write-failure');
  assert.equal(exit.code, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.interrupted, 0);
  assert.match(output, /EISDIR/);
  assert.ok(calls.find(args => args.includes('down')));
});

test('cleanup failure remains nonzero and is reported in result and diagnostics', async () => {
  const { exit, result, calls, output } = await controlledRun('cleanup-failure');
  assert.equal(exit.code, 1);
  assert.equal(result.exitCode, 1);
  assert.match(output, /Total: [1-9][0-9]* tests/);
  assert.match(output, /Owned cleanup failed/);
  assert.ok(calls.find(args => args.includes('down')));
});
