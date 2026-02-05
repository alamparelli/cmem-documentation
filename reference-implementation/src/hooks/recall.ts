#!/usr/bin/env node

/**
 * Hook: UserPromptSubmit (Enhanced v4 - Intent-Aware)
 *
 * 1. INTENT ANALYSIS: Uses Haiku to understand query intent
 * 2. RECALL: Injects relevant memories with explicit/implicit handling
 * 3. IMPLICIT STORE: Detects "remember this", "je préfère", etc.
 * 4. FILTERING: Removes malformed memories (JSON artifacts, etc.)
 *
 * New in v4:
 * - Haiku-based intent detection for explicit recall requests
 * - Better query reformulation for semantic search
 * - Filtering of corrupted/malformed memories
 *
 * Usage: node recall.js [JSON input from stdin]
 * Output: <memory-context>...</memory-context> to stdout
 */

import { MemoryManager } from '../memory-manager.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { MemoryType } from '../types.js';

/**
 * Query intent analysis result from Haiku
 */
interface QueryIntent {
  isExplicitRecall: boolean;  // User explicitly asking for stored memories
  subjects: string[];          // Key subjects extracted (max 3)
  reformulatedQuery: string;   // Optimized query for semantic search
}

const LOG_PATH = join(homedir(), '.claude', 'cmem', 'hooks.log');

// DEBUG: Log immediately on script start
function earlyLog(message: string) {
  const timestamp = new Date().toISOString();
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(LOG_PATH, `[${timestamp}] [recall] [STARTUP] ${message}\n`);
}
earlyLog('Hook script started');

// Patterns for implicit memory detection (multilingual)
const IMPLICIT_STORE_PATTERNS = {
  preference: [
    /(?:je préfère|i prefer|j'aime mieux|always use|toujours utiliser|never use|jamais utiliser)\s+(.{10,200})/i,
    /(?:my preference is|ma préférence est)\s+(.{10,200})/i,
    /(?:i always|je fais toujours|i never|je ne fais jamais)\s+(.{10,200})/i,
  ],
  fact: [
    /(?:souviens-toi que|remember that|note that|note bien que|rappelle-toi que)\s+(.{10,300})/i,
    /(?:pour info|fyi|for your information|à noter)\s*[,:]\s*(.{10,300})/i,
    /(?:important|crucial|critical)\s*[,:]\s*(.{10,300})/i,
  ],
  decision: [
    /(?:on a décidé|we decided|j'ai choisi|i chose|let's go with|on part sur)\s+(.{10,200})/i,
    /(?:the decision is|la décision est)\s+(.{10,200})/i,
  ],
};

let currentProject: string = 'unknown';
let currentCwd: string = process.cwd();

function log(message: string, showIndicator: boolean = false) {
  const timestamp = new Date().toISOString();
  const projectTag = currentProject !== 'unknown' ? currentProject : basename(currentCwd);
  const logLine = `[${timestamp}] [recall] [${projectTag}] ${message}\n`;

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

interface HookInput {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  hook_event_name?: string;
  transcript_path?: string;
}

/**
 * Detect implicit memory requests in the prompt
 */
function detectImplicitStore(prompt: string): { type: MemoryType; content: string } | null {
  for (const [type, patterns] of Object.entries(IMPLICIT_STORE_PATTERNS)) {
    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        return {
          type: type as MemoryType,
          content: match[1].trim()
        };
      }
    }
  }
  return null;
}

/**
 * Analyze query intent using Haiku to determine:
 * - Is this an explicit recall request?
 * - What are the key subjects?
 * - How to reformulate for better recall?
 */
