#!/usr/bin/env node

/**
 * Hook: PreCompact
 * CRITICAL: Extracts and saves important context BEFORE it's compacted/lost.
 * Uses Haiku for intelligent extraction with deduplication.
 *
 * This is the last chance to capture session knowledge before context window shrinks.
 */

import { MemoryManager } from '../memory-manager.js';
import { execSync } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const LOG_PATH = join(homedir(), '.claude', 'cmem', 'hooks.log');
const MIN_CONTEXT_LENGTH = 2000;

let currentProject: string = 'unknown';
let currentCwd: string = process.cwd();

function log(message: string, showIndicator: boolean = false) {
  const timestamp = new Date().toISOString();
  const projectTag = currentProject !== 'unknown' ? currentProject : basename(currentCwd);
  const logLine = `[${timestamp}] [pre-compact] [${projectTag}] ${message}\n`;

  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  appendFileSync(LOG_PATH, logLine);

  if (showIndicator) {
    console.error(`🧠 [${projectTag}] ${message}`);
  }
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

interface PreCompactInput {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  summary?: string; // Some hooks provide a summary
}

interface ExtractedMemory {
  type: 'decision' | 'fact' | 'preference' | 'pattern';
  content: string;
  importance: number;
  category?: string;
}

async function extractWithHaiku(context: string): Promise<ExtractedMemory[]> {
  const prompt = `Cette session Claude va être compactée. Tu dois extraire TOUTES les informations importantes pour les sessions futures.

EXTRAIRE OBLIGATOIREMENT:
1. Décisions architecturales (choix techniques, patterns adoptés, raisons)
2. Bugs découverts et leurs fixes
3. Structure/patterns du codebase
4. Préférences utilisateur (style, conventions, outils préférés)
5. Contexte métier important
6. Configurations découvertes (API limits, env vars, etc.)

NE PAS EXTRAIRE:
- Code source brut
- Explications générales
- Questions sans réponse

IMPORTANT: Sois exhaustif, cette info sera PERDUE après compaction.

Réponds UNIQUEMENT en JSON valide:
{"memories": [{"type": "decision|fact|preference|pattern", "content": "description concise", "importance": 1-5, "category": "optionnel"}]}

Contexte de session:
${context.slice(0, 8000)}`;

  try {
    const result = execSync(
      `claude -p --model haiku "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 }
    );

    const jsonMatch = result.match(/\{[\s\S]*"memories"[\s\S]*\}/);
    if (!jsonMatch) {
      log('No JSON found in Haiku response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.memories || [];
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Haiku extraction failed: ${errMsg}`);
    return [];
  }
}

async function isDuplicate(manager: MemoryManager, content: string): Promise<boolean> {
  try {
    const results = await manager.recall(content, { limit: 3 });

    for (const r of results) {
      if (r.distance < 5) {
        return true;
      }

      const existingWords = new Set(r.memory.content.toLowerCase().split(/\s+/));
      const newWords = content.toLowerCase().split(/\s+/);
      const overlap = newWords.filter(w => existingWords.has(w)).length / newWords.length;

      if (overlap > 0.8) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

async function getSessionContext(input: PreCompactInput): Promise<string | null> {
  // Try multiple sources for context

  // 1. Check if summary is provided directly
  if (input.summary && input.summary.length > MIN_CONTEXT_LENGTH) {
    return input.summary;
  }

  // 2. Try transcript file
  const transcriptPath = input.transcript_path;
  if (transcriptPath) {
    const expandedPath = transcriptPath.replace(/^~/, homedir());
    if (!existsSync(expandedPath)) {
      return null;
    }
    try {
      const transcript = readFileSync(expandedPath, 'utf-8');
      const lines = transcript.trim().split('\n');

      // Build context from recent messages
      const messages: string[] = [];
      let charCount = 0;
      const maxChars = 10000;

      for (let i = lines.length - 1; i >= 0 && charCount < maxChars; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          // Support both old format (entry.role) and new format (entry.type + entry.message)
          const role = entry.type || entry.role || 'unknown';
          const rawContent = entry.message?.content || entry.content;
          const content = typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent.filter((b: {type: string}) => b.type === 'text').map((b: {text: string}) => b.text).join('\n')
              : JSON.stringify(rawContent);

          if (content) {
            messages.unshift(`[${role}]: ${content.slice(0, 2000)}`);
            charCount += content.length;
          }
        } catch {
          continue;
        }
      }

      if (messages.length > 0) {
        return messages.join('\n\n');
      }
    } catch (error) {
      log(`Failed to read transcript: ${error}`);
    }
  }

  // 3. Check stdin for context (some hooks pass it directly)
  return null;
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputStr = Buffer.concat(chunks).toString('utf-8').trim();

  if (!inputStr) {
    log('No input received');
    process.exit(0);
  }

  let input: PreCompactInput;
  try {
    input = JSON.parse(inputStr);
  } catch {
    log('Invalid JSON input');
    process.exit(0);
  }

  currentCwd = input.cwd || process.cwd();

  const manager = new MemoryManager();
  currentProject = manager.detectProject(currentCwd) || 'global';

  log('PreCompact triggered - extracting session knowledge');

  const isReady = await manager.isReady();
  if (!isReady) {
    log('MLX server not available, skipping');
    process.exit(0);
  }

  const context = await getSessionContext(input);

  if (!context || context.length < MIN_CONTEXT_LENGTH) {
    log(`Context too short (${context?.length || 0} chars), skipping`);
    process.exit(0);
  }

  log(`Extracting from ${context.length} chars of context`);

  // Extract with Haiku
  const memories = await extractWithHaiku(context);

  if (memories.length === 0) {
    log('No memories extracted');
    process.exit(0);
  }

  log(`Extracted ${memories.length} potential memories`);

  // Store non-duplicates
  let stored = 0;
  let skippedLowImportance = 0;
  let skippedDuplicate = 0;

  for (const memory of memories) {
    // Lower threshold for PreCompact since this is last chance
    if (memory.importance < 2) {
      skippedLowImportance++;
      continue;
    }

    const duplicate = await isDuplicate(manager, memory.content);
    if (duplicate) {
      skippedDuplicate++;
      continue;
    }

    try {
      await manager.remember({
        content: memory.content,
        type: memory.type,
        source: 'auto:precompact',
        importance: memory.importance,
        confidence: 0.85,
        category: memory.category || 'session'
      });
      stored++;
    } catch (error) {
      log(`Failed to store: ${error}`);
    }
  }

  log(`PreCompact complete: stored=${stored}, skipLow=${skippedLowImportance}, skipDupe=${skippedDuplicate}`, true);
}

main();
