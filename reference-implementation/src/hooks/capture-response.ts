#!/usr/bin/env node

/**
 * Hook: Stop
 * Extracts important facts/decisions from Claude's response using Haiku.
 * Deduplicates via recall before storing.
 *
 * Triggered after each Claude response.
 */

import { MemoryManager } from '../memory-manager.js';
import { execSync } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const LOG_PATH = join(homedir(), '.claude', 'cmem', 'hooks.log');
const MIN_RESPONSE_LENGTH = 300; // Lower threshold for more capture
const SIMILARITY_THRESHOLD = 0.85; // For deduplication

let currentProject: string = 'unknown';
let currentCwd: string = process.cwd();

function log(message: string, showIndicator: boolean = false) {
  const timestamp = new Date().toISOString();
  const projectTag = currentProject !== 'unknown' ? currentProject : basename(currentCwd);
  const logLine = `[${timestamp}] [capture-response] [${projectTag}] ${message}\n`;

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

interface StopHookInput {
  session_id?: string;
  cwd?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
}

interface ExtractedItem {
  type: 'decision' | 'fact' | 'preference';
  content: string;
  importance: number;
}

async function extractWithHaiku(response: string): Promise<ExtractedItem[]> {
  const prompt = `Tu es un assistant de mémoire pour Claude Code. Extrais les éléments IMPORTANTS à retenir.

EXTRAIRE (importance 4-5):
- Décisions techniques: choix de lib, pattern, architecture
- Bugs découverts et fixes appliqués
- Configurations découvertes (API, limites, env)
- Préférences utilisateur explicites

EXTRAIRE (importance 3):
- Structure du code modifié
- Patterns récurrents observés
- Contexte métier important

NE PAS extraire:
- Code source brut
- Explications génériques
- Questions sans réponse
- Logs d'erreur verbeux

JSON UNIQUEMENT (pas de markdown):
{"items": [{"type": "decision|fact|preference", "content": "description CONCISE (<100 chars)", "importance": 1-5}]}

Si rien d'important: {"items": []}

Réponse à analyser:
${response.slice(0, 5000)}`;

  try {
    const result = execSync(
      `claude -p --model haiku "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 }
    );

    // Extract JSON from response (might have extra text)
    const jsonMatch = result.match(/\{[\s\S]*"items"[\s\S]*\}/);
    if (!jsonMatch) {
      log('No JSON found in Haiku response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.items || [];
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Haiku extraction failed: ${errMsg}`);
    return [];
  }
}

async function isDuplicate(manager: MemoryManager, content: string): Promise<boolean> {
  try {
    const results = await manager.recall(content, { limit: 3 });

    // Check if any result is very similar
    for (const r of results) {
      // Simple similarity: if distance is very low, it's likely a duplicate
      if (r.distance < 5) { // Very close match
        log(`Duplicate detected (distance: ${r.distance.toFixed(2)}): "${content.slice(0, 50)}..."`);
        return true;
      }

      // Also check content overlap
      const existingWords = new Set(r.memory.content.toLowerCase().split(/\s+/));
      const newWords = content.toLowerCase().split(/\s+/);
      const overlap = newWords.filter(w => existingWords.has(w)).length / newWords.length;

      if (overlap > SIMILARITY_THRESHOLD) {
        log(`Duplicate by content overlap (${(overlap * 100).toFixed(0)}%): "${content.slice(0, 50)}..."`);
        return true;
      }
    }

    return false;
  } catch {
    return false; // If recall fails, assume not duplicate
  }
}

async function getLastResponse(transcriptPath?: string): Promise<string | null> {
  if (!transcriptPath) {
    log('No transcript_path provided');
    return null;
  }

  // Expand ~ to home directory
  const expandedPath = transcriptPath.replace(/^~/, homedir());

  if (!existsSync(expandedPath)) {
    log(`Transcript file not found: ${expandedPath}`);
    return null;
  }

  try {
    const transcript = readFileSync(expandedPath, 'utf-8');
    const lines = transcript.trim().split('\n');

    // Find the last assistant message
    // Support both old format (entry.role) and new format (entry.type + entry.message)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);

        // New format: {type: "assistant", message: {role: "assistant", content: [...]}}
        const isAssistant = entry.type === 'assistant' || entry.role === 'assistant';
        const content = entry.message?.content || entry.content;

        if (isAssistant && content) {
          // Content can be string or array of content blocks
          if (typeof content === 'string' && content.length > 0) {
            return content;
          } else if (Array.isArray(content)) {
            // Extract text from content blocks (skip tool_use, tool_result)
            const textContent = content
              .filter((block: { type: string }) => block.type === 'text')
              .map((block: { text: string }) => block.text)
              .join('\n');
            // Only return if we found actual text, otherwise keep searching
            if (textContent.length > 0) {
              return textContent;
            }
          }
          // Continue searching if no text content found
        }
      } catch {
        continue;
      }
    }
    log('No assistant message found in transcript');
  } catch (error) {
    log(`Failed to read transcript: ${error}`);
  }

  return null;
}

async function main() {
  // Read input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputStr = Buffer.concat(chunks).toString('utf-8').trim();

  if (!inputStr) {
    process.exit(0);
  }

  let input: StopHookInput;
  try {
    input = JSON.parse(inputStr);
    // Debug: log what we receive
    log(`Received input keys: ${Object.keys(input).join(', ')}`);
    if (input.transcript_path) {
      log(`transcript_path: ${input.transcript_path}`);
    }
  } catch {
    log('Invalid JSON input');
    process.exit(0);
  }

  currentCwd = input.cwd || process.cwd();

  const manager = new MemoryManager();
  currentProject = manager.detectProject(currentCwd) || 'global';

  // Check if Ollama is available
  const isReady = await manager.isReady();
  if (!isReady) {
    log('MLX server not available, skipping');
    process.exit(0);
  }

  // Get the last response from transcript
  const response = await getLastResponse(input.transcript_path);

  if (!response || response.length < MIN_RESPONSE_LENGTH) {
    log(`Response too short (${response?.length || 0} chars), skipping`);
    process.exit(0);
  }

  log(`Processing response (${response.length} chars)`);

  // Extract important items using Haiku
  const items = await extractWithHaiku(response);

  if (items.length === 0) {
    log('No important items extracted');
    process.exit(0);
  }

  log(`Extracted ${items.length} potential items`);

  // Store non-duplicate items
  let stored = 0;
  for (const item of items) {
    if (item.importance < 3) {
      log(`Skipping low importance item: "${item.content.slice(0, 40)}..."`);
      continue;
    }

    // Deduplicate
    const duplicate = await isDuplicate(manager, item.content);
    if (duplicate) {
      continue;
    }

    // Store
    try {
      await manager.remember({
        content: item.content,
        type: item.type,
        source: 'auto:response',
        importance: item.importance,
        confidence: 0.8,
        category: 'extracted'
      });
      stored++;
      log(`Stored: [${item.type}] "${item.content.slice(0, 50)}..."`, true);
    } catch (error) {
      log(`Failed to store: ${error}`);
    }
  }

  if (stored > 0) {
    log(`Captured ${stored} new memories from response`, true);
  }
}

main();
