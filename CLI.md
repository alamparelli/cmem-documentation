# CMEM Command-Line Interface

## Installation

```bash
# Add alias to ~/.zshrc or ~/.bashrc
alias cmem="node ~/.claude/cmem/dist/cli.js"
source ~/.zshrc
```

## Quick Reference

```
cmem help                           # Show all commands
cmem status                         # Check system status
cmem remember <content> [options]   # Save memory
cmem recall <query> [options]       # Search memories
cmem list [n]                       # List recent memories
cmem dump [project]                 # Export ALL project memories
cmem forget <id>                    # Delete memory
cmem obsolete <id>                  # Mark as outdated
cmem project:new <name>             # Register project
cmem ingest <path>                  # Bulk import docs
cmem gc                             # Garbage collect
```

---

## Memory Commands

### remember

Save a new memory.

```bash
cmem remember <content> [options]
```

**Options:**
| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--type` | decision, preference, fact, pattern, conversation | fact | Memory type |
| `--importance` | 1-5 | 3 | Priority level |
| `--reasoning` | string | - | Why (for decisions) |
| `--category` | string | - | Custom category tag |
| `--project` | string | auto-detect | Force project scope |

**Examples:**
```bash
# Simple fact
cmem remember "API rate limit is 100 req/min" --type=fact

# Decision with reasoning
cmem remember "Using Prisma ORM for type-safety" \
  --type=decision \
  --importance=4 \
  --reasoning="Better DX than raw SQL"

# Global preference
cmem remember "Prefer early returns for readability" --type=preference

# Forced project scope
cmem remember "Redis cache TTL is 3600s" --project=backend --type=fact
```

---

### recall

Semantic search in memories.

```bash
cmem recall <query> [options]
```

**Options:**
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--limit` | number | 7 | Max results |
| `--type` | string | - | Filter by type |
| `--json` | flag | - | JSON output |

**Examples:**
```bash
# Basic search
cmem recall "authentication"

# Filter by type
cmem recall "database" --type=decision

# JSON output for scripting
cmem recall "API" --json | jq '.[] | .memory.content'
```

**Output format:**
```
📁 my-project [decision] #42 (score: 0.847)
   Using JWT stored in httpOnly cookies
   💭 Security best practice

🌍 global [preference] #5 (score: 0.623)
   Prefer TypeScript for type safety
```

---

### list

List recent memories.

```bash
cmem list [n] [options]
```

**Arguments:**
- `n`: Number of memories to list (default: 10)

**Options:**
| Flag | Description |
|------|-------------|
| `--project=<name>` | Specific project only |
| `--global` | Global memories only |
| `--all-projects` | All memories across all projects |
| `--json` | JSON output |

**Examples:**
```bash
# List last 10 for current project + global
cmem list

# List last 20
cmem list 20

# Only global memories
cmem list --global

# Specific project
cmem list --project=backend

# All projects
cmem list --all-projects
```

---

### dump

Export ALL memories for a project (no semantic search, no limit).

```bash
cmem dump [project-name] [options]
```

**Arguments:**
- `project-name`: Project to dump (optional, auto-detects from current directory)

**Options:**
| Flag | Description |
|------|-------------|
| `--json` | Output as JSON instead of Markdown |
| `--include-obsolete` | Include obsolete memories |

**Use case:** Full project memory export for backup, review, or handoff. Unlike `recall` which uses semantic search with limits, `dump` retrieves everything.

**Examples:**
```bash
# Dump current project (auto-detect)
cmem dump

# Dump specific project
cmem dump xlens

# JSON output for scripting
cmem dump xlens --json > xlens-memories.json

# Include obsolete memories
cmem dump xlens --include-obsolete
```

**Markdown Output:**
```markdown
# Memory Dump: xlens
Generated: 2024-02-05T14:30:00Z
Total: 42 memories (3 obsolete excluded)

## Decisions (12)

### #45 - Using JWT in httpOnly cookies
- **Importance**: 4/5
- **Reasoning**: Security best practice for XSS protection
- **Created**: 2024-01-15

### #38 - Chose Prisma ORM
...

## Facts (18)

### #52 - API rate limit is 100 req/min
...

## Preferences (8)
...

## Global Memories (4)
...
```

---

### forget

Permanently delete a memory.

```bash
cmem forget <id>
```

**Example:**
```bash
cmem forget 42
# Output: Memory #42 deleted.
```

### forget:category

Delete all memories in a category.

```bash
cmem forget:category <category> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--dry-run` | Preview without deleting |
| `--global` | Global only |
| `--project=<name>` | Specific project |

**Examples:**
```bash
# Preview
cmem forget:category documentation --dry-run
# Would delete 15 memories with category "documentation".

# Actually delete
cmem forget:category documentation
# Deleted 15 memories with category "documentation".
```

### forget:source

Delete by source type.

```bash
cmem forget:source <source> [options]
```

**Sources:** manual, auto:session, auto:commit, auto:ingest, auto:precompact

**Example:**
```bash
# Remove all ingested docs
cmem forget:source auto:ingest --dry-run
cmem forget:source auto:ingest
```

---

### obsolete

Mark a memory as outdated. It's kept but excluded from recall.

```bash
cmem obsolete <id>
```

**Example:**
```bash
cmem obsolete 42
# Output: Memory #42 marked as obsolete.
```

Use case: Old decision that's no longer valid but you want to keep for history.

---

### update

Update memory content (re-embeds the content).

```bash
cmem update <id> <new content>
```

