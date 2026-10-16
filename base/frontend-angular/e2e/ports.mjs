import net from 'node:net';

export async function choosePorts() {
  const reservations = [];
  try {
    for (let index = 0; index < 2; index++) {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      reservations.push(server);
    }
    const [apiPort, webPort] = reservations.map(server => server.address().port);
    if ([apiPort, webPort].some(port => [4200, 9999].includes(port))) throw new Error('Reserved development port selected');
    return { apiPort, webPort };
  } finally {
    await Promise.all(reservations.map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  }
}
