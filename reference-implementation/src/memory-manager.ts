import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  Memory,
  MemoryInput,
  RecallResult,
  RecallOptions,
  Config,
  MemoryType
} from './types.js';
import { MLXEmbedder, Embedder } from './mlx-embedder.js';
import { SmartChunker } from './chunker.js';
import { ProjectRegistryManager } from './project-registry.js';

const MEMORY_PATH = join(homedir(), '.claude', 'cmem');
const CONFIG_PATH = join(MEMORY_PATH, 'config.json');
const UNIFIED_DB_PATH = join(MEMORY_PATH, 'memories.db');

export class MemoryManager {
  private config: Config;
  private embedder: Embedder;
  private chunker: SmartChunker;
  private projectRegistry: ProjectRegistryManager;
  private sensitivePatterns: RegExp[];
  private dbInstance: Database.Database | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.embedder = new MLXEmbedder({
      baseUrl: this.config.embedding.baseUrl,
      dimensions: this.config.embedding.dimensions
    });
    this.chunker = new SmartChunker(this.config.chunking);
    this.projectRegistry = new ProjectRegistryManager();
    this.sensitivePatterns = this.config.sensitive.patterns.map(p => new RegExp(p, 'gi'));
  }

  private loadConfig(): Config {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
    throw new Error(`Config not found at ${CONFIG_PATH}`);
  }

  /**
   * Get the unified database instance.
   * cmem v3: Single DB with project column instead of separate DBs.
   */
  private getDb(): Database.Database {
    const db = new Database(UNIFIED_DB_PATH);
    sqliteVec.load(db);
    this.initSchema(db);
    return db;
  }

  private initSchema(db: Database.Database): void {
    const dim = this.config.embedding.dimensions;

    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        project TEXT,
        category TEXT,
        reasoning TEXT,
        source TEXT NOT NULL,
        importance INTEGER DEFAULT 3,
        confidence REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (unixepoch()),
        last_accessed INTEGER,
        access_count INTEGER DEFAULT 0,
        expires_at INTEGER,
        supersedes INTEGER,
        is_obsolete INTEGER DEFAULT 0,
        tags TEXT DEFAULT '[]'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        embedding float[${dim}]
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_obsolete ON memories(is_obsolete);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    `);
  }

  detectProject(cwd?: string): string | null {
    return this.projectRegistry.detectProject(cwd);
  }

  private containsSensitiveData(content: string): boolean {
    return this.sensitivePatterns.some(pattern => pattern.test(content));
  }

  private sanitizeContent(content: string): string {
    let sanitized = content;
    for (const pattern of this.sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }

  /**
   * Find a near-duplicate memory by embedding similarity.
   * Returns the existing memory ID if found, null otherwise.
   */
  private async findNearDuplicate(
    content: string,
    embedding: number[],
    db: Database.Database
  ): Promise<{ id: number; content: string; importance: number } | null> {
    if (!this.config.dedup.enabled) return null;

    const threshold = this.config.dedup.similarityThreshold;

    const row = db.prepare(`
      SELECT v.rowid as id, v.distance, m.content, m.importance
      FROM vec_memories v
      JOIN memories m ON v.rowid = m.id
      WHERE v.embedding MATCH ?
        AND k = 1
        AND m.is_obsolete = 0
    `).get(JSON.stringify(embedding)) as { id: number; distance: number; content: string; importance: number } | undefined;

    if (row && row.distance < threshold) {
      return { id: row.id, content: row.content, importance: row.importance };
    }
    return null;
  }

  async remember(input: MemoryInput): Promise<number[]> {
    // Check for sensitive data
    if (this.containsSensitiveData(input.content)) {
      console.warn('Warning: Sensitive data detected and redacted');
      input.content = this.sanitizeContent(input.content);
    }

    // Determine project (NULL for global/preference types)
    const project = input.project ?? this.detectProject();
    const isGlobal = input.type === 'preference' || !project;
    const projectValue = isGlobal ? null : project;

    const db = this.getDb();

    // Chunk if needed
    const chunks = this.chunker.chunk(input.content);
    const memoryIds: number[] = [];

    try {
      for (const chunk of chunks) {
        const embedding = await this.embedder.embed(chunk.content);

        // Dedup check: update existing if near-duplicate found
        if (!input.skipDedup) {
          const existing = await this.findNearDuplicate(chunk.content, embedding, db);
          if (existing) {
            // Update if new content is longer (preferLonger) or importance is higher
            const shouldUpdate = (this.config.dedup.preferLonger && chunk.content.length > existing.content.length)
              || (input.importance && input.importance > existing.importance);

            if (shouldUpdate) {
              db.prepare('UPDATE memories SET content = ?, importance = MAX(importance, ?) WHERE id = ?')
                .run(chunk.content, input.importance ?? 3, existing.id);
              db.prepare('UPDATE vec_memories SET embedding = ? WHERE rowid = ?')
                .run(JSON.stringify(embedding), BigInt(existing.id));
            }
            memoryIds.push(existing.id);
            continue;
          }
        }

        // Add chunk indicator if multi-part
        let storedContent = chunk.content;
        if (chunk.total > 1) {
          storedContent = `[Part ${chunk.index + 1}/${chunk.total}] ${chunk.content}`;
        }

        // Insert memory with project column
        const stmt = db.prepare(`
          INSERT INTO memories (content, type, project, category, reasoning, source, importance, confidence, tags, expires_at, supersedes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
          storedContent,
          input.type || 'fact',
          projectValue,
          input.category || null,
          input.reasoning || null,
          input.source || 'manual',
          input.importance ?? 3,
          input.confidence ?? 1.0,
          JSON.stringify(input.tags || []),
          input.expiresAt || null,
          input.supersedes || null
        );

        const memoryId = result.lastInsertRowid;

        // Insert embedding (vec0 requires BigInt for rowid)
        const vecStmt = db.prepare(`
          INSERT INTO vec_memories (rowid, embedding)
          VALUES (?, ?)
        `);
        vecStmt.run(BigInt(memoryId), JSON.stringify(embedding));

        // Mark superseded memory as obsolete
        if (input.supersedes) {
          db.prepare('UPDATE memories SET is_obsolete = 1 WHERE id = ?').run(input.supersedes);
        }

        memoryIds.push(Number(memoryId));
      }
    } finally {
      db.close();
    }

    return memoryIds;
  }

  async recall(query: string, options: RecallOptions = {}): Promise<RecallResult[]> {
    const project = this.detectProject();
    const queryEmbedding = await this.embedder.embed(query);

    // cmem v3: Search unified DB, prioritize current project
    const results = await this.searchUnifiedDb(queryEmbedding, project, options);

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Filter by distance threshold
    const filtered = results.filter(r => r.distance < this.config.recall.distanceThreshold);

    // Apply limit
    const limit = options.limit || (this.config.recall.projectResults + this.config.recall.globalResults);
    return filtered.slice(0, limit);
  }

  /**
   * cmem v3: Search unified database with optional project prioritization
   */
  private async searchUnifiedDb(
    queryEmbedding: number[],
    currentProject: string | null,
    options: RecallOptions
  ): Promise<RecallResult[]> {
    const db = this.getDb();
    const results: RecallResult[] = [];

    try {
      const totalLimit = this.config.recall.projectResults + this.config.recall.globalResults;

      let sql = `
        SELECT
          m.id, m.content, m.type, m.project, m.category, m.reasoning, m.source,
          m.importance, m.confidence, m.created_at, m.last_accessed,
          m.access_count, m.expires_at, m.supersedes, m.is_obsolete, m.tags,
          v.distance
        FROM vec_memories v
        JOIN memories m ON v.rowid = m.id
        WHERE v.embedding MATCH ?
          AND k = ?
      `;

      const params: unknown[] = [JSON.stringify(queryEmbedding), totalLimit * 2];

      if (!options.includeObsolete) {
        sql += ' AND m.is_obsolete = 0';
      }

      if (options.type) {
        sql += ' AND m.type = ?';
        params.push(options.type);
      }

      if (options.minImportance) {
        sql += ' AND m.importance >= ?';
        params.push(options.minImportance);
      }

      // Filter expired
      sql += ' AND (m.expires_at IS NULL OR m.expires_at > unixepoch())';

      sql += ' ORDER BY v.distance LIMIT ?';
      params.push(totalLimit * 2);

      const rows = db.prepare(sql).all(...params) as Array<{
        id: number;
        content: string;
        type: MemoryType;
        project: string | null;
        category: string | null;
        reasoning: string | null;
        source: string;
        importance: number;
        confidence: number;
        created_at: number;
        last_accessed: number | null;
        access_count: number;
        expires_at: number | null;
        supersedes: number | null;
        is_obsolete: number;
        tags: string;
        distance: number;
      }>;

      for (const row of rows) {
        const memory: Memory = {
          id: row.id,
          content: row.content,
          type: row.type,
          project: row.project || undefined,
          category: row.category || undefined,
          reasoning: row.reasoning || undefined,
          source: row.source as Memory['source'],
          importance: row.importance,
          confidence: row.confidence,
          createdAt: row.created_at,
          lastAccessed: row.last_accessed || undefined,
          accessCount: row.access_count,
          expiresAt: row.expires_at || undefined,
          supersedes: row.supersedes || undefined,
          isObsolete: row.is_obsolete === 1,
          tags: JSON.parse(row.tags)
        };

        // Calculate score with project boost
        let score = this.calculateScore(memory, row.distance);

        // Boost current project memories
        if (currentProject && row.project === currentProject) {
          score *= 1.3;  // 30% boost for same project
        }

        // Slightly boost global memories (preferences) when in project context
        if (currentProject && row.project === null && row.type === 'preference') {
          score *= 1.1;  // 10% boost for global preferences
        }

        results.push({
          memory,
          distance: row.distance,
          score,
          source: row.project  // project name or null for global
        });

        // Update access stats
        db.prepare(`
          UPDATE memories
          SET last_accessed = unixepoch(), access_count = access_count + 1
          WHERE id = ?
        `).run(row.id);
      }
    } finally {
      db.close();
    }

    return results;
  }

  private calculateScore(memory: Memory, distance: number): number {
    // Base score from similarity (lower distance = higher score)
    let score = 1 / (1 + distance);

    // Recency boost
    if (this.config.recall.boostRecency) {
      const ageInDays = (Date.now() / 1000 - memory.createdAt) / 86400;
      const halfLife = this.config.recall.recencyHalfLifeDays;
      const recencyBoost = Math.exp(-ageInDays / halfLife);
      score *= (0.7 + 0.3 * recencyBoost);
    }

    // Importance boost (1-5 scale)
    score *= (0.5 + 0.1 * memory.importance);

    // Access frequency boost (capped at 10)
    score *= (1 + 0.05 * Math.min(memory.accessCount, 10));

    // Confidence factor
    score *= memory.confidence;

    return score;
  }

  async markObsolete(memoryId: number, _project?: string | null): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare('UPDATE memories SET is_obsolete = 1 WHERE id = ?').run(memoryId);
    } finally {
      db.close();
    }
  }

  async forget(memoryId: number, _project?: string | null): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare('DELETE FROM vec_memories WHERE rowid = ?').run(BigInt(memoryId));
      db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
    } finally {
      db.close();
    }
  }

  async forgetByCategory(category: string, project?: string | null, dryRun: boolean = false): Promise<number> {
    const db = this.getDb();
    try {
      // Build query with optional project filter
      let countSql = 'SELECT COUNT(*) as count FROM memories WHERE category = ?';
      const params: unknown[] = [category];

      if (project !== undefined) {
        if (project === null) {
          countSql += ' AND project IS NULL';
        } else {
          countSql += ' AND project = ?';
          params.push(project);
        }
      }

      const countResult = db.prepare(countSql).get(...params) as { count: number };
      const count = countResult.count;

      if (!dryRun && count > 0) {
        let deleteSql = 'DELETE FROM vec_memories WHERE rowid IN (SELECT id FROM memories WHERE category = ?';
        let deleteMemsSql = 'DELETE FROM memories WHERE category = ?';
        const delParams: unknown[] = [category];

        if (project !== undefined) {
          if (project === null) {
            deleteSql += ' AND project IS NULL';
            deleteMemsSql += ' AND project IS NULL';
          } else {
            deleteSql += ' AND project = ?';
            deleteMemsSql += ' AND project = ?';
            delParams.push(project);
          }
        }
        deleteSql += ')';

        db.prepare(deleteSql).run(...delParams);
        db.prepare(deleteMemsSql).run(...delParams);
      }

      return count;
    } finally {
      db.close();
    }
  }

  async forgetBySource(source: string, project?: string | null, dryRun: boolean = false): Promise<number> {
    const db = this.getDb();
    try {
      let countSql = 'SELECT COUNT(*) as count FROM memories WHERE source = ?';
      const params: unknown[] = [source];

      if (project !== undefined) {
        if (project === null) {
          countSql += ' AND project IS NULL';
        } else {
          countSql += ' AND project = ?';
          params.push(project);
        }
      }

      const countResult = db.prepare(countSql).get(...params) as { count: number };
      const count = countResult.count;

      if (!dryRun && count > 0) {
        let deleteSql = 'DELETE FROM vec_memories WHERE rowid IN (SELECT id FROM memories WHERE source = ?';
        let deleteMemsSql = 'DELETE FROM memories WHERE source = ?';
        const delParams: unknown[] = [source];

        if (project !== undefined) {
          if (project === null) {
            deleteSql += ' AND project IS NULL';
            deleteMemsSql += ' AND project IS NULL';
          } else {
            deleteSql += ' AND project = ?';
            deleteMemsSql += ' AND project = ?';
            delParams.push(project);
          }
        }
        deleteSql += ')';

        db.prepare(deleteSql).run(...delParams);
        db.prepare(deleteMemsSql).run(...delParams);
      }

      return count;
    } finally {
      db.close();
    }
  }

  async update(memoryId: number, content: string, _project?: string | null): Promise<void> {
    const db = this.getDb();
    try {
      const embedding = await this.embedder.embed(content);

      db.prepare('UPDATE memories SET content = ? WHERE id = ?').run(content, memoryId);
      db.prepare('UPDATE vec_memories SET embedding = ? WHERE rowid = ?').run(
        JSON.stringify(embedding),
        BigInt(memoryId)
      );
    } finally {
      db.close();
    }
  }

  /**
   * List recent memories with optional project filtering.
   * @param limit Max results
   * @param project Project name to filter, null for global only, undefined for all
   * @param allProjects If true, list all memories regardless of project
   */
  async listRecent(limit: number = 10, project?: string | null, allProjects: boolean = false): Promise<Memory[]> {
    const db = this.getDb();
    try {
      let sql = `
        SELECT * FROM memories
        WHERE is_obsolete = 0
      `;
      const params: unknown[] = [];

      if (!allProjects) {
        if (project === undefined) {
          // Use detected project
          const detected = this.detectProject();
          if (detected) {
            sql += ' AND (project = ? OR project IS NULL)';
            params.push(detected);
          }
        } else if (project === null) {
          sql += ' AND project IS NULL';
        } else {
          sql += ' AND project = ?';
          params.push(project);
        }
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as Array<{
        id: number;
        content: string;
        type: MemoryType;
        project: string | null;
        category: string | null;
        reasoning: string | null;
        source: string;
        importance: number;
        confidence: number;
        created_at: number;
        last_accessed: number | null;
        access_count: number;
        expires_at: number | null;
        supersedes: number | null;
        is_obsolete: number;
        tags: string;
      }>;

      return rows.map(row => ({
        id: row.id,
        content: row.content,
        type: row.type,
        project: row.project || undefined,
        category: row.category || undefined,
        reasoning: row.reasoning || undefined,
        source: row.source as Memory['source'],
        importance: row.importance,
        confidence: row.confidence,
        createdAt: row.created_at,
        lastAccessed: row.last_accessed || undefined,
        accessCount: row.access_count,
        expiresAt: row.expires_at || undefined,
        supersedes: row.supersedes || undefined,
        isObsolete: row.is_obsolete === 1,
        tags: JSON.parse(row.tags)
      }));
    } finally {
      db.close();
    }
  }

  async garbageCollect(project?: string | null): Promise<number> {
    const db = this.getDb();
    let deleted = 0;

    try {
      const maxAge = this.config.gc.maxAgeUnusedDays * 86400;
      const minConfidence = this.config.gc.minConfidence;
      const cutoff = Math.floor(Date.now() / 1000) - maxAge;

      let deleteSql = `
        DELETE FROM memories
        WHERE (last_accessed IS NULL OR last_accessed < ?)
          AND confidence < ?
          AND access_count = 0
      `;
      const params: unknown[] = [cutoff, minConfidence];

      if (project !== undefined) {
        if (project === null) {
          deleteSql += ' AND project IS NULL';
        } else {
          deleteSql += ' AND project = ?';
          params.push(project);
        }
      }

      const result = db.prepare(deleteSql).run(...params);
      deleted = result.changes;

      // Clean up orphaned vectors
      db.exec(`
        DELETE FROM vec_memories
        WHERE rowid NOT IN (SELECT id FROM memories)
      `);

      // Delete expired memories
      let expiredSql = 'DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < unixepoch()';
      const expiredParams: unknown[] = [];

      if (project !== undefined) {
        if (project === null) {
          expiredSql += ' AND project IS NULL';
        } else {
          expiredSql += ' AND project = ?';
          expiredParams.push(project);
        }
      }

      const expiredResult = db.prepare(expiredSql).run(...expiredParams);
      deleted += expiredResult.changes;

    } finally {
      db.close();
    }

    return deleted;
  }

  async getStats(project?: string | null, allProjects: boolean = false): Promise<{
    total: number;
    byType: Record<string, number>;
    byProject: Record<string, number>;
    obsolete: number;
    avgImportance: number;
  }> {
    const db = this.getDb();
    try {
      let whereClause = '';
      const params: unknown[] = [];

      if (!allProjects) {
        if (project === undefined) {
          const detected = this.detectProject();
          if (detected) {
            whereClause = ' WHERE (project = ? OR project IS NULL)';
            params.push(detected);
          }
        } else if (project === null) {
          whereClause = ' WHERE project IS NULL';
        } else {
          whereClause = ' WHERE project = ?';
          params.push(project);
        }
      }

      const total = (db.prepare(`SELECT COUNT(*) as count FROM memories${whereClause}`).get(...params) as { count: number }).count;

      const obsoleteClause = whereClause ? `${whereClause} AND is_obsolete = 1` : ' WHERE is_obsolete = 1';
      const obsolete = (db.prepare(`SELECT COUNT(*) as count FROM memories${obsoleteClause}`).get(...params) as { count: number }).count;

      const activeClause = whereClause ? `${whereClause} AND is_obsolete = 0` : ' WHERE is_obsolete = 0';
      const avgImportance = (db.prepare(`SELECT AVG(importance) as avg FROM memories${activeClause}`).get(...params) as { avg: number | null }).avg || 0;

      const typeRows = db.prepare(`SELECT type, COUNT(*) as count FROM memories${activeClause} GROUP BY type`).all(...params) as Array<{ type: string; count: number }>;
      const byType: Record<string, number> = {};
      for (const row of typeRows) {
        byType[row.type] = row.count;
      }

      // New: stats by project
      const projectRows = db.prepare(`
        SELECT COALESCE(project, 'global') as proj, COUNT(*) as count
        FROM memories WHERE is_obsolete = 0
        GROUP BY project
      `).all() as Array<{ proj: string; count: number }>;
      const byProject: Record<string, number> = {};
      for (const row of projectRows) {
        byProject[row.proj] = row.count;
      }

      return { total, byType, byProject, obsolete, avgImportance };
    } finally {
      db.close();
    }
  }

  getProjectRegistry(): ProjectRegistryManager {
    return this.projectRegistry;
  }

  /**
   * Consolidate near-duplicate memories by clustering.
   * Keeps the highest-scoring memory per cluster, marks others obsolete.
   */
  async consolidate(project?: string | null, dryRun: boolean = false): Promise<{ consolidated: number; clusters: Array<{ kept: number; merged: number[] }> }> {
    const db = this.getDb();
    const clusters: Array<{ kept: number; merged: number[] }> = [];

    try {
      // Load all active memories
      let sql = 'SELECT id, content, importance, confidence, access_count FROM memories WHERE is_obsolete = 0';
      const params: unknown[] = [];

      if (project !== undefined) {
        if (project === null) {
          sql += ' AND project IS NULL';
        } else {
          sql += ' AND project = ?';
          params.push(project);
        }
      }

      const memories = db.prepare(sql).all(...params) as Array<{
        id: number; content: string; importance: number; confidence: number; access_count: number;
      }>;

      const threshold = this.config.dedup.similarityThreshold * 2;
      const processed = new Set<number>();
      let totalConsolidated = 0;

      for (const mem of memories) {
        if (processed.has(mem.id)) continue;
        processed.add(mem.id);

        // Find neighbors
        const neighbors = db.prepare(`
          SELECT v.rowid as id, v.distance
          FROM vec_memories v
          JOIN memories m ON v.rowid = m.id
          WHERE v.embedding MATCH (SELECT embedding FROM vec_memories WHERE rowid = ?)
            AND k = 20
            AND m.is_obsolete = 0
            AND v.rowid != ?
        `).all(BigInt(mem.id), BigInt(mem.id)) as Array<{ id: number; distance: number }>;

        const cluster = neighbors
          .filter(n => n.distance < threshold && !processed.has(n.id))
          .map(n => n.id);

        if (cluster.length === 0) continue;

        // Score all members including current
        const allIds = [mem.id, ...cluster];
        const scores: Array<{ id: number; score: number }> = [];

        for (const id of allIds) {
          const m = db.prepare('SELECT importance, confidence, access_count FROM memories WHERE id = ?').get(id) as {
            importance: number; confidence: number; access_count: number;
          };
          if (m) {
            scores.push({ id, score: m.importance * m.confidence * (1 + m.access_count) });
          }
        }

        scores.sort((a, b) => b.score - a.score);
        const winner = scores[0].id;
        const losers = scores.slice(1).map(s => s.id);

        if (!dryRun) {
          for (const loserId of losers) {
            db.prepare('UPDATE memories SET is_obsolete = 1, supersedes = ? WHERE id = ?').run(winner, loserId);
          }
        }

        for (const id of losers) processed.add(id);
        totalConsolidated += losers.length;
        clusters.push({ kept: winner, merged: losers });
      }

      return { consolidated: totalConsolidated, clusters };
    } finally {
      db.close();
    }
  }

  /**
   * Remove corrupted memories (JSON artifacts, Haiku prompts, tiny content).
   */
  async cleanupCorrupted(dryRun: boolean = false): Promise<{ count: number; samples: string[] }> {
    const db = this.getDb();
    const corruptPatterns = [
      /^\s*\{/, // Starts with JSON object
      /^\s*\[(?!\w)/, // Starts with JSON array (but not [filepath] prefixed content)
      /^\s*Sois exhaustif/i, // Haiku prompt leaked
      /Réponds UNIQUEMENT en JSON/i,
      /^\s*Tu es un assistant/i, // Haiku system prompt leaked
    ];

    try {
      const rows = db.prepare('SELECT id, content FROM memories WHERE is_obsolete = 0').all() as Array<{ id: number; content: string }>;

      const corrupted: number[] = [];
      const samples: string[] = [];

      for (const row of rows) {
        const isCorrupt = row.content.trim().length < 20
          || corruptPatterns.some(p => p.test(row.content.trim()));

        if (isCorrupt) {
          corrupted.push(row.id);
          if (samples.length < 10) {
            samples.push(`#${row.id}: ${row.content.slice(0, 80)}`);
          }
        }
      }

      if (!dryRun && corrupted.length > 0) {
        for (const id of corrupted) {
          db.prepare('DELETE FROM vec_memories WHERE rowid = ?').run(BigInt(id));
          db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        }
      }

      return { count: corrupted.length, samples };
    } finally {
      db.close();
    }
  }

  async isReady(): Promise<boolean> {
    return this.embedder.isAvailable();
  }
}
