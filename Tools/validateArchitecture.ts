/**
 * Validate architectural principles are followed
 * Run with: tsx Tools/validateArchitecture.ts
 *
 * Checks for violations of architectural decisions beyond just config
 */

import fs from 'fs';
import path from 'path';

interface ValidationIssue {
  file: string;
  line?: number;
  issue: string;
  severity: 'error' | 'warning';
  adr?: string;  // Reference to Architectural Decision Record
}

const issues: ValidationIssue[] = [];
const rootDir = path.resolve(__dirname, '..');

// Patterns that violate architectural principles
const antiPatterns = [
  {
    pattern: /setInterval\s*\(/g,
    message: 'Using setInterval for cognitive processing violates breath synchronization (ADR-002)',
    severity: 'error' as const,
    adr: 'ADR-002',
    allowedFiles: ['breathLoop.ts']  // breathLoop can use setInterval
  },
  {
    pattern: /auto[\s-]?reply/gi,
    message: 'Auto-reply logic violates volitional speech principle (ADR-001)',
    severity: 'error' as const,
    adr: 'ADR-001'
  },
  {
    pattern: /console\.log\s*\(\s*['\"]scroll/gi,
    message: 'Treating scrolls as console.log() violates sacred memory principle (ADR-004)',
    severity: 'warning' as const,
    adr: 'ADR-004'
  },
  {
    pattern: /skip.*guardian|bypass.*guardian/gi,
    message: 'Bypassing guardian filter violates safety principle (ADR-005)',
    severity: 'error' as const,
    adr: 'ADR-005'
  },
  {
    pattern: /force.*response|must.*respond/gi,
    message: 'Forcing responses violates volitional speech (ADR-001)',
    severity: 'warning' as const,
    adr: 'ADR-001'
  }
];

// Files that must exist and what they should contain
const requiredIntegrations = [
  {
    file: 'server/index.ts',
    mustContain: 'voiceIntent',
    reason: 'All speech must route through voiceIntent (ADR-001)'
  },
  {
    file: 'server/index.ts',
    mustContain: 'guardianFilter',
    reason: 'All input must pass through guardian filter (ADR-005)'
  }
];

function scanFile(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(rootDir, filePath);

  // Check anti-patterns
  for (const antiPattern of antiPatterns) {
    // Skip if this file is allowed for this pattern
    if (antiPattern.allowedFiles && antiPattern.allowedFiles.some(allowed => relativePath.includes(allowed))) {
      continue;
    }

    let match;
    while ((match = antiPattern.pattern.exec(content)) !== null) {
      // Find line number
      const lineNumber = content.substring(0, match.index).split('\n').length;

      issues.push({
        file: relativePath,
        line: lineNumber,
        issue: antiPattern.message,
        severity: antiPattern.severity,
        adr: antiPattern.adr
      });
    }

    // Reset regex lastIndex for next file
    antiPattern.pattern.lastIndex = 0;
  }
}

function scanDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip node_modules and dist
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }

    if (entry.isDirectory()) {
      scanDirectory(fullPath);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
      scanFile(fullPath);
    }
  }
}

function validateRequiredIntegrations(): void {
  for (const required of requiredIntegrations) {
    const filePath = path.join(rootDir, required.file);

    if (!fs.existsSync(filePath)) {
      issues.push({
        file: required.file,
        issue: `Required file missing: ${required.reason}`,
        severity: 'error'
      });
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.includes(required.mustContain)) {
      issues.push({
        file: required.file,
        issue: `Missing required integration '${required.mustContain}': ${required.reason}`,
        severity: 'error'
      });
    }
  }
}

function main(): void {
  console.log('🔍 Validating architectural principles...\n');

  // Scan source directories
  const scanDirs = ['src', 'server', 'runtime', 'Tools'];
  for (const dir of scanDirs) {
    const fullPath = path.join(rootDir, dir);
    if (fs.existsSync(fullPath)) {
      scanDirectory(fullPath);
    }
  }

  // Check required integrations
  validateRequiredIntegrations();

  // Report issues
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.error('❌ ARCHITECTURAL VIOLATIONS (Errors):\n');
    for (const error of errors) {
      console.error(`   ${error.file}${error.line ? `:${error.line}` : ''}`);
      console.error(`      ${error.issue}`);
      if (error.adr) {
        console.error(`      See ARCHITECTURAL_DECISIONS.md § ${error.adr}`);
      }
      console.error('');
    }
  }

  if (warnings.length > 0) {
    console.warn('⚠️  Architectural Warnings:\n');
    for (const warning of warnings) {
      console.warn(`   ${warning.file}${warning.line ? `:${warning.line}` : ''}`);
      console.warn(`      ${warning.issue}`);
      if (warning.adr) {
        console.warn(`      See ARCHITECTURAL_DECISIONS.md § ${warning.adr}`);
      }
      console.warn('');
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ No architectural violations detected!\n');
  } else {
    console.log(`\n📊 Summary: ${errors.length} errors, ${warnings.length} warnings\n`);

    if (errors.length > 0) {
      console.log('Review ARCHITECTURAL_DECISIONS.md for context on these principles.\n');
    }
  }

  // Exit with error code if there are errors
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
