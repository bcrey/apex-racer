import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

const children = [];
let shuttingDown = false;

function startProcess(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  children.push(child);

  child.on('exit', (code) => {
    if (!shuttingDown) {
      shuttingDown = true;
      for (const runningChild of children) {
        if (!runningChild.killed) {
          runningChild.kill('SIGTERM');
        }
      }
    }

    if (typeof code === 'number' && code !== 0) {
      process.exitCode = code;
    }
  });
}

function stopChildren(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on('SIGINT', () => stopChildren('SIGINT'));
process.on('SIGTERM', () => stopChildren('SIGTERM'));

startProcess('node', ['--watch', 'server/index.mjs'], {PORT: '3001'});
startProcess('node', [viteBin, '--port', '3000', '--host', '0.0.0.0']);
