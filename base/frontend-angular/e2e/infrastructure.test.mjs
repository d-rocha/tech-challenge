import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { destination, startProxy } from './proxy.mjs';
import { safeArguments } from './cli.mjs';
import { choosePorts } from './ports.mjs';
import { persistedRecord } from './records.mjs';
import { assertOwned, assertProjectOwned, containerFor, composeArgs, validateState, cleanupProject, resetDatabase, externalDirectory, repository, assertBinding, assertRuntime } from './owned-stack.mjs';

const state = { project: `nxt-e2e-${'a'.repeat(24)}`, owner: 'b'.repeat(32) };
const labels = { 'com.docker.compose.project': state.project, 'com.docker.compose.service': 'api', 'nxt.e2e.owner': state.owner };

test('proxy rejects all destinations except the exact native HTTP origins', () => {
  const endpoints = { apiPort: 12345, webPort: 12346 };
  assert.deepEqual(destination('http://localhost:9999/beneficiarios?pagina=2', endpoints), {
    hostname: '127.0.0.1', port: 12345, path: '/beneficiarios?pagina=2',
  });
  for (const target of ['http://localhost:9998/', 'http://127.0.0.1:9999/', 'https://localhost:9999/',
    'http://example.com/', 'http://user@localhost:9999/', '/relative']) {
    assert.throws(() => destination(target, endpoints));
  }
  assert.throws(() => destination('http://localhost:9999/', {}));
});

