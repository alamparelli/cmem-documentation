# CMEM - Claude Memory System

A persistent vector memory system for Claude Code, enabling LLM agents to remember decisions, facts, preferences, and patterns across sessions.

## Overview

CMEM (Claude Memory) provides semantic memory capabilities for Claude Code sessions:

- **Persistent storage**: Memories survive across sessions via SQLite + vector embeddings
- **Semantic search**: Find relevant memories by meaning, not just keywords
- **Multi-scope storage**: Global preferences + per-project knowledge
- **Automatic capture**: Session context automatically memorized
- **Deduplication**: Near-duplicate detection prevents memory bloat
- **Privacy-aware**: Sensitive data (API keys, passwords) automatically redacted

## Documentation Structure

```
cmem-documentation/
├── README.md                    # This file
├── ARCHITECTURE.md              # System architecture and components
├── INSTALLATION.md              # Step-by-step setup guide
├── CONFIGURATION.md             # Config file reference
├── HOOKS.md                     # Claude Code hooks integration
├── CLI.md                       # Command-line interface reference
├── API.md                       # TypeScript API reference
├── PHILOSOPHY.md                # Design philosophy and decisions
├── EMBEDDING-SERVER.md          # MLX embedding server setup
├── templates/                   # Template files for setup
│   ├── config.json.template
│   ├── package.json.template
│   └── plist.template
└── examples/                    # Usage examples
    └── workflows.md
```

## Quick Start

See [INSTALLATION.md](./INSTALLATION.md) for complete setup.

1. Install prerequisites (Node.js 18+, Python 3.9+, Apple Silicon for MLX)
2. Create directory structure at `~/.claude/cmem/`
3. Setup MLX embedding server
4. Configure Claude Code hooks
5. Register your first project

## Core Concepts

### Memory Types

| Type | Scope | Description |
|------|-------|-------------|
| `preference` | Global | User coding style, tools, habits |
| `decision` | Project | Technical choices with reasoning |
| `fact` | Project | API limits, configs, constraints |
| `pattern` | Global | Detected behavioral patterns |
| `conversation` | Project | Session summaries |

### Memory Sources

| Source | Description |
|--------|-------------|
| `manual` | User explicitly saved |
| `auto:session` | Implicit detection from prompt |
| `auto:commit` | Captured from git commits (disabled by default) |
| `auto:precompact` | Extracted before context compaction |
| `auto:ingest` | Bulk imported from documentation |

### How It Works

```
User Prompt → Embed Query → Search Memories → Inject Context → Claude Responds
                                  ↓
                          Score by:
                          - Semantic similarity
                          - Recency
                          - Importance
                          - Usage frequency
```

## Version

This documentation reflects CMEM v3.1 with:
- Unified SQLite database (single `memories.db`)
- MLX-based embeddings (Apple Silicon native)
- Project detection via registry
- Claude Code hooks integration
- Deduplication on `remember()` (embedding-based near-duplicate detection)
- Garbage collection with `--consolidate` and `--clean-corrupted`
- Haiku intent analysis disabled at prompt (passthrough mode for performance)

## License

MIT