**Example:**
```bash
cmem update 42 "Using JWT in httpOnly cookies with refresh tokens"
# Output: Memory #42 updated.
```

---

## Project Commands

### project:new

Register current directory as a named project.

```bash
cmem project:new <name> [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--path=<path>` | Use different path |
| `--description=<desc>` | Project description |

**Examples:**
```bash
# Register current directory
cd ~/projects/my-app
cmem project:new my-app

# With description
cmem project:new my-app --description="Main application"

# Different path
cmem project:new my-app --path=~/work/my-app
```

---

### project:list

List all registered projects.

```bash
cmem project:list
```

**Output:**
```
Registered projects:

my-app
  Description: Main application
  Paths: /Users/me/projects/my-app

backend
  Description: API backend
  Paths: /Users/me/work/backend, /Users/me/work/backend-v2
```

---

### project:add-path

Add additional path to existing project.

```bash
cmem project:add-path <name> <path>
```

Useful for monorepos or multi-directory projects.

**Example:**
```bash
cmem project:add-path backend /work/monorepo/api
```

---

### project:delete

Remove project from registry (memories are NOT deleted).

```bash
cmem project:delete <name>
```

---

## Ingest Commands

### ingest

Bulk import documentation files as memories.

```bash
cmem ingest <path> [options]
```

**Arguments:**
- `path`: File, directory, or glob pattern

**Options:**
| Flag | Default | Description |
|------|---------|-------------|
| `--category` | documentation | Category tag |
| `--importance` | 2 | Importance level |
| `--dry-run` | - | Preview only |

**Supported formats:** .md, .mdx, .txt, .rst, .adoc

**Examples:**
```bash
# Single file
cmem ingest README.md

# Directory (recursive)
cmem ingest ./docs

# Glob pattern
cmem ingest "src/**/*.md"

# Preview first
cmem ingest ./docs --dry-run

# Custom category and importance
cmem ingest ./api-docs --category=api --importance=4
```

**Output:**
```
📚 Ingesting 12 file(s)...

✅ docs/getting-started.md → 3 section(s)
✅ docs/api/users.md → 5 section(s)
✅ docs/api/auth.md → 4 section(s)
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Files processed: 12
📊 Sections found:  45
📊 Memory chunks:   52
```

---

## Maintenance Commands

### status

Check system health.

```bash
cmem status
```

**Output:**
```
Claude Memory Status

MLX Server: ✅ Ready
Current project: my-app
Registered projects: 3
```

---

### stats

Show memory statistics.

```bash
cmem stats [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--all` | All projects |
| `--global` | Global only |
| `--project=<name>` | Specific project |

**Output:**
```
Project: my-app + Global Statistics:

Total memories: 156
Obsolete: 12
Avg importance: 2.8

By type:
  decision: 34
  fact: 87
  preference: 23
  pattern: 12

By project:
  my-app: 98
  backend: 35
  global: 23
```

---

### gc

Garbage collect old unused memories.

```bash
cmem gc [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--all` | All projects + global |
| `--project=<name>` | Specific project |
| `--consolidate` | Merge near-duplicate memories into clusters |
| `--clean-corrupted` | Remove malformed memories (JSON artifacts, Haiku prompts, tiny content) |
| `--dry-run` | Preview changes without applying |

**Examples:**
```bash
# Standard GC (removes old unused low-confidence memories)
cmem gc
# Output: 5 memories cleaned.

cmem gc --all
# Global: 2 memories cleaned
# my-app: 3 memories cleaned
# Total: 5 memories cleaned

# Preview corrupted memories to remove
cmem gc --clean-corrupted --dry-run
# Would remove 336 corrupted memories:
#   #627: {"items": []}\n\nRéponse à analyser:...
#   ...

# Actually remove them
cmem gc --clean-corrupted
# Removed 336 corrupted memories.

# Preview consolidation (clusters near-duplicates, keeps best-scored)
cmem gc --consolidate --dry-run
# Would consolidate 625 memories in 114 clusters:
#   Keep #1 → merge #664, #670, #2, ...

# Apply consolidation (marks losers as obsolete)
cmem gc --consolidate --all
# Consolidated 625 memories in 114 clusters.
```

### Consolidation Algorithm

1. For each active memory, find neighbors within `dedup.similarityThreshold * 2` distance
2. Group into clusters
3. Score each memory: `importance * confidence * (1 + accessCount)`
4. Keep highest-scored memory per cluster
5. Mark others as obsolete with `supersedes` pointing to the winner

### Corrupted Memory Patterns

`--clean-corrupted` removes memories matching:
- Starts with `{` (JSON object artifacts)
- Starts with `[` followed by non-word char (JSON array artifacts, not `[filepath]` prefixed)
- Contains Haiku prompt leaks ("Sois exhaustif", "Réponds UNIQUEMENT en JSON", "Tu es un assistant")
- Content shorter than 20 characters

---

### log

View hook execution logs.

```bash
cmem log [n] [options]
```

**Arguments:**
- `n`: Number of lines (default: 20)

**Options:**
| Flag | Description |
|------|-------------|
| `--clear` | Clear log file |

**Examples:**
```bash
cmem log           # Last 20 lines
cmem log 50        # Last 50 lines
cmem log --clear   # Clear logs
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid input, not found, etc.) |

---

## JSON Output

Most commands support `--json` for scripting:

```bash
# Get memory IDs matching query
cmem recall "auth" --json | jq '.[].memory.id'

# Export all memories
cmem list 1000 --all-projects --json > backup.json

# Count by type
cmem stats --json | jq '.byType'
```
