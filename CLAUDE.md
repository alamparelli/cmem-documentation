# CMEM Documentation Project

This repository contains the complete documentation for CMEM (Claude Memory System).

## Purpose

Document the cmem system so it can be reproduced in other Claude Code environments.

## Maintenance

**IMPORTANT**: Keep this documentation synchronized with the actual cmem implementation at `~/.claude/cmem/`.

When making changes to the cmem system:
1. Update the corresponding documentation file(s)
2. Commit with a clear message describing the changes
3. Push to GitHub

## Documentation Structure

| File | Content |
|------|---------|
| README.md | Overview and quick start |
| ARCHITECTURE.md | System components and data flow |
| INSTALLATION.md | Step-by-step setup guide |
| CONFIGURATION.md | config.json reference |
| HOOKS.md | Claude Code hooks integration |
| CLI.md | Command-line interface reference |
| API.md | TypeScript API documentation |
| PHILOSOPHY.md | Design decisions and rationale |
| EMBEDDING-SERVER.md | MLX server setup |

## Templates

The `templates/` directory contains ready-to-use configuration files for setting up a new cmem instance.

## Target Audience

This documentation is written to be:
- **LLM-friendly**: Structured, clear, unambiguous
- **Self-contained**: No external dependencies for understanding
- **Reproducible**: Complete enough to rebuild the system from scratch
