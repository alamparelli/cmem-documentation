# CMEM Design Philosophy

## The Problem

LLM coding assistants like Claude Code are stateless. Each session starts fresh without knowledge of:
- Previous decisions and their reasoning
- Project-specific conventions
- User preferences and coding style
- Bug fixes and lessons learned

This leads to:
- Repeated questions about the same topics
- Inconsistent suggestions across sessions
- Lost context when sessions end
- No learning from past interactions

## The Solution

CMEM provides **persistent semantic memory** that:
- Survives across sessions
- Is searchable by meaning (not just keywords)
- Automatically captures important context
- Injects relevant memories into new sessions

## Design Principles

### 1. Local-First, Privacy-Respecting

**Principle:** All data stays on your machine.

- SQLite database stored in `~/.claude/cmem/`
- Embeddings generated locally via MLX (no cloud API)
- Sensitive data auto-redacted before storage
- No telemetry or external connections

**Why:** Developer workflows contain sensitive information (API keys, proprietary code, client names). A local-first approach ensures privacy by default.

### 2. Semantic Over Keyword Search

**Principle:** Find memories by meaning, not exact words.

Traditional approach:
```
Search: "authentication"
Finds: "authentication flow", "auth module"
Misses: "JWT tokens", "login process", "user session"
```

CMEM approach:
```
Search: "authentication"
Finds: "JWT tokens", "login process", "user session", "auth module"
(because embeddings capture semantic similarity)
```

**Why:** Users think in concepts, not keywords. A search for "how does auth work" should find decisions about "JWT in httpOnly cookies" even though no words match.

### 3. Multi-Scope Memory

**Principle:** Some knowledge is global, some is project-specific.

| Scope | Examples |
|-------|----------|
| Global | Coding style, preferred tools, language preferences |
| Project | API decisions, schema designs, architecture choices |

**Why:** Your preference for TypeScript applies everywhere. Your decision to use Redis applies only to one project.

### 4. Automatic Capture

**Principle:** Important knowledge should be captured without manual intervention.

Capture points:
- **Commits**: Technical decisions are often documented in commits
- **Implicit phrases**: "Remember that...", "We decided..."
- **Pre-compaction**: Last chance before context is lost

**Why:** Manual memory management is tedious. Users forget to save important context. Automation ensures knowledge is preserved.

### 5. Relevance Scoring

**Principle:** Not all memories are equally relevant. Score by multiple factors.

```
score = similarity × recency × importance × usage × confidence
```

Factors:
- **Similarity**: Semantic closeness to query
- **Recency**: Recent memories may be more relevant
- **Importance**: User-assigned priority (1-5)
- **Usage**: Frequently retrieved = likely important
- **Confidence**: How reliably was this captured?

**Why:** A highly similar but ancient memory may be less useful than a somewhat similar recent one. Multi-factor scoring captures nuance.

### 6. Non-Blocking Integration

**Principle:** Memory operations should never slow down the user.

Implementation:
- Recall timeout: 3 seconds (fail silently if exceeded)
- Commit capture: runs asynchronously
- Errors logged, never thrown to user

**Why:** Memory is an enhancement, not a requirement. A slow or failing memory system shouldn't block coding work.

### 7. Transparent Operation

**Principle:** Users should understand what's being remembered and recalled.

Features:
- `<memory-context>` tags clearly show injected memories
- `cmem log` shows hook execution history
- `cmem list` shows all stored memories
- Visual indicator (🧠) when memories are captured

**Why:** Black-box AI behavior is frustrating. Users should be able to audit and correct the memory system.

## Architecture Decisions

### Why SQLite + sqlite-vec?

Alternatives considered:
- **Pinecone/Weaviate**: Cloud services, privacy concerns
- **Chroma/LanceDB**: Good but heavier dependencies
- **JSON files**: No vector search capability

SQLite + sqlite-vec provides:
- Single-file database (easy backup/restore)
- Native vector search (L2 distance)
- Minimal dependencies
- Battle-tested reliability

### Why MLX for Embeddings?

Alternatives considered:
- **OpenAI API**: Cloud dependency, cost, latency
- **Ollama**: Good but heavier resource usage
- **Sentence Transformers**: Slower on Apple Silicon

MLX provides:
- Native Apple Silicon optimization
- Small model footprint (~100MB)
- Fast inference (~10-50ms)
- No internet required

### Why Unified Database?

Evolution:
- v1: Separate DB per project (`global.db`, `project-a.db`)
- v3: Unified DB with `project` column (`memories.db`)

Benefits of unified:
- Simpler backup (one file)
- Easier cross-project queries
- Better global stats
- Reduced file system complexity

### Why Hooks Instead of API?

Alternatives considered:
- **Always-on process**: Resource intensive
- **MCP server**: More complex integration
- **API calls in Claude Code**: Requires Claude Code changes

Hooks provide:
- Native Claude Code integration
- Event-driven (runs only when needed)
- Simple shell command interface
- No long-running processes

## Trade-offs Accepted

### Memory Quality vs. Quantity

We favor **more memories with lower confidence** over **fewer perfect memories**.

Rationale:
- Auto-capture may produce some noise
- Relevance scoring filters out low-quality results
- Garbage collection removes unused memories
- Better to have something than nothing

### Recall Speed vs. Comprehensiveness

We favor **fast, limited results** over **slow, exhaustive search**.

Settings:
- Max 5 project + 2 global results
- 3 second timeout for recall hook

Rationale:
- Recall runs on every prompt
- Users don't need 50 memories per query
- Speed is critical for UX

### Simplicity vs. Features

We favor **fewer, well-implemented features** over **many half-baked ones**.

Not implemented (by design):
- Memory sharing between machines
- Collaborative memories
- Complex tagging hierarchies
- Memory visualization UI

Rationale:
- Keep the system understandable
- Reduce maintenance burden
- Core use case is well-served

## Future Directions

### Potential Enhancements

1. **Memory importance decay**: Unused memories gradually lose importance
2. **Cross-project learning**: Patterns detected across multiple projects
3. **Memory suggestions**: "You might want to remember this decision"
4. **Conflict detection**: "This contradicts memory #42"

### What We Won't Build

1. **Cloud sync**: Violates local-first principle
2. **Team memories**: Different scope, different product
3. **Complex permissions**: Over-engineering for single-user system
4. **GUI application**: CLI serves the target user well

## Conclusion

CMEM is designed to be a **simple, reliable, local-first** memory system for individual developers using Claude Code. It prioritizes privacy, speed, and transparency over advanced features. The goal is to make Claude Code sessions feel continuous, where knowledge compounds across sessions rather than starting fresh each time.
