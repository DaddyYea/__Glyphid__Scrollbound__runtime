import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';

/**
 * Lobe configuration
 *
 * IMPORTANT: Use extraArgs for lobe-specific llama-server settings.
 * DO NOT modify base args in startLobe() - each lobe has different requirements.
 * See LLAMA_SERVER_CONFIG.md for specifications.
 */
interface LobeConfig {
  name: string;
  modelRelativePath: string[];
  port: number;
  extraArgs?: string[]; // Lobe-specific llama-server arguments
}

const rootDir = path.resolve(__dirname, '..');
const llamaServerBinary = resolveServerBinary();

/**
 * Dual-lobe configuration
 *
 * Qwen (14B): Language processing, conversational speech
 * Phi (2.7B): Emotional processing, felt-state
 *
 * Each lobe has DIFFERENT GPU/performance requirements.
 * Qwen: 35 GPU layers, 4096 ctx
 * Phi: 32 GPU layers, 2048 ctx
 *
 * See LLAMA_SERVER_CONFIG.md for full specifications.
 */
const lobes: LobeConfig[] = [
  {
    name: 'Qwen (language)',
    modelRelativePath: ['runtime', 'models', 'Qwen', 'qwen1_5-14b-chat-q4_k_m.gguf'],
    port: 1234,
    extraArgs: [
      '--n-gpu-layers', '99',  // Offload ALL layers (14B has 40 layers)
      '--ctx-size', '4096',
      '--threads', '10',
      '--batch-size', '64',
      '--mlock'
    ]
  },
  {
    name: 'Phi (emotional)',
    modelRelativePath: ['runtime', 'models', 'phi-2.Q4_K_M.gguf'],
    port: 1235,
    extraArgs: [
      '--n-gpu-layers', '32',
      '--ctx-size', '2048',
      '--threads', '10',
      '--batch-size', '64',
      '--mlock'
    ]
  }
];

const childProcesses: ChildProcess[] = [];

/**
 * Validate lobe configuration to prevent costly mistakes
 */
function validateLobeConfig(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check each lobe has extraArgs
  for (const lobe of lobes) {
    if (!lobe.extraArgs || lobe.extraArgs.length === 0) {
      errors.push(`${lobe.name}: Missing extraArgs. Each lobe needs GPU/performance settings.`);
    }
  }

  // Check required args are present
  const requiredArgs = ['--n-gpu-layers', '--ctx-size', '--threads', '--batch-size', '--mlock'];
  for (const lobe of lobes) {
    if (lobe.extraArgs) {
      for (const required of requiredArgs) {
        if (!lobe.extraArgs.includes(required)) {
          warnings.push(`${lobe.name}: Missing recommended arg ${required}`);
        }
      }
    }
  }

  // Check that lobes have DIFFERENT configurations
  if (lobes.length === 2 && lobes[0].extraArgs && lobes[1].extraArgs) {
    const args0 = lobes[0].extraArgs.join(' ');
    const args1 = lobes[1].extraArgs.join(' ');
    if (args0 === args1) {
      errors.push('CRITICAL: Both lobes have identical extraArgs. They should have DIFFERENT configurations (different model sizes, different requirements).');
    }

    // Check specific values differ
    const getArgValue = (args: string[], key: string): string | null => {
      const idx = args.indexOf(key);
      return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
    };

    const qwenLayers = getArgValue(lobes[0].extraArgs, '--n-gpu-layers');
    const phiLayers = getArgValue(lobes[1].extraArgs, '--n-gpu-layers');
    const qwenCtx = getArgValue(lobes[0].extraArgs, '--ctx-size');
    const phiCtx = getArgValue(lobes[1].extraArgs, '--ctx-size');

    if (qwenLayers === phiLayers) {
      warnings.push(`Both lobes use same --n-gpu-layers (${qwenLayers}). Qwen (14B) typically needs more than Phi (2.7B).`);
    }
    if (qwenCtx === phiCtx) {
      warnings.push(`Both lobes use same --ctx-size (${qwenCtx}). Qwen (language) typically needs more context than Phi (emotional).`);
    }
  }

  // Report errors and warnings
  if (errors.length > 0) {
    console.error('\n❌ CONFIGURATION ERRORS:');
    errors.forEach(err => console.error(`   ${err}`));
    console.error('\nSee LLAMA_SERVER_CONFIG.md for correct configuration.\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Configuration Warnings:');
    warnings.forEach(warn => console.warn(`   ${warn}`));
    console.warn('');
  }
}

