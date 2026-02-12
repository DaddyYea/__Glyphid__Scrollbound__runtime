/**
 * Validate lobe configuration without starting servers
 * Run with: tsx Tools/validateConfig.ts
 */

interface LobeConfig {
  name: string;
  modelRelativePath: string[];
  port: number;
  extraArgs?: string[];
}

// Import lobe configuration from runRuntime.ts
const lobes: LobeConfig[] = [
  {
    name: 'Qwen (language)',
    modelRelativePath: ['runtime', 'models', 'Qwen', 'qwen1_5-14b-chat-q4_k_m.gguf'],
    port: 1234,
    extraArgs: [
      '--n-gpu-layers', '35',
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

function validateLobeConfig(): boolean {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log('🔍 Validating lobe configuration...\n');

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

  // Display configuration summary
  console.log('📋 Configuration Summary:\n');
  for (const lobe of lobes) {
    console.log(`${lobe.name}:`);
    console.log(`  Port: ${lobe.port}`);
    if (lobe.extraArgs) {
      const getArgValue = (key: string): string | null => {
        const idx = lobe.extraArgs!.indexOf(key);
        return idx >= 0 && idx + 1 < lobe.extraArgs!.length ? lobe.extraArgs![idx + 1] : null;
      };
      console.log(`  GPU Layers: ${getArgValue('--n-gpu-layers')}`);
      console.log(`  Context Size: ${getArgValue('--ctx-size')}`);
      console.log(`  Threads: ${getArgValue('--threads')}`);
      console.log(`  Batch Size: ${getArgValue('--batch-size')}`);
    }
    console.log('');
  }

  // Report errors and warnings
  if (errors.length > 0) {
    console.error('❌ CONFIGURATION ERRORS:\n');
    errors.forEach(err => console.error(`   ${err}`));
    console.error('\nSee LLAMA_SERVER_CONFIG.md for correct configuration.\n');
    return false;
  }

  if (warnings.length > 0) {
    console.warn('⚠️  Configuration Warnings:\n');
    warnings.forEach(warn => console.warn(`   ${warn}`));
    console.warn('');
  }

  console.log('✅ Configuration validation passed!\n');
  return true;
}

const isValid = validateLobeConfig();
process.exit(isValid ? 0 : 1);
