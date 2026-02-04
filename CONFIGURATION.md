# CMEM Configuration Reference

## Claude Code Hooks

Hooks are configured in `~/.claude/settings.json`.

> ⚠️ **IMPORTANT**: Do NOT put hooks in `settings.local.json` if `settings.json` has a `hooks` section — they will be ignored. See [HOOKS.md](./HOOKS.md) for details.

---

## config.json

Location: `~/.claude/cmem/config.json`

```json
{
  "embedding": { ... },
  "chunking": { ... },
  "recall": { ... },
  "capture": { ... },
  "sensitive": { ... },
  "gc": { ... }
}
```

---

## embedding

Configures the embedding model for vector search.

```json
"embedding": {
  "provider": "mlx",
  "model": "all-MiniLM-L6-v2-4bit",
  "dimensions": 384,
  "baseUrl": "http://127.0.0.1:8767"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `provider` | string | Embedding provider. Only `"mlx"` supported currently |
| `model` | string | Model name (for reference, actual model is set in server.py) |
| `dimensions` | number | Vector dimensions. Must match model output (384 for MiniLM) |
| `baseUrl` | string | URL of the MLX embedding server |

### Changing the Embedding Model

To use a different model:

1. Update `server.py`:
   ```python
   MODEL_NAME = "mlx-community/your-model-name"
   DIMENSIONS = 768  # Match your model's output
   ```

2. Update `config.json`:
   ```json
   "embedding": {
     "dimensions": 768,
     ...
   }
   ```

3. Re-embed all memories (required after dimension change):
   ```bash
   # Delete and re-ingest all memories, or
   # Create a migration script
   ```

---

## chunking

Controls how long content is split for optimal embedding.

```json
"chunking": {
  "maxTokens": 500,
  "overlapTokens": 50,
  "minChunkSize": 100
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxTokens` | number | 500 | Maximum tokens per chunk (~2000 characters) |
| `overlapTokens` | number | 50 | Overlap between chunks for context continuity |
| `minChunkSize` | number | 100 | Minimum chunk size (small chunks are merged) |

### Chunking Strategy

1. Try to split by paragraphs (double newlines)
2. If paragraph > maxTokens, split by sentences
3. Add overlap from previous chunk end
4. Merge chunks smaller than minChunkSize

**Token estimation**: 1 token ≈ 4 characters

---

## recall

Controls memory retrieval behavior.

```json
"recall": {
  "projectResults": 5,
  "globalResults": 2,
  "globalTypesInProject": ["preference", "fact"],
  "distanceThreshold": 50.0,
  "boostRecency": true,
  "recencyHalfLifeDays": 30
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projectResults` | number | 5 | Max project-scoped memories to return |
| `globalResults` | number | 2 | Max global memories to return |
| `globalTypesInProject` | string[] | ["preference", "fact"] | Global types to include when in project context |
| `distanceThreshold` | number | 50.0 | Maximum L2 distance for inclusion |
| `boostRecency` | boolean | true | Apply recency boost to scores |
| `recencyHalfLifeDays` | number | 30 | Half-life for recency decay |

### Distance Threshold Tuning

- **Lower values** (10-30): More strict, only very similar memories
- **Higher values** (50-100): More permissive, broader results
- **Recommended starting point**: 50.0

To tune:
```bash
cmem recall "your query" --json
# Check the "distance" values in results
# Adjust threshold based on what you want included
```

### Recency Boost Formula

```
recencyBoost = exp(-ageInDays / recencyHalfLifeDays)
finalRecency = 0.7 + 0.3 × recencyBoost
```

After 30 days (half-life), a memory's recency boost is ~0.85
After 60 days, it's ~0.78
After 180 days, it's ~0.70

---

## capture

Controls automatic memory capture.

```json
"capture": {
  "autoSession": true,
  "autoCommit": true,
  "commitPatterns": ["^(feat|fix|refactor|breaking|perf)"],
  "minImportance": 3
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoSession` | boolean | true | Enable implicit memory detection in prompts |
| `autoCommit` | boolean | true | Capture significant git commits |
| `commitPatterns` | string[] | ["^(feat|fix|...)"] | Regex patterns for commit types to capture |
| `minImportance` | number | 3 | Default importance for auto-captured memories |

### Commit Patterns

Only commits matching these patterns are captured:

- `^feat` - New features
- `^fix` - Bug fixes
- `^refactor` - Code refactoring
- `^breaking` - Breaking changes
- `^perf` - Performance improvements

To capture all commits:
```json
"commitPatterns": [".*"]
```

To capture only features and fixes:
```json
"commitPatterns": ["^(feat|fix)"]
```

---

## sensitive

Patterns for automatic redaction before storage.

```json
"sensitive": {
  "patterns": [
    "sk-[a-zA-Z0-9]{32,}",
    "ghp_[a-zA-Z0-9]{36}",
    "github_pat_[a-zA-Z0-9_]{22,}",
    "xoxb-[a-zA-Z0-9-]+",
    "password\\s*[:=]\\s*\\S+",
    "secret\\s*[:=]\\s*\\S+",
    "api[_-]?key\\s*[:=]\\s*\\S+"
  ]
}
```

Each pattern is a JavaScript regex. Matches are replaced with `[REDACTED]`.

### Adding Custom Patterns

For AWS credentials:
```json
"patterns": [
  ...,
  "AKIA[A-Z0-9]{16}",
  "aws[_-]?secret[_-]?access[_-]?key\\s*[:=]\\s*\\S+"
]
```

For database URLs:
```json
"patterns": [
  ...,
  "(postgres|mysql|mongodb)://[^\\s]+"
]
```

---

## gc

Garbage collection settings.

```json
"gc": {
  "maxAgeUnusedDays": 180,
  "minConfidence": 0.3
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxAgeUnusedDays` | number | 180 | Delete memories unused for this many days |
| `minConfidence` | number | 0.3 | Keep memories above this confidence |

### Garbage Collection Criteria

A memory is deleted if ALL of these are true:
1. Never accessed OR last accessed > maxAgeUnusedDays ago
2. Confidence < minConfidence
3. Access count = 0

**Important**: Manually saved memories (confidence=1.0) are never auto-deleted.

### Manual GC

```bash
# GC current project + global
cmem gc

# GC everything
cmem gc --all
```

---

## project-registry.json

Location: `~/.claude/cmem/project-registry.json`

Maps project names to filesystem paths.

```json
{
  "projects": {
    "my-app": {
      "paths": ["/Users/me/projects/my-app"],
      "description": "My application project",
      "createdAt": 1700000000000
    },
    "monorepo": {
      "paths": [
        "/Users/me/work/monorepo/frontend",
        "/Users/me/work/monorepo/backend"
      ],
      "description": "Company monorepo",
      "createdAt": 1700000000001
    }
  }
}
```

### Multi-Path Projects

A project can have multiple paths (useful for monorepos):

```bash
cmem project:new frontend --path=/work/monorepo/frontend
cmem project:add-path frontend /work/monorepo/shared
```

Both paths will map to the "frontend" project for memory scoping.

### Project Detection

When you run cmem from any directory:
1. Get current working directory
2. For each registered project, check if cwd starts with any project path
3. Return first match, or null for global scope

---

## Environment Variables

Currently, cmem does not use environment variables. All configuration is file-based.

To add environment variable support, modify `memory-manager.ts`:

```typescript
const CONFIG_PATH = process.env.CMEM_CONFIG_PATH ||
  join(homedir(), '.claude', 'cmem', 'config.json');
```
