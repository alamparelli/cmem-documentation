#!/usr/bin/env node

/**
 * Hook: PostToolUse (Bash with git commit)
 * Captures significant commits as memories.
 *
 * Usage: node capture-commit.js "<tool_input>"
 */

import { MemoryManager } from '../memory-manager.js';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'config.json');
const LOG_PATH = join(homedir(), '.claude', 'cmem', 'hooks.log');

// Global context for logging
let currentProject: string = 'unknown';
let currentCwd: string = process.cwd();

function log(message: string, showIndicator: boolean = false) {
  const timestamp = new Date().toISOString();
  const projectTag = currentProject !== 'unknown' ? currentProject : basename(currentCwd);
  const logLine = `[${timestamp}] [capture-commit] [${projectTag}] ${message}\n`;

  // Ensure directory exists
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Append to log file
  appendFileSync(LOG_PATH, logLine);

  // Visual indicator to stderr
  if (showIndicator) {
    console.error(`🧠 [${projectTag}] ${message}`);
  }
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

interface Config {
  capture: {
    autoCommit: boolean;
    commitPatterns: string[];
    minImportance: number;
  };
}

interface HookInput {
  tool_name: string;
  cwd?: string;
  tool_input: {
    command?: string;
    description?: string;
  };
  tool_response?: unknown;
}

async function main() {
  // Read input from stdin (JSON format per Claude Code hooks spec)
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputJson = Buffer.concat(chunks).toString('utf-8').trim();

  if (!inputJson) {
    process.exit(0);
  }

  let input: HookInput;
  try {
    input = JSON.parse(inputJson);
  } catch {
    log('Invalid JSON input');
    process.exit(0);
  }

  // Set context for logging
  currentCwd = input.cwd || process.cwd();
  const manager = new MemoryManager();
  currentProject = manager.detectProject(currentCwd) || 'unknown';

  const command = input.tool_input?.command || '';

  // Check if this is a git commit
  if (!command.includes('git commit')) {
    process.exit(0);
  }

  log(`Detected git commit`);

  try {
    // Load config
    const config: Config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

    if (!config.capture.autoCommit) {
      log('Auto-commit capture disabled in config');
      process.exit(0);
    }

    // Get the commit message from git
    const { execSync } = await import('child_process');
    const commitMsg = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim();

    // Check if commit matches significant patterns
    const patterns = config.capture.commitPatterns.map(p => new RegExp(p, 'i'));
    const isSignificant = patterns.some(p => p.test(commitMsg));

    if (!isSignificant) {
      log(`Commit not significant: "${commitMsg.slice(0, 50)}..."`);
      process.exit(0);
    }

    // Get brief diff stats
    let diffSummary = '';
    try {
      diffSummary = execSync('git diff HEAD~1 --stat | tail -1', { encoding: 'utf-8' }).trim();
    } catch {
      // Ignore if can't get diff
    }

    // Check if Ollama is available
    const isReady = await manager.isReady();
    if (!isReady) {
      log('MLX server not available, skipping capture');
      process.exit(0);
    }

    // Determine type from commit prefix
    let type: 'decision' | 'fact' = 'decision';
    if (commitMsg.startsWith('fix')) {
      type = 'fact'; // Bug fixes are facts about what was broken
    }

    // Store the memory
    const content = diffSummary
      ? `${commitMsg}\n\nChanges: ${diffSummary}`
      : commitMsg;

    await manager.remember({
      content,
      type,
      source: 'auto:commit',
      importance: config.capture.minImportance,
      confidence: 0.9,
      category: 'commit'
    });

    log(`Captured commit as ${type}: "${commitMsg.slice(0, 40)}..."`, true);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Error: ${errMsg}`);
    process.exit(0);
  }
}

main();
