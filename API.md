# CMEM TypeScript API Reference

## MemoryManager

The main class for all memory operations.

### Import

```typescript
import { MemoryManager } from './memory-manager.js';

const manager = new MemoryManager();
```

### Methods

#### remember(input: MemoryInput): Promise<number[]>

Store a new memory. Returns array of memory IDs (multiple if content was chunked).

```typescript
interface MemoryInput {
  content: string;           // Required: The memory content
  type?: MemoryType;         // Default: 'fact'
  category?: string;         // Optional category tag
  project?: string;          // Auto-detected if not provided
  reasoning?: string;        // Why (for decisions)
  source?: MemorySource;     // Default: 'manual'
  importance?: number;       // 1-5, default: 3
  confidence?: number;       // 0-1, default: 1.0
  tags?: string[];           // Optional tags array
  expiresAt?: number;        // Unix timestamp
  supersedes?: number;       // ID of memory this replaces
}

// Example
const ids = await manager.remember({
  content: "Using Prisma ORM for type-safety",
  type: "decision",
  importance: 4,
  reasoning: "Better DX than raw SQL",
  tags: ["database", "orm"]
});
console.log(`Stored memory: ${ids[0]}`);
```

#### recall(query: string, options?: RecallOptions): Promise<RecallResult[]>

Semantic search for relevant memories.

```typescript
interface RecallOptions {
  limit?: number;            // Max results (default: 7)
  type?: MemoryType;         // Filter by type
  minImportance?: number;    // Min importance threshold
  includeObsolete?: boolean; // Include obsolete memories
}

interface RecallResult {
  memory: Memory;            // The memory object
  distance: number;          // L2 distance (lower = more similar)
  score: number;             // Combined relevance score
  source: string | null;     // Project name or null for global
}

// Example
const results = await manager.recall("authentication", {
  limit: 5,
  type: "decision"
});

for (const r of results) {
  console.log(`[${r.source || 'global'}] ${r.memory.content}`);
  console.log(`  Score: ${r.score.toFixed(3)}`);
}
```

#### listRecent(limit?: number, project?: string | null, allProjects?: boolean): Promise<Memory[]>

List recent memories.

```typescript
// Current project + global
const memories = await manager.listRecent(10);

// Global only
const globalMemories = await manager.listRecent(10, null);

// Specific project
const projectMemories = await manager.listRecent(10, "my-project");

// All projects
const allMemories = await manager.listRecent(100, undefined, true);
```

#### markObsolete(memoryId: number): Promise<void>

Mark a memory as obsolete. It's kept but excluded from recall.

```typescript
await manager.markObsolete(42);
```

#### forget(memoryId: number): Promise<void>

Permanently delete a memory.

```typescript
await manager.forget(42);
```

#### forgetByCategory(category: string, project?: string | null, dryRun?: boolean): Promise<number>

Delete all memories in a category. Returns count of deleted memories.

```typescript
// Preview
const count = await manager.forgetByCategory("documentation", undefined, true);
console.log(`Would delete ${count} memories`);

// Actually delete
await manager.forgetByCategory("documentation");
```

#### forgetBySource(source: string, project?: string | null, dryRun?: boolean): Promise<number>

Delete memories by source type.

```typescript
await manager.forgetBySource("auto:ingest");
```

#### update(memoryId: number, content: string): Promise<void>

Update memory content (re-embeds).

```typescript
await manager.update(42, "Updated content here");
```

#### garbageCollect(project?: string | null): Promise<number>

Remove old unused memories. Returns count deleted.

```typescript
const deleted = await manager.garbageCollect();
console.log(`Cleaned ${deleted} memories`);
```

#### getStats(project?: string | null, allProjects?: boolean): Promise<Stats>

Get memory statistics.

```typescript
interface Stats {
  total: number;
  byType: Record<string, number>;
  byProject: Record<string, number>;
  obsolete: number;
  avgImportance: number;
}

const stats = await manager.getStats();
console.log(`Total: ${stats.total}`);
console.log(`By type:`, stats.byType);
```

#### detectProject(cwd?: string): string | null

Detect current project from working directory.

```typescript
const project = manager.detectProject();
// Returns project name or null
```

#### isReady(): Promise<boolean>

Check if MLX embedding server is available.

```typescript
if (await manager.isReady()) {
  // Proceed with memory operations
} else {
  console.log("MLX server not available");
}
```

#### getProjectRegistry(): ProjectRegistryManager

Access the project registry for project management.

```typescript
const registry = manager.getProjectRegistry();
const projects = registry.listProjects();
```

---

## ProjectRegistryManager

Manages project path mappings.

