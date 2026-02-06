# CMEM Architecture

## System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Claude Code Session                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │ UserPromptSubmit│    │  PostToolUse    │    │   PreCompact    │     │
│  │     Hook        │    │     Hook        │    │     Hook        │     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│           │                      │                      │               │
│           ▼                      ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      cmem TypeScript Core                        │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │   │
│  │  │   recall.ts │ │capture-     │ │extract-     │ │  cli.ts   │  │   │
│  │  │             │ │commit.ts    │ │precompact.ts│ │           │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘  │   │
│  │                        ▼                                         │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │                   MemoryManager                            │  │   │
│  │  │  - remember()    - recall()      - forget()               │  │   │
│  │  │  - listRecent()  - markObsolete() - garbageCollect()      │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                          │           │                                   │
│                          ▼           ▼                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐    │
│  │   MLX Embedder  │  │  SmartChunker    │  │  ProjectRegistry    │    │
│  │   (HTTP client) │  │  (text→chunks)   │  │  (path→project)     │    │
│  └────────┬────────┘  └──────────────────┘  └─────────────────────┘    │
│           │                                                              │
└───────────┼──────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    MLX Embedding Server (Python)                         │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  │
│  │   FastAPI   │  │  mlx-embeddings  │  │  all-MiniLM-L6-v2-4bit   │  │
│  │   :8767     │  │    library       │  │       model               │  │
│  └─────────────┘  └──────────────────┘  └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SQLite + sqlite-vec Storage                         │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       memories.db (Unified)                      │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  TABLE memories:                                                 │   │
│  │    id, content, type, project, category, reasoning, source,     │   │
│  │    importance, confidence, created_at, last_accessed,           │   │
│  │    access_count, expires_at, supersedes, is_obsolete, tags      │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │  VIRTUAL TABLE vec_memories (sqlite-vec):                       │   │
│  │    rowid → memories.id, embedding float[384]                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  project-registry.json  │  │          config.json                │  │
│  │  project→paths mapping  │  │    system configuration             │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
~/.claude/cmem/
├── config.json               # System configuration
├── project-registry.json     # Project path mappings
├── memories.db               # Unified SQLite database
├── hooks.log                 # Hook execution logs
├── package.json              # Node.js dependencies
├── tsconfig.json             # TypeScript config
├── install.sh                # Installation script
│
├── src/                      # TypeScript source
│   ├── cli.ts                # Command-line interface
│   ├── memory-manager.ts     # Core memory operations
│   ├── mlx-embedder.ts       # MLX server client
│   ├── chunker.ts            # Text chunking logic
│   ├── project-registry.ts   # Project detection
│   ├── types.ts              # TypeScript types
│   └── hooks/
│       ├── recall.ts         # UserPromptSubmit hook
│       ├── capture-commit.ts # PostToolUse hook
│       ├── capture-response.ts      # Stop hook
│       └── extract-before-compact.ts  # PreCompact hook
│
├── scripts/
│   └── gc-auto.sh           # Automatic GC (runs via launchd every 6h)
│
├── dist/                     # Compiled JavaScript
│   └── (mirrors src/)
│
└── mlx-server/               # Python embedding server
    ├── server.py             # FastAPI application
    ├── requirements.txt      # Python dependencies
    ├── venv/                 # Python virtual environment
    └── com.cmem.mlx-server.plist  # macOS LaunchAgent
```

## Core Components

### 1. MemoryManager (`memory-manager.ts`)

The central class handling all memory operations:

```typescript
class MemoryManager {
  // Store
  async remember(input: MemoryInput): Promise<number[]>

  // Retrieve
  async recall(query: string, options?: RecallOptions): Promise<RecallResult[]>
  async listRecent(limit?: number, project?: string): Promise<Memory[]>

  // Modify
  async update(memoryId: number, content: string): Promise<void>
  async markObsolete(memoryId: number): Promise<void>
  async forget(memoryId: number): Promise<void>

  // Maintenance
  async garbageCollect(project?: string): Promise<number>
  async consolidate(project?: string, dryRun?: boolean): Promise<ConsolidateResult>
  async cleanupCorrupted(dryRun?: boolean): Promise<CleanupResult>
  async getStats(project?: string): Promise<Stats>

