import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import paths from './paths.cjs';

export const { frontend, repository, composeFile } = paths;

export function externalDirectory(directory) {
  let ancestor = resolve(directory);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const real = resolve(realpathSync(ancestor), resolve(directory).slice(ancestor.length).replace(/^[/\\]+/, ''));
  if (real === repository || real.startsWith(repository + sep)) throw new Error('Artifacts must be outside repository');
  return real;
}
export function validateState(state) {
  if (!/^nxt-e2e-[a-f0-9]{24}$/.test(state?.project) || !/^[a-f0-9]{32}$/.test(state.owner)) {
    throw new Error('Missing runner ownership');
  }
  for (const port of [state.apiPort, state.webPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || [4200, 9999].includes(port)) {
      throw new Error('Invalid disposable port');
    }
  }
  externalDirectory(state.output);
  const proxy = new URL(state.proxy);
  if (proxy.protocol !== 'http:' || proxy.hostname !== '127.0.0.1' || !proxy.port || proxy.username || proxy.password) {
    throw new Error('Invalid runner proxy');
  }
  return state;
}
export function loadState() {
  if (!process.env.E2E_STATE) throw new Error('Run npm run test:e2e; live endpoints are forbidden');
  return assertRuntime(JSON.parse(readFileSync(process.env.E2E_STATE, 'utf8')));
}
export function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error || result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
export function composeArgs(state, args) {
  if (!/^nxt-e2e-[a-f0-9]{24}$/.test(state?.project) || !/^[a-f0-9]{32}$/.test(state.owner)) throw new Error('Invalid owner');
  return ['compose', '-f', composeFile, '-p', state.project, ...args];
}
export function assertOwned(container, state, service, execute = docker) {
  composeArgs(state, []);
  const info = JSON.parse(execute(['inspect', container]))[0];
  const labels = info?.Config?.Labels;
  if (labels?.['com.docker.compose.project'] !== state.project ||
      labels?.['nxt.e2e.owner'] !== state.owner ||
      labels?.['com.docker.compose.service'] !== service) throw new Error('Container ownership mismatch');
  return info;
}
export function containerFor(state, service, execute = docker) {
  composeArgs(state, []);
  if (!['api', 'web', 'postgres'].includes(service)) throw new Error('Unknown service');
  const ids = execute(['ps', '-aq', '--filter', `label=com.docker.compose.project=${state.project}`,
    '--filter', `label=com.docker.compose.service=${service}`]).split(/\s+/).filter(Boolean);
  if (ids.length !== 1) throw new Error(`Expected one owned ${service}`);
  assertOwned(ids[0], state, service, execute);
  return ids[0];
}
export function assertBinding(state, service, execute = docker) {
  if (!['api', 'web'].includes(service)) throw new Error('Unknown binding service');
  const container = containerFor(state, service, execute);
  const info = assertOwned(container, state, service, execute);
  const binding = info?.NetworkSettings?.Ports?.[service === 'api' ? '8080/tcp' : '80/tcp'];
  const port = service === 'api' ? state.apiPort : state.webPort;
  if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || Number(binding[0].HostPort) !== port) {
    throw new Error(`${service} disposable binding mismatch`);
  }
  return container;
}
export function assertRuntime(state, execute = docker) {
  validateState(state);
  assertBinding(state, 'api', execute);
  assertBinding(state, 'web', execute);
  return state;
}
export function assertProjectOwned(state, execute = docker) {
  composeArgs(state, []);
  const ids = execute(['ps', '-aq', '--filter', `label=com.docker.compose.project=${state.project}`]).split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const info = JSON.parse(execute(['inspect', id]))[0];
    const service = info?.Config?.Labels?.['com.docker.compose.service'];
    if (!['api', 'web', 'postgres'].includes(service)) throw new Error('Unexpected project service');
    assertOwned(id, state, service, execute);
  }
  for (const type of ['volume', 'network']) {
    const names = execute([type, 'ls', '-q', '--filter', `label=com.docker.compose.project=${state.project}`]).split(/\s+/).filter(Boolean);
    for (const name of names) {
      const info = JSON.parse(execute([type, 'inspect', name]))[0];
      if (info.Labels?.['com.docker.compose.project'] !== state.project || info.Labels?.['nxt.e2e.owner'] !== state.owner) {
        throw new Error(`${type} ownership mismatch`);
      }
    }
  }
}
export async function waitReady(state, path = '/health', port = state.apiPort) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) return;
    } catch { /* Wait for migrations/startup, using readiness rather than fixed sleep. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Disposable service not ready: ${path}`);
}
export function cleanupProject(state, options = {}, execute = docker) {
  assertProjectOwned(state, execute);
  return execute(composeArgs(state, ['down', '-v', '--rmi', 'local', '--timeout', '10']), options);
}
export async function restartApi(state) {
  assertRuntime(state);
  docker(['restart', containerFor(state, 'api')]);
  assertRuntime(state);
  await waitReady(state);
}
export async function resetDatabase(state, execute = docker) {
  assertRuntime(state, execute);
  const api = containerFor(state, 'api', execute);
  const db = containerFor(state, 'postgres', execute);
  execute(['stop', api]);
  // This is the only reset SQL. It cannot accept caller-provided tables or commands.
  assertOwned(db, state, 'postgres', execute);
  execute(['exec', db, 'psql', '-U', 'desafio', '-d', 'desafio', '-v', 'ON_ERROR_STOP=1', '-c',
    'TRUNCATE TABLE "Beneficiarios", "Planos" CASCADE;']);
  assertOwned(api, state, 'api', execute);
  execute(['start', api]);
  assertRuntime(state, execute);
  await waitReady(state);
}