async function analyzeQueryIntent(prompt: string): Promise<QueryIntent> {
  const defaultIntent: QueryIntent = {
    isExplicitRecall: false,
    subjects: [],
    reformulatedQuery: prompt
  };

  // Skip if called from within Haiku call (prevent recursion)
  if (process.env.CMEM_SKIP_INTENT === '1') {
    log('Skipping intent analysis (CMEM_SKIP_INTENT=1)');
    return defaultIntent;
  }

  // Skip very short prompts
  if (prompt.length < 10) {
    return defaultIntent;
  }

  // Escape prompt for shell
  const escapedPrompt = prompt
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .slice(0, 400);

  const systemPrompt = `Tu analyses des demandes utilisateur pour un système de mémoire.
Retourne UNIQUEMENT du JSON valide, sans explication:
{"isExplicitRecall": true/false, "subjects": ["sujet1"], "reformulatedQuery": "query"}

isExplicitRecall=true si l'utilisateur demande EXPLICITEMENT:
- des infos/mémoires stockées ("info sur X", "qu'est-ce qu'on a sur X")
- de rappeler quelque chose ("rappelle-moi", "recall", "montre les mémoires")
- des décisions passées ("qu'est-ce qu'on a décidé")

subjects: 1-3 mots-clés techniques principaux (noms de projet, concepts, technologies)
reformulatedQuery: version enrichie pour recherche sémantique (ajoute synonymes, contexte)

Demande: ${escapedPrompt}`;

  try {
    // Use full path to claude CLI and increase timeout
    // Set CMEM_SKIP_INTENT=1 to prevent recursive hook calls
    const claudePath = join(homedir(), '.local', 'bin', 'claude');
    const result = execSync(
      `${claudePath} -p --model haiku "${systemPrompt.replace(/"/g, '\\"')}"`,
      {
        encoding: 'utf-8',
        timeout: 10000,  // 10s timeout for Haiku
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:${join(homedir(), '.local', 'bin')}`,
          CMEM_SKIP_INTENT: '1'  // Prevent recursive intent analysis
        }
      }
    );

    // Extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*?"isExplicitRecall"[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isExplicitRecall: Boolean(parsed.isExplicitRecall),
        subjects: Array.isArray(parsed.subjects) ? parsed.subjects.slice(0, 3) : [],
        reformulatedQuery: typeof parsed.reformulatedQuery === 'string'
          ? parsed.reformulatedQuery.slice(0, 500)
          : prompt
      };
    }
  } catch (error) {
    // Haiku timeout or error - fallback silently
    log(`Intent analysis fallback: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  return defaultIntent;
}

/**
 * Get recent context from transcript to enrich the query
 */
function getRecentContext(transcriptPath?: string): string {
  if (!transcriptPath) return '';

  const expandedPath = transcriptPath.replace(/^~/, homedir());
  if (!existsSync(expandedPath)) return '';

  try {
    const transcript = readFileSync(expandedPath, 'utf-8');
    const lines = transcript.trim().split('\n');

    // Get last 3 exchanges (user + assistant)
    const recentMessages: string[] = [];
    let count = 0;
    const maxMessages = 6; // 3 exchanges

    for (let i = lines.length - 1; i >= 0 && count < maxMessages; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        // Support both old format (entry.role) and new format (entry.type + entry.message)
        const hasRole = entry.role || entry.type;
        const rawContent = entry.message?.content || entry.content;

        if (hasRole && rawContent) {
          const content = typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent.filter((b: {type: string}) => b.type === 'text').map((b: {text: string}) => b.text).join('\n')
              : JSON.stringify(rawContent);

          // Extract key phrases only (first 200 chars)
          recentMessages.unshift(content.slice(0, 200));
          count++;
        }
      } catch {
        continue;
      }
    }

    if (recentMessages.length > 0) {
      return recentMessages.join(' ').slice(0, 500);
    }
  } catch {
    // Ignore errors
  }

  return '';
}

/**
 * Detect task type from prompt for better recall filtering
 */
function detectTaskType(prompt: string): string {
  const promptLower = prompt.toLowerCase();

  if (/\b(bug|fix|error|issue|crash|fail|broken)\b/.test(promptLower)) {
    return 'debugging';
  }
  if (/\b(implement|create|add|build|develop|feature)\b/.test(promptLower)) {
    return 'feature';
  }
  if (/\b(refactor|clean|optimize|improve|reorganize)\b/.test(promptLower)) {
    return 'refactoring';
  }
  if (/\b(test|spec|coverage|unit|integration)\b/.test(promptLower)) {
    return 'testing';
  }
  if (/\b(deploy|release|publish|ship)\b/.test(promptLower)) {
    return 'deployment';
  }
  if (/\b(explain|how|what|why|understand)\b/.test(promptLower)) {
    return 'understanding';
  }

  return 'general';
}

/**
 * Build enriched query for better semantic search
 */
function buildEnrichedQuery(prompt: string, context: string, taskType: string): string {
  // Base query is the prompt
  let query = prompt;

  // Add context keywords if available
  if (context) {
    // Extract potential keywords from context
    const contextKeywords = context
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 10)
      .join(' ');

    if (contextKeywords) {
      query = `${prompt} ${contextKeywords}`;
    }
  }

  // Keep query reasonable size
  return query.slice(0, 500);
}

async function main() {
  earlyLog('main() started');

  // Read JSON input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  earlyLog('stdin read complete');

  const inputStr = Buffer.concat(chunks).toString('utf-8').trim();
  earlyLog(`inputStr length: ${inputStr.length}, content: ${inputStr.slice(0, 200)}`);

  if (!inputStr) {
    earlyLog('Empty input, exiting');
    process.exit(0);
  }

  let query: string;
  let transcriptPath: string | undefined;

  try {
    const input: HookInput = JSON.parse(inputStr);
    earlyLog(`Parsed JSON keys: ${Object.keys(input).join(', ')}`);
    query = input.prompt || '';
    currentCwd = input.cwd || process.cwd();
    transcriptPath = input.transcript_path;
  } catch (e) {
    earlyLog(`JSON parse error: ${e}`);
    query = inputStr;
  }

  earlyLog(`query: "${query.slice(0, 50)}"`);

  if (!query) {
    log('No query provided, skipping');
    process.exit(0);
  }

  const manager = new MemoryManager();
  currentProject = manager.detectProject(currentCwd) || 'global';

  // Check if MLX is available
  const isReady = await manager.isReady();
  if (!isReady) {
    log('MLX server not available, skipping');
    process.exit(0);
  }

  // ============================================
  // PART 1: IMPLICIT STORE DETECTION
  // ============================================
  const implicitMemory = detectImplicitStore(query);
  if (implicitMemory) {
    try {
      const ids = await manager.remember({
        content: implicitMemory.content,
        type: implicitMemory.type,
        source: 'auto:session',
        importance: 4, // User explicitly asked to remember
        confidence: 0.95,
        category: 'implicit'
      });
      log(`Implicit store: [${implicitMemory.type}] "${implicitMemory.content.slice(0, 50)}..."`, true);
    } catch (error) {
      log(`Implicit store failed: ${error}`);
    }
  }

  // ============================================
  // PART 2: INTENT-AWARE RECALL (cmem v4)
  // ============================================

  // Analyze query intent with Haiku
  const intent = await analyzeQueryIntent(query);
  log(`Intent: explicit=${intent.isExplicitRecall}, subjects=[${intent.subjects.join(',')}]`);

  // Get recent context for enrichment (fallback)
  const recentContext = getRecentContext(transcriptPath);

  // Detect task type (for logging)
  const taskType = detectTaskType(query);
  log(`Task type: ${taskType}`);

  // Build final query based on intent
  let finalQuery: string;
  let recallLimit: number;

  if (intent.isExplicitRecall && intent.subjects.length > 0) {
    // Explicit recall: prioritize subjects + reformulated query
    finalQuery = intent.subjects.join(' ') + ' ' + intent.reformulatedQuery;
    recallLimit = 10; // More results for explicit requests
    log(`Explicit recall for: ${intent.subjects.join(', ')}`);
  } else if (intent.reformulatedQuery && intent.reformulatedQuery !== query) {
    // Use Haiku's reformulated query
    finalQuery = intent.reformulatedQuery;
    recallLimit = 7;
    log(`Using reformulated query`);
  } else {
    // Fallback to enriched query
    finalQuery = buildEnrichedQuery(query, recentContext, taskType);
    recallLimit = 7;
  }

  log(`Searching: "${finalQuery.slice(0, 80)}..."`);

  try {
    const results = await manager.recall(finalQuery, { limit: recallLimit });

    // Filter out malformed memories (JSON artifacts, too short, etc.)
    const validResults = results.filter(r => {
      const content = r.memory.content;
      // Skip if starts with JSON-like pattern
      if (/^\s*\{/.test(content) || /^\s*\[/.test(content)) {
        return false;
      }
      // Skip if too short
      if (content.length < 20) {
        return false;
      }
      // Skip if looks like truncated response
      if (/^\{"items":\s*\[\]/.test(content)) {
        return false;
      }
      return true;
    });

    if (validResults.length === 0) {
      log('No valid memories found');
      process.exit(0);
    }

    log(`Found ${validResults.length} memories (filtered from ${results.length})`, true);

    // Format output for injection
    console.log('<memory-context>');
    console.log('Relevant memories from previous sessions:');

    for (const r of validResults) {
      const projectLabel = r.source ? `📁 ${r.source}` : '🌍 global';
      const typeLabel = r.memory.type.charAt(0).toUpperCase() + r.memory.type.slice(1);
      console.log(`- [${projectLabel}] (${typeLabel}) ${r.memory.content}`);

      if (r.memory.reasoning) {
        console.log(`  Reason: ${r.memory.reasoning}`);
      }
    }

    console.log('</memory-context>');

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Error: ${errMsg}`);
    process.exit(0);
  }
}

main();