  // Utilities
  detectProject(cwd?: string): string | null
  async isReady(): Promise<boolean>
}
```

### 2. MLXEmbedder (`mlx-embedder.ts`)

HTTP client for the MLX embedding server:

```typescript
interface Embedder {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  isAvailable(): Promise<boolean>
  getDimensions(): number
}
```

### 3. SmartChunker (`chunker.ts`)

Splits long content into optimal chunks for embedding:

- Respects paragraph boundaries
- Falls back to sentence splitting
- Maintains context overlap between chunks
- Merges tiny chunks

### 4. ProjectRegistry (`project-registry.ts`)

Maps filesystem paths to project names:

```typescript
class ProjectRegistryManager {
  detectProject(cwd?: string): string | null
  createProject(name: string, path?: string, description?: string): void
  addPath(name: string, path: string): void
  listProjects(): Array<{ name: string; info: ProjectInfo }>
}
```

## Data Flow

### Remember Flow

```
Content → Sanitize → Chunk → For Each Chunk:
                              → Embed (MLX)
                              → Dedup Check (find nearest neighbor < threshold)
                                → If duplicate: update existing (keep max importance, longer content)
                                → If new: store memory row + embedding vector
```

### Recall Flow

```
Query → Embed Query → Vector Search (sqlite-vec)
                           ↓
                    Join with memories table
                           ↓
                    Apply filters (obsolete, expired, type)
                           ↓
                    Calculate scores:
                      score = similarity × recency × importance × usage × confidence
                           ↓
                    Sort by score → Return top N
```

### Project Detection Flow

```
Current working directory
         ↓
For each registered project:
  For each project path:
    If cwd starts with path → return project name
         ↓
If no match → return null (global scope)
```

## Database Schema

### memories table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| content | TEXT | Memory content |
| type | TEXT | decision/preference/fact/pattern/conversation |
| project | TEXT | Project name (NULL = global) |
| category | TEXT | User-defined category |
| reasoning | TEXT | Why this decision was made |
| source | TEXT | How it was captured |
| importance | INTEGER | 1-5 scale |
| confidence | REAL | 0-1 confidence score |
| created_at | INTEGER | Unix timestamp |
| last_accessed | INTEGER | Last retrieval timestamp |
| access_count | INTEGER | Times retrieved |
| expires_at | INTEGER | Optional expiration |
| supersedes | INTEGER | ID of replaced memory |
| is_obsolete | INTEGER | 0/1 flag |
| tags | TEXT | JSON array of tags |

### vec_memories virtual table

| Column | Type | Description |
|--------|------|-------------|
| rowid | INTEGER | Links to memories.id |
| embedding | float[384] | Vector embedding |

## Scoring Algorithm

```typescript
score = similarity × recency × importance × usage × confidence

// Similarity (lower distance = higher score)
similarity = 1 / (1 + distance)

// Recency (exponential decay over 30 days)
recencyBoost = exp(-ageInDays / halfLifeDays)
recency = 0.7 + 0.3 × recencyBoost

// Importance (1-5 mapped to multiplier)
importance = 0.5 + 0.1 × importanceLevel

// Usage frequency (capped at 10 accesses)
usage = 1 + 0.05 × min(accessCount, 10)

// Confidence (0-1 from capture method)
confidence = memory.confidence

// Project boost (if in same project)
if (sameProject) score *= 1.3
```

## Security Considerations

### Sensitive Data Redaction

Patterns auto-redacted before storage:
- OpenAI API keys: `sk-[a-zA-Z0-9]{32,}`
- GitHub tokens: `ghp_[a-zA-Z0-9]{36}`
- Generic patterns: `password\s*[:=]\s*\S+`

### Local-Only Processing

- All data stored locally
- Embeddings generated locally (no cloud API)
- No data leaves the machine

## Performance Characteristics

| Operation | Typical Latency |
|-----------|-----------------|
| Embed single text | 10-50ms |
| Vector search | 5-20ms |
| Full recall (embed + search) | 50-100ms |
| Remember (with chunking) | 100-500ms |

Optimized for:
- Real-time recall during prompts
- Background commit capture
- Batch ingest of documentation
