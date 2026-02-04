# CMEM Hooks Integration

Claude Code hooks allow cmem to automatically capture and inject memories during sessions.

## Overview

| Hook | Trigger | Purpose |
|------|---------|---------|
| `UserPromptSubmit` | Before each prompt | Inject relevant memories + detect implicit stores |
| `PostToolUse` | After Bash commands | Capture significant git commits |
| `Stop` | After each response | Capture session context |
| `PreCompact` | Before context compaction | Extract session knowledge before it's lost |

## Configuration

> ⚠️ **IMPORTANT**: Add hooks to `~/.claude/settings.json` (NOT `settings.local.json`).
> Claude Code does NOT merge hooks between these files. If `settings.json` has a `hooks` section, the `hooks` in `settings.local.json` are **ignored**.

> ⚠️ **Use absolute paths**: The `~` shorthand may not be expanded correctly in all contexts. Always use full paths like `/Users/yourname/.claude/...`

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/yourname/.claude/cmem/dist/hooks/recall.js",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/yourname/.claude/cmem/dist/hooks/capture-commit.js",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/yourname/.claude/cmem/dist/hooks/capture-response.js",
            "timeout": 20
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/yourname/.claude/cmem/dist/hooks/extract-before-compact.js",
            "timeout": 45
          }
        ]
      }
    ]
  }
}
```

> **Note**: Timeouts are in **seconds** (not milliseconds).

---

## Hook 1: UserPromptSubmit (recall.js)

### Purpose

Runs before every prompt to:
1. **Recall**: Search and inject relevant memories into context
2. **Implicit Store**: Detect phrases like "remember this" and auto-save

### Input (JSON via stdin)

```json
{
  "session_id": "abc123",
  "cwd": "/Users/me/my-project",
  "prompt": "How does authentication work?",
  "transcript_path": "~/.claude/sessions/abc123.jsonl"
}
```

### Output (stdout)

```xml
<memory-context>
Relevant memories from previous sessions:
- [📁 my-project] (Decision) Using JWT stored in httpOnly cookies
  Reason: Security best practice, prevents XSS access
- [🌍 global] (Preference) Prefers TypeScript for type safety
</memory-context>
```

### Implicit Store Patterns

The hook detects phrases indicating the user wants something remembered:

**Preferences:**
- "I prefer..." / "je préfère..."
- "always use..." / "toujours utiliser..."
- "never use..." / "jamais utiliser..."

**Facts:**
- "remember that..." / "souviens-toi que..."
- "note that..." / "note bien que..."
- "FYI..." / "pour info..."

**Decisions:**
- "we decided..." / "on a décidé..."
- "I chose..." / "j'ai choisi..."
- "let's go with..." / "on part sur..."

When detected, the memory is automatically saved with source `auto:session`.

### Task Type Detection

The hook analyzes the prompt to detect task type for better recall:

| Task Type | Keywords |
|-----------|----------|
| debugging | bug, fix, error, crash, fail |
| feature | implement, create, add, build |
| refactoring | refactor, clean, optimize |
| testing | test, spec, coverage |
| deployment | deploy, release, publish |
| understanding | explain, how, what, why |

### Query Enrichment

For better semantic search, the hook:
1. Takes the user prompt as base query
2. Extracts keywords from recent conversation context
3. Combines into enriched query (max 500 chars)

---

## Hook 2: PostToolUse (capture-commit.js)

### Purpose

After git commit commands, captures significant commits as memories.

### Input (JSON via stdin)

```json
{
  "tool_name": "Bash",
  "cwd": "/Users/me/my-project",
  "tool_input": {
    "command": "git commit -m \"feat: add user authentication\"",
    "description": "Commit changes"
  },
  "tool_response": "..."
}
```

### Filtering Logic

1. **Command Check**: Only processes commands containing `git commit`
2. **Pattern Match**: Commit message must match `commitPatterns` from config
3. **MLX Check**: Server must be available

### Captured Data

For each captured commit:

```javascript
{
  content: "feat: add user authentication\n\nChanges: 5 files changed, 200 insertions(+)",
  type: "decision",  // or "fact" for fix commits
  source: "auto:commit",
  importance: config.capture.minImportance,
  confidence: 0.9,
  category: "commit"
}
```

### Type Selection

- `fix` commits → stored as `fact` (what was broken)
- Other commits → stored as `decision` (what was decided)

---

## Hook 3: PreCompact (extract-before-compact.js)

### Purpose

Critical hook that extracts important context BEFORE Claude's context window is compacted. This is the last chance to capture session knowledge.

### When It Runs

Claude Code triggers PreCompact when:
- Context window is getting full
- About to summarize/compact the conversation

### Input (JSON via stdin)

```json
{
  "session_id": "abc123",
  "cwd": "/Users/me/my-project",
  "transcript_path": "~/.claude/sessions/abc123.jsonl",
  "summary": "optional pre-summary"
}
```

### Extraction Process

1. **Get Context**: Read transcript or use provided summary
2. **Check Minimum**: Skip if context < 2000 characters
3. **Extract with Haiku**: Use Claude Haiku for intelligent extraction
4. **Deduplicate**: Check existing memories for duplicates
5. **Store**: Save non-duplicate memories

### Haiku Extraction Prompt

```
Extract IMPORTANT information for future sessions:

