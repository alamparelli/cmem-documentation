---
name: cmem
description: "Persistent vector memory for Claude Code. Store decisions, facts, preferences across sessions. Ingest documentation. Triggers: '/cmem', 'remember this', 'recall', 'what did we decide', 'ingest docs', 'store memory', 'project memory'. PROACTIVE: Before architectural decisions, recall relevant memories."
user_invocable: true
---

# cmem - Claude Memory Skill

Persistent vector memory management for Claude Code.

## Usage

**Syntax**: `/cmem <command> [args] [options]`

When user invokes `/cmem`, parse the ARGUMENTS to determine the command:
- If args start with a known command → execute it via CLI
- If no args or just `/cmem` → show status

## Proactive Usage

**IMPORTANT**: Before implementing features or making architectural decisions on projects with cmem memories, automatically run:
```bash
node ~/.claude/cmem/dist/cli.js recall "<relevant keywords>"
```
to check for existing decisions, patterns, or constraints that should inform your approach.

Examples of when to proactively recall:
- Before choosing a library/framework → `cmem recall "library framework choice"`
- Before implementing auth → `cmem recall "authentication security"`
- Before database schema changes → `cmem recall "database schema migration"`
- Before refactoring → `cmem recall "architecture patterns"`

## Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `status` | Check Ollama & system status | `/cmem status` |
| `stats` | Memory statistics | `/cmem stats` |
| `list [n]` | List n recent memories (default: 10) | `/cmem list 5` |
| `dump [project]` | Dump ALL memories for a project (no search) | `/cmem dump xlens` |
| `recall <query>` | Semantic search in memories | `/cmem recall authentication` |
| `remember <content>` | Save a new memory | `/cmem remember "Using JWT for auth"` |
| `forget <id>` | Delete a memory permanently | `/cmem forget 42` |
| `forget:category <cat>` | Delete all memories in category | `/cmem forget:category documentation` |
| `forget:source <src>` | Delete by source type | `/cmem forget:source auto:ingest` |
| `obsolete <id>` | Mark as outdated (excluded from recall) | `/cmem obsolete 12` |
| `update <id> <content>` | Update memory content | `/cmem update 5 "Updated info"` |
| `project:new <name>` | Register current directory as project | `/cmem project:new xlens` |
| `project:list` | List all registered projects | `/cmem project:list` |
| `project:add-path <name> <path>` | Add path to existing project | `/cmem project:add-path xlens ./ext` |
| `project:delete <name>` | Remove project from registry | `/cmem project:delete old-project` |
| `gc` | Clean up old unused memories | `/cmem gc` |
| `ingest <path>` | Parse and store documentation | `/cmem ingest ./docs` |
| `log [n]` | Show last n hook logs (default: 20) | `/cmem log 50` |
| `log --clear` | Clear the log file | `/cmem log --clear` |

## Options for `dump`

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON instead of Markdown |
| `--include-obsolete` | Include obsolete memories |

**Usage**: `cmem dump [project-name]`
- If no project specified, uses current directory detection
- Outputs all memories grouped by type (decisions, facts, etc.)
- Includes project + global memories

## Options for `ingest`

| Option | Description |
|--------|-------------|
| `--category=<tag>` | Category tag (default: documentation) |
| `--importance=<1-5>` | Priority level (default: 2) |
| `--dry-run` | Preview what would be ingested |

**Accepts**: file, directory (recursive), or glob pattern
**Supported formats**: .md, .mdx, .txt, .rst, .adoc

## Options for `remember`

| Option | Description |
|--------|-------------|
| `--type=<type>` | decision, preference, fact, pattern, conversation |
| `--importance=<1-5>` | Priority level (default: 3) |
| `--reasoning=<why>` | Explanation for decisions |
| `--category=<tag>` | Category tag |
| `--project=<name>` | Force project (auto-detected by default) |

## Memory Types

| Type | Scope | Examples |
|------|-------|----------|
| `preference` | Global | "Prefers TypeScript", "Uses pnpm" |
| `decision` | Project | "Chose Prisma for ORM because..." |
| `fact` | Project | "API rate limit is 100/min" |
| `pattern` | Global | "Always uses early returns" |
| `conversation` | Project | Session summaries |

## Execution

When this skill is invoked, execute the CLI command:
```bash
node ~/.claude/cmem/dist/cli.js <command> <args> <options>
```

## Examples

```bash
# Check system status
/cmem status

# Save a decision with reasoning
/cmem remember "Using Prisma ORM for type-safety" --type=decision --importance=4 --reasoning="Better DX than raw SQL"

# Save a preference (goes to global)
/cmem remember "Prefer early returns for readability" --type=preference

# Search memories
/cmem recall "database orm"

# List recent project memories
/cmem list 5

# Dump ALL memories for a project (no semantic search)
/cmem dump xlens              # Specific project → Markdown
/cmem dump                    # Current project (auto-detect)
/cmem dump xlens --json       # JSON output

# Mark old info as outdated
/cmem obsolete 42

# Register current project
/cmem project:new my-app

# Ingest documentation
/cmem ingest ./docs --category=project-docs
/cmem ingest README.md --importance=4
/cmem ingest ./docs --dry-run  # Preview first
```
