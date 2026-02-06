# CMEM Reference Implementation

This directory contains the complete TypeScript source code for cmem v3.

## Structure

```
reference-implementation/
├── src/
│   ├── memory-manager.ts    # Core memory operations
│   ├── cli.ts               # Command-line interface
│   ├── mlx-embedder.ts      # MLX server client
│   ├── chunker.ts           # Text chunking logic
│   ├── project-registry.ts  # Project path detection
│   ├── types.ts             # TypeScript types
│   └── hooks/
│       ├── recall.ts               # UserPromptSubmit hook
│       ├── capture-commit.ts       # PostToolUse hook (git)
│       ├── capture-response.ts     # Stop hook
│       └── extract-before-compact.ts # PreCompact hook
├── package.json
├── tsconfig.json
└── SKILL.md                 # Claude Code skill definition
```

## Usage

To use this implementation:

1. Copy to `~/.claude/cmem/`
2. Run `npm install`
3. Run `npm run build`
4. Configure hooks in `~/.claude/settings.json`

See the main documentation files for detailed setup instructions.

## Last Synced

This code was synced from the working implementation on: 2026-02-06 21:36:03