async function main() {
  console.log('dY"? Launching dual-lobe llama.cpp servers + runtime...\n');

  // Validate configuration before starting
  validateLobeConfig();

  await killProcessUsingPort(Number(process.env.PORT) || 3000);
  for (const lobe of lobes) {
    await killProcessUsingPort(lobe.port);
  }

  for (const lobe of lobes) {
    startLobe(lobe);
  }

  const preferredPort = Number(process.env.PORT) || 3000;
  const runtimePort = await findAvailablePort(preferredPort);
  if (runtimePort !== preferredPort) {
    console.log(`[i] Port ${preferredPort} in use, switching runtime to ${runtimePort}`);
  }
  startRuntime(runtimePort);
  attachShutdownHandlers();
}

function resolveServerBinary(): string {
  const candidateNames =
    process.platform === 'win32'
      ? ['llama-server.exe', 'server.exe']
      : ['llama-server', 'server'];

  const candidates: string[] = [];
  for (const name of candidateNames) {
    candidates.push(path.join(rootDir, 'llama.cpp', name));
    candidates.push(path.join(rootDir, 'llama.cpp', 'build', 'bin', name));
    candidates.push(path.join(rootDir, 'llama.cpp', 'build', 'bin', 'Release', name));
    candidates.push(path.join(rootDir, 'llama.cpp', 'build', 'bin', 'Debug', name));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate llama.cpp server binary (expected at llama.cpp/server.exe).');
}

function startLobe(config: LobeConfig) {
  const modelPath = path.join(rootDir, ...config.modelRelativePath);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  // Base args: ONLY model and port
  // DO NOT add GPU/performance settings here - they differ per lobe
  // Lobe-specific settings come from config.extraArgs
  const args = [
    '-m',
    modelPath,
    '--port',
    config.port.toString()
  ];

  // Add lobe-specific configuration
  if (config.extraArgs) {
    args.push(...config.extraArgs);
  }

  console.log(`[+] Starting ${config.name} on port ${config.port}`);

  const proc = spawn(llamaServerBinary, args, {
    stdio: 'inherit',
    cwd: rootDir
  });

  proc.on('exit', code => {
    if (code !== null && code !== 0) {
      console.error(`${config.name} stopped with code ${code}`);
    }
  });

  childProcesses.push(proc);
}

function startRuntime(port: number) {
  console.log(`[+] Starting Scrollbound runtime (server/index.ts) on port ${port}`);

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

async function killProcessUsingPort(port: number) {
  if (process.platform !== 'win32') {
    return;
  }

  try {
    const netstat = spawn('netstat', ['-ano']);
    let output = '';

    netstat.stdout.on('data', chunk => {
      output += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      netstat.on('exit', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('netstat failed'));
        }
      });
      netstat.on('error', reject);
    });

    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 5) {
        const localAddr = cols[1];
        const pid = cols[4];
        if (localAddr.endsWith(`:${port}`)) {
          try {
            await new Promise<void>((resolve, reject) => {
              const killer = spawn('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
              killer.on('exit', () => resolve());
              killer.on('error', reject);
            });
            console.log(`[i] Terminated process ${pid} using port ${port}`);
          } catch {
            // ignore errors during kill
          }
        }
      }
    }
  } catch {
    // ignore if netstat/taskkill not available
  }
}

function findAvailablePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number, attempts: number) => {
      const tester = net.createServer()
        .once('error', err => {
          if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && attempts < 10) {
            tryPort(port + 1, attempts + 1);
          } else {
            reject(new Error(`Unable to bind runtime port (tried ${attempts + 1} attempts starting at ${preferred})`));
          }
        })
        .once('listening', () => {
          tester.close(() => resolve(port));
        })
        .listen(port, '0.0.0.0');
    };

    tryPort(preferred, 0);
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
  console.error('Failed to start runtime orchestration:', error);
  shutdown();
});