test('routing preserves request method/body/Origin and native response status/body/CORS', async () => {
  let received;
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = { method: req.method, body, origin: req.headers.origin, host: req.headers.host, custom: req.headers['x-test'] };
    res.writeHead(422, { 'content-type': 'application/json', 'access-control-allow-origin': 'http://localhost:4200', 'x-upstream': 'preserved' });
    res.end('{"mensagem":"real response"}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = await startProxy({ apiPort: upstream.address().port, webPort: upstream.address().port });
  try {
    const address = new URL(proxy.url);
    const result = await new Promise((resolve, reject) => {
      const request = http.request({ hostname: address.hostname, port: address.port,
        path: 'http://localhost:9999/beneficiarios', method: 'PUT',
        headers: { Host: 'localhost:9999', Origin: 'http://localhost:4200', 'x-test': 'unchanged' } }, response => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
      });
      request.on('error', reject);
      request.end('{"synthetic":true}');
    });
    assert.deepEqual(received, { method: 'PUT', body: '{"synthetic":true}', origin: 'http://localhost:4200', host: 'localhost:9999', custom: 'unchanged' });
    assert.equal(result.status, 422);
    assert.equal(result.body, '{"mensagem":"real response"}');
    assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:4200');
    assert.equal(result.headers['x-upstream'], 'preserved');
    const forbidden = await new Promise((resolve, reject) => {
      http.get({ hostname: address.hostname, port: address.port, path: 'http://example.com/' }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(forbidden, 403);
  } finally {
    await proxy.close();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('ownership guard accepts matching labels and rejects any missing or foreign label', () => {
  assertOwned('owned', state, 'api', () => JSON.stringify([{ Config: { Labels: labels } }]));
  for (const key of Object.keys(labels)) {
    const foreign = { ...labels, [key]: 'foreign' };
    assert.throws(() => assertOwned('foreign', state, 'api', () => JSON.stringify([{ Config: { Labels: foreign } }])), /ownership mismatch/);
  }
  assert.throws(() => assertOwned('unlabelled', state, 'api', () => '[{}]'), /ownership mismatch/);
});

test('invalid project and unknown/ambiguous service fail before any mutation', () => {
  let calls = 0;
  const execute = () => { calls++; return ''; };
  assert.throws(() => containerFor({ project: 'base', owner: state.owner }, 'api', execute));
  assert.throws(() => containerFor(state, 'arbitrary', execute));
  assert.equal(calls, 0);
  assert.throws(() => containerFor(state, 'api', () => 'first\nsecond'), /Expected one/);
  assert.throws(() => composeArgs({ project: 'base', owner: state.owner }, ['down', '-v']));
  assert.throws(() => validateState({ ...state, apiPort: 9999, webPort: 12345 }), /disposable port/);
  assert.throws(() => validateState({ ...state, apiPort: 12345, webPort: 4200 }), /disposable port/);
});

test('cleanup ownership audit rejects foreign containers, volumes and networks', () => {
  for (const foreignType of ['container', 'volume', 'network']) {
    const commands = [];
    const execute = args => {
      commands.push(args);
      if (args[0] === 'ps') return foreignType === 'container' ? 'foreign' : '';
      if (args[0] === 'inspect') return JSON.stringify([{ Config: { Labels: { ...labels, 'nxt.e2e.owner': 'foreign' } } }]);
      if (args[1] === 'ls') return args[0] === foreignType ? 'foreign' : '';
      return JSON.stringify([{ Labels: { ...labels, 'nxt.e2e.owner': 'foreign' } }]);
    };
    assert.throws(() => assertProjectOwned(state, execute), /ownership mismatch/);
    assert.ok(commands.every(args => !['down', 'exec', 'stop', 'restart', 'rm'].some(command => args.includes(command))));
  }
});


test('reset and cleanup refuse foreign resources before issuing destructive commands', async () => {
  const full = { ...state, apiPort: 12345, webPort: 12346, proxy: 'http://127.0.0.1:12347', output: tmpdir() };
  const commands = [];
  const execute = args => {
    commands.push(args);
    if (args[0] === 'ps') return args.some(arg => arg.endsWith('=postgres')) ? 'postgres' : args.some(arg => arg.endsWith('=web')) ? 'web' : 'api';
    const service = args[1];
    return JSON.stringify([{ Config: { Labels: { ...labels,
      'com.docker.compose.service': service,
      'nxt.e2e.owner': service === 'postgres' ? 'foreign' : state.owner,
    } }, NetworkSettings: { Ports: {
      [service === 'api' ? '8080/tcp' : '80/tcp']: [{ HostIp: '127.0.0.1', HostPort: service === 'api' ? '12345' : '12346' }],
    } } }]);
  };
  await assert.rejects(resetDatabase(full, execute), /ownership mismatch/);
  assert.ok(commands.every(args => !['stop', 'exec', 'start'].includes(args[0])));
  const foreign = args => args[0] === 'ps' ? 'foreign' : JSON.stringify([{ Config: { Labels: {} } }]);
  assert.throws(() => cleanupProject(state, {}, foreign), /Unexpected project service/);
  assert.throws(() => externalDirectory(repository + '/new-output/must-not-be-created'), /outside repository/);
});

test('CLI permits filtering and project selection but cannot change isolation or hide missing tests', () => {
  assert.deepEqual(safeArguments([]), []);
  assert.deepEqual(safeArguments(['--project=mobile', '-g', 'CRUD', '--grep-invert=synthetic', '--max-failures', '1', '--list', '-x']),
    ['--project', 'mobile', '--grep', 'CRUD', '--grep-invert', 'synthetic', '--max-failures', '1', '--list', '-x']);
  assert.deepEqual(safeArguments(['--project', 'desktop', '--grep=error', '--max-failures=2']),
    ['--project', 'desktop', '--grep', 'error', '--max-failures', '2']);
  for (const args of [['--workers=2'], ['--workers', '2'], ['--output=/tmp/x'], ['--output', '/tmp/x'],
    ['--config=other.ts'], ['--config', 'other.ts'], ['--pass-with-no-tests'], ['--retries=1'],
    ['--reporter=list'], ['--project=unknown'], ['--project'], ['--grep'], ['--grep='],
    ['--max-failures=invalid'], ['--list=false'], ['--'], ['unexpected.spec.ts']]) {
    assert.throws(() => safeArguments(args), args.join(' '));
  }
});

test('owned labels are insufficient when runtime ports or bind addresses differ', async () => {
  const full = { ...state, apiPort: 12345, webPort: 12346, proxy: 'http://127.0.0.1:12347', output: tmpdir() };
  const makeExecute = (changedService, binding) => args => {
    if (args[0] === 'ps') return args.some(arg => arg.endsWith('=web')) ? 'web' : 'api';
    const service = args[1];
    return JSON.stringify([{ Config: { Labels: { ...labels, 'com.docker.compose.service': service } },
      NetworkSettings: { Ports: { [service === 'api' ? '8080/tcp' : '80/tcp']:
        service === changedService ? binding : [{ HostIp: '127.0.0.1', HostPort: String(full[service + 'Port']) }],
      } } }]);
  };
  assert.equal(assertRuntime(full, makeExecute(null, null)), full);
  for (const service of ['api', 'web']) {
    for (const binding of [[], [{ HostIp: '0.0.0.0', HostPort: String(full[service + 'Port']) }],
      [{ HostIp: '127.0.0.1', HostPort: '43210' }]]) {
      const execute = makeExecute(service, binding);
      assert.throws(() => assertBinding(full, service, execute), /binding mismatch/);
      assert.throws(() => assertRuntime(full, execute), /binding mismatch/);
      await assert.rejects(resetDatabase(full, execute), /binding mismatch/);
    }
  }
});

test('port allocation chooses distinct disposable loopback ports and releases reservations', async () => {
  const ports = await choosePorts();
  assert.notEqual(ports.apiPort, ports.webPort);
  for (const port of Object.values(ports)) {
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
    assert.ok(![4200, 9999].includes(port));
  }
});


test('persistence comparison preserves all fields and validates timestamps at millisecond precision', () => {
  const before = { id: 'owned-record', nome_completo: 'Synthetic QA', cpf: 'synthetic',
    data_nascimento: '1990-05-12', status: 'ATIVO', plano_id: 'owned-plan', data_cadastro: '2026-10-16T12:00:00.0319014Z' };
  const after = { ...before, data_cadastro: '2026-10-16T12:00:00.031901Z' };
  assert.deepEqual(persistedRecord(before), persistedRecord(after));
  assert.notDeepEqual(persistedRecord(before), persistedRecord({ ...after, nome_completo: 'Changed' }));
  assert.notDeepEqual(persistedRecord(before), persistedRecord({ ...after, data_cadastro: '2026-10-16T12:00:00.032Z' }));
  for (const timestamp of [undefined, 'invalid', '2026-10-16T12:00:00', '2026-13-16T12:00:00Z', '2026-02-30T12:00:00Z']) {
    assert.throws(() => persistedRecord({ ...before, data_cadastro: timestamp }), /Invalid UTC/);
  }
});

test('proxy terminates a truncated upstream response promptly and continues serving later requests', async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/truncated') {
      res.writeHead(200, { 'content-length': '100' });
      res.write('incomplete');
      setImmediate(() => res.destroy());
    } else { res.end('still alive'); }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = await startProxy({ apiPort: upstream.address().port, webPort: upstream.address().port });
  const address = new URL(proxy.url);
  function request(path) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: address.hostname, port: address.port,
        path: 'http://localhost:9999' + path }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('Response aborted')));
        res.on('end', () => resolve(body));
      });
      req.setTimeout(2000, () => req.destroy(new Error('Response timed out')));
      req.on('error', reject);
    });
  }
  try {
    await assert.rejects(request('/truncated'), /aborted|socket hang up|reset/i);
    assert.equal(await request('/healthy'), 'still alive');
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});
