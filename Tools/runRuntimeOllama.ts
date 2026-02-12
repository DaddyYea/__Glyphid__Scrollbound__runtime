import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const rootDir = path.resolve(__dirname, '..');
const childProcesses: ChildProcess[] = [];

async function main() {
  console.log('=== Launching Scrollbound Runtime with Ollama ===\n');

  const PORT = Number(process.env.PORT) || 3000;

  console.log('[i] Using Ollama models (ensure Ollama is running)');
  console.log('[i] Expected: qwen2.5:7b and phi3:mini or similar\n');

  startRuntime(PORT);
  attachShutdownHandlers();
}

function startRuntime(port: number) {
  console.log(`[+] Starting Scrollbound runtime (server/index.ts) on port ${port}\n`);

  const runtimeProc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', 'server/index.ts'],
    {
      stdio: 'inherit',
      cwd: rootDir,
      shell: false,
      env: {
        ...process.env,
        PORT: port.toString()
      }
    }
  );

  runtimeProc.on('exit', code => {
    if (code !== null && code !== 0) {
      console.error(`Runtime exited with code ${code}`);
    }
    shutdown();
  });

  childProcesses.push(runtimeProc);
}

function attachShutdownHandlers() {
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal as NodeJS.Signals, () => {
      console.log(`\nReceived ${signal}, shutting down...`);
      shutdown();
    });
  });
}

function shutdown() {
  while (childProcesses.length > 0) {
    const proc = childProcesses.pop();
    if (proc && !proc.killed) {
      proc.kill();
    }
  }
  process.exit(0);
}

main().catch(error => {
  console.error('Failed to start runtime:', error);
  shutdown();
});