1. Architectural decisions (technical choices, patterns, reasons)
2. Bugs discovered and their fixes
3. Codebase structure/patterns
4. User preferences (style, conventions, tools)
5. Business context
6. Configurations (API limits, env vars, etc.)

DO NOT extract:
- Raw source code
- General explanations
- Unanswered questions

Return JSON: {"memories": [{"type": "...", "content": "...", "importance": 1-5}]}
```

### Deduplication

Before storing, each memory is checked against existing memories:
- **Embedding distance < 5**: Exact duplicate, skip
- **Word overlap > 80%**: Too similar, skip

---

## Hook Logging

All hooks log to `~/.claude/cmem/hooks.log`:

```
[2024-01-15T10:30:45.123Z] [recall] [my-project] Task type: feature
[2024-01-15T10:30:45.234Z] [recall] [my-project] Searching: "how does auth work..."
[2024-01-15T10:30:45.456Z] [recall] [my-project] Found 3 memories
[2024-01-15T10:31:12.789Z] [capture-commit] [my-project] Captured commit as decision: "feat: add auth..."
```

View logs:
```bash
cmem log          # Last 20 entries
cmem log 50       # Last 50 entries
cmem log --clear  # Clear log file
```

---

## Performance Considerations

### Timeouts

| Hook | Timeout | Why |
|------|---------|-----|
| recall | 10s | Must be reasonably fast, runs on every prompt |
| capture-commit | 5s | Background, can take slightly longer |
| capture-response | 20s | Processes after response completes |
| extract-before-compact | 45s | Uses Haiku API, can be slow |

> **Note**: Timeouts are in **seconds** in Claude Code settings (not milliseconds).

### Error Handling

All hooks exit gracefully on error:
- Log the error to hooks.log
- `process.exit(0)` to not block Claude Code
- Never throw unhandled exceptions

### MLX Server Availability

Each hook checks `manager.isReady()` before proceeding:
- If MLX server is down, hook exits silently
- No errors shown to user
- Session continues without memory features

---

## Disabling Hooks

### Temporarily

Remove or comment out hooks in `settings.local.json`.

### Per-Project

Currently not supported. Hooks run globally.

### Future: Matcher-Based Filtering

```json
{
  "matcher": {
    "cwd_patterns": ["/work/secret-project"]
  },
  "hooks": []  // Empty = no hooks for this pattern
}
```

---

## Custom Hooks

You can add custom hooks that integrate with cmem:

```javascript
#!/usr/bin/env node
import { MemoryManager } from '../memory-manager.js';

async function myCustomHook() {
  const input = JSON.parse(await readStdin());
  const manager = new MemoryManager();

  // Your custom logic...

  await manager.remember({
    content: "Custom captured data",
    type: "fact",
    source: "auto:custom"
  });
}
```

Add to settings:
```json
"PostToolUse": [
  {
    "matcher": "Read",
    "hooks": [
      {
        "type": "command",
        "command": "node /Users/yourname/.claude/cmem/dist/hooks/my-custom-hook.js"
      }
    ]
  }
]
```

---

## Troubleshooting

### Hooks not triggering

**Symptom**: Hooks don't run even though configured.

**Cause**: Hooks in `settings.local.json` are ignored if `settings.json` has a `hooks` section.

**Solution**: Put ALL hooks in `settings.json`, not `settings.local.json`.

**Diagnosis**:
```bash
# Check if hook logs anything
tail -f ~/.claude/cmem/hooks.log

# Test hook manually
echo '{"prompt":"test","cwd":"/your/project"}' | node ~/.claude/cmem/dist/hooks/recall.js
```

### Hooks start but don't complete

**Symptom**: `[STARTUP] Hook script started` in logs but no further output.

**Possible causes**:
1. **Timeout too short** - Increase timeout in settings
2. **MLX server not running** - Start with `~/.claude/cmem/start.sh`
3. **Path issues** - Use absolute paths, not `~`

### Changes not taking effect

**Symptom**: Modified hooks don't run differently.

**Cause**: Claude Code loads hooks at session start.

**Solution**: Restart Claude Code (new session) after modifying hooks.
