# CMEM Workflow Examples

## Workflow 1: New Project Setup

When starting a new project with CMEM:

```bash
# 1. Navigate to project
cd ~/projects/my-new-app

# 2. Register with CMEM
cmem project:new my-new-app --description="E-commerce platform"

# 3. Save initial decisions
cmem remember "Using Next.js 14 with App Router" \
  --type=decision \
  --importance=5 \
  --reasoning="Best DX and performance for React"

cmem remember "PostgreSQL with Prisma ORM" \
  --type=decision \
  --importance=5 \
  --reasoning="Type-safe queries, easy migrations"

cmem remember "Tailwind CSS for styling" \
  --type=decision \
  --importance=4 \
  --reasoning="Faster development, consistent design"
```

## Workflow 2: Documenting API Constraints

When discovering API limitations:

```bash
# Save rate limits
cmem remember "Stripe API rate limit: 100 requests/second" \
  --type=fact \
  --importance=4 \
  --category=api-limits

# Save authentication requirements
cmem remember "Stripe webhook signature must be verified with STRIPE_WEBHOOK_SECRET" \
  --type=fact \
  --importance=5 \
  --category=security

# Save configuration
cmem remember "Stripe test mode prefix: sk_test_, live mode: sk_live_" \
  --type=fact \
  --importance=3 \
  --category=configuration
```

## Workflow 3: Recording Bug Fixes

After fixing a tricky bug:

```bash
cmem remember "iOS Safari requires 'playsinline' attribute for autoplay videos" \
  --type=fact \
  --importance=4 \
  --category=bug-fix

cmem remember "React useEffect cleanup runs on strict mode double-render, must be idempotent" \
  --type=fact \
  --importance=4 \
  --category=bug-fix
```

## Workflow 4: Importing Documentation

When onboarding to an existing project:

```bash
# Preview what would be imported
cmem ingest ./docs --dry-run

# Import with custom category
cmem ingest ./docs/api --category=api-docs --importance=3

# Import single important file
cmem ingest ./ARCHITECTURE.md --importance=5
```

## Workflow 5: Before Making Changes

Before implementing a new feature, recall relevant context:

```bash
# Check existing authentication decisions
cmem recall "authentication security"

# Check database patterns
cmem recall "database schema"

# Check API conventions
cmem recall "API endpoint patterns"
```

## Workflow 6: Updating Outdated Information

When a decision changes:

```bash
# 1. Find the old memory
cmem recall "orm database"
# Output: #42 [decision] Using Prisma ORM...

# 2. Option A: Mark as obsolete and add new
cmem obsolete 42
cmem remember "Migrated from Prisma to Drizzle ORM" \
  --type=decision \
  --importance=4 \
  --reasoning="Better performance, smaller bundle"

# 2. Option B: Use supersedes flag
cmem remember "Using Drizzle ORM instead of Prisma" \
  --type=decision \
  --importance=4 \
  --supersedes=42
```

## Workflow 7: Global Preferences

Set up global preferences that apply to all projects:

```bash
# Coding style
cmem remember "Prefer early returns over nested conditionals" --type=preference
cmem remember "Use TypeScript strict mode in all projects" --type=preference
cmem remember "Prefer named exports over default exports" --type=preference

# Tool preferences
cmem remember "Use pnpm as package manager" --type=preference
cmem remember "Use Prettier with default config" --type=preference
cmem remember "Use ESLint with strict rules" --type=preference
```

## Workflow 8: Session Cleanup

Periodic maintenance:

```bash
# Check memory stats
cmem stats --all

# Run garbage collection
cmem gc --all

# Review recent captures
cmem log 50

# List memories to review
cmem list 20 --all-projects
```

## Workflow 9: Multi-Directory Project

For monorepo or multi-directory setups:

```bash
# Register main project
cd ~/work/monorepo
cmem project:new company-platform --description="Main platform monorepo"

# Add additional paths
cmem project:add-path company-platform ~/work/monorepo/apps/web
cmem project:add-path company-platform ~/work/monorepo/apps/api
cmem project:add-path company-platform ~/work/monorepo/packages/shared

# Verify
cmem project:list
```

## Workflow 10: Cleanup Ingested Docs

After updating documentation:

```bash
# Remove old ingested docs
cmem forget:source auto:ingest --dry-run
cmem forget:source auto:ingest

# Re-ingest updated docs
cmem ingest ./docs --category=documentation
```

## CLI Quick Reference

```bash
# Most common commands
cmem status              # Check system health
cmem recall "query"      # Search memories
cmem remember "text"     # Save memory
cmem list 10             # Recent memories
cmem stats               # Memory statistics
cmem log                 # View hook logs
```

## Integration with Claude Code

In Claude Code sessions, memories are automatically:

1. **Recalled** before each prompt (via UserPromptSubmit hook)
2. **Captured** from git commits (via PostToolUse hook)
3. **Extracted** before context compaction (via PreCompact hook)

You can also use the `/cmem` skill directly:

```
/cmem recall authentication
/cmem remember "Important decision" --type=decision
/cmem stats
```