### Methods

#### detectProject(cwd?: string): string | null

Detect project from path.

```typescript
const project = registry.detectProject("/Users/me/work/my-app");
```

#### createProject(name: string, path?: string, description?: string): void

Register a new project.

```typescript
registry.createProject(
  "my-app",
  "/Users/me/work/my-app",
  "Main application"
);
```

#### addPath(name: string, path: string): void

Add additional path to existing project.

```typescript
registry.addPath("my-app", "/Users/me/work/my-app-v2");
```

#### deleteProject(name: string): void

Remove project from registry.

```typescript
registry.deleteProject("old-project");
```

#### listProjects(): Array<{ name: string; info: ProjectInfo }>

List all registered projects.

```typescript
interface ProjectInfo {
  paths: string[];
  description: string;
  createdAt: number;
}

const projects = registry.listProjects();
for (const { name, info } of projects) {
  console.log(`${name}: ${info.paths.join(", ")}`);
}
```

---

## Types

### MemoryType

```typescript
type MemoryType =
  | 'decision'      // Technical decisions with reasoning
  | 'preference'    // User preferences (global scope)
  | 'fact'          // Facts and configurations
  | 'pattern'       // Detected behavioral patterns
  | 'conversation'; // Session summaries
```

### MemorySource

```typescript
type MemorySource =
  | 'manual'          // User explicitly saved
  | 'auto:session'    // Implicit detection from prompt
  | 'auto:commit'     // Captured from git commits
  | 'auto:pattern'    // Detected pattern
  | 'auto:bootstrap'  // Initial setup
  | 'auto:ingest'     // Bulk imported
  | 'auto:response'   // Captured from response
  | 'auto:precompact';// Extracted before compaction
```

### Memory

```typescript
interface Memory {
  id: number;
  content: string;
  type: MemoryType;
  category?: string;
  project?: string;        // undefined for global
  reasoning?: string;
  source: MemorySource;
  importance: number;      // 1-5
  confidence: number;      // 0-1
  createdAt: number;       // Unix timestamp
  lastAccessed?: number;   // Unix timestamp
  accessCount: number;
  expiresAt?: number;      // Unix timestamp
  supersedes?: number;     // ID of replaced memory
  isObsolete: boolean;
  tags: string[];
}
```

### Config

```typescript
interface Config {
  embedding: {
    provider: 'mlx';
    model: string;
    dimensions: number;
    baseUrl: string;
  };
  chunking: {
    maxTokens: number;
    overlapTokens: number;
    minChunkSize: number;
  };
  recall: {
    projectResults: number;
    globalResults: number;
    globalTypesInProject: MemoryType[];
    distanceThreshold: number;
    boostRecency: boolean;
    recencyHalfLifeDays: number;
  };
  capture: {
    autoSession: boolean;
    autoCommit: boolean;
    commitPatterns: string[];
    minImportance: number;
  };
  sensitive: {
    patterns: string[];
  };
  gc: {
    maxAgeUnusedDays: number;
    minConfidence: number;
  };
}
```

---

## MLXEmbedder

HTTP client for the MLX embedding server.

### Interface

```typescript
interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
  getDimensions(): number;
}
```

### Usage

```typescript
import { MLXEmbedder } from './mlx-embedder.js';

const embedder = new MLXEmbedder({
  baseUrl: "http://127.0.0.1:8767",
  dimensions: 384
});

// Single text
const embedding = await embedder.embed("Some text to embed");
console.log(embedding.length); // 384

// Batch
const embeddings = await embedder.embedBatch([
  "First text",
  "Second text"
]);

// Check availability
if (await embedder.isAvailable()) {
  // Server is running
}
```

---

## SmartChunker

Splits long content for optimal embedding.

### Usage

```typescript
import { SmartChunker } from './chunker.js';

const chunker = new SmartChunker({
  maxTokens: 500,
  overlapTokens: 50,
  minChunkSize: 100
});

const chunks = chunker.chunk(longText);
// Returns: Array<{ content: string; index: number; total: number }>

for (const chunk of chunks) {
  console.log(`Chunk ${chunk.index + 1}/${chunk.total}`);
  console.log(chunk.content);
}
```

---

## Error Handling

All methods throw standard JavaScript errors:

```typescript
try {
  await manager.remember({ content: "test" });
} catch (error) {
  if (error instanceof Error) {
    console.error(`Memory error: ${error.message}`);
  }
}
```

Common errors:
- `"MLX server not available"` - Server not running
- `"Config not found"` - Missing config.json
- `"Project 'x' not found"` - Unknown project name
- `"Project 'x' already exists"` - Duplicate project
