import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function runChild(command, args, { cwd, env, log, onChild, append = appendFileSync }) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    onChild?.(child);
    let failure;
    let killTimer;
    const fail = error => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      killTimer.unref();
    };
    for (const [stream, terminal] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', chunk => {
        if (failure) return;
        try {
          terminal.write(chunk);
          append(log, chunk);
        } catch (error) { fail(error); }
      });
      stream.on('error', fail);
    }
    child.once('error', error => { failure ??= error; });
    child.once('close', (code, signal) => {
      clearTimeout(killTimer);
      onChild?.(undefined);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command} exited ${code ?? signal}`));
      else done();
    });
  });
}
