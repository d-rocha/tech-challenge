import http from 'node:http';

export function destination(raw, endpoints) {
  const url = new URL(raw);
  if (url.username || url.password || url.protocol !== 'http:') throw new Error('Target rejected');
  const port = url.origin === 'http://localhost:4200' ? endpoints.webPort
    : url.origin === 'http://localhost:9999' ? endpoints.apiPort : null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Target rejected');
  return { hostname: '127.0.0.1', port, path: url.pathname + url.search };
}

export async function startProxy(endpoints) {
  const server = http.createServer((request, response) => {
    let target;
    try { target = destination(request.url, endpoints); }
    catch { response.writeHead(403); response.end('Target rejected'); return; }
    const upstream = http.request({ ...target, method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.on('error', () => response.destroy());
      incoming.on('aborted', () => response.destroy());
      incoming.pipe(response);
    });
    upstream.on('error', () => {
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(502);
      response.end('Disposable upstream unavailable');
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
