#!/usr/bin/env node

import { MemoryManager } from './memory-manager.js';
import { MemoryType } from './types.js';

const HELP = `
🧠 claude-memory - Persistent vector memory for Claude Code

USAGE:
  cmem <command> [options]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  remember <content>       Save a new memory
    --type=<type>          decision | preference | fact | pattern | conversation
    --importance=<1-5>     Priority level (default: 3)
    --reasoning=<why>      Explanation for decisions
    --category=<tag>       Category tag
    --project=<name>       Force project (auto-detected by default)

  recall <query>           Semantic search in memories
    --limit=<n>            Max results (default: 7)
    --type=<type>          Filter by type
    --json                 Output as JSON

  list [n]                 List n recent memories (default: 10)
    --project=<name>       Specific project only
    --global               Global memories only
    --all-projects         List all memories across all projects
    --json                 Output as JSON

  dump [project]           Dump ALL memories for a project (no semantic search)
    --json                 Output as JSON instead of Markdown
    --include-obsolete     Include obsolete memories

  forget <id>              Permanently delete a memory
  forget:category <cat>    Delete all memories in a category
  forget:source <source>   Delete by source (auto:ingest, auto:commit, etc.)
  obsolete <id>            Mark as outdated (excluded from recall)
  update <id> <content>    Update memory content

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  project:new <name>       Register current directory as project
    --path=<path>          Use different path
    --description=<desc>   Project description

  project:list             List all registered projects
  project:add-path <name> <path>   Add additional path to project
  project:delete <name>    Remove project from registry

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INGEST COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ingest <path>            Parse and store documentation files
    --category=<tag>       Category tag (default: documentation)
    --importance=<1-5>     Priority level (default: 2)
    --dry-run              Preview what would be ingested

  Accepts: file, directory (recursive), or glob pattern
  Supported: .md, .mdx, .txt, .rst, .adoc

  Examples:
    cmem ingest README.md                    # Single file
    cmem ingest ./docs                       # Directory (recursive)
    cmem ingest ./docs --dry-run             # Preview only
    cmem ingest "src/**/*.md" --category=api # Glob with category

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MAINTENANCE COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  status                   Check MLX server & system status
  stats                    Memory statistics
  gc                       Clean old unused memories
    --all                  All projects + global
    --consolidate          Merge near-duplicate memories
    --clean-corrupted      Remove corrupted/malformed memories
    --dry-run              Preview without changes
  log [n]                  Show last n hook logs (default: 20)
    --clear                Clear the log file

  help                     Show this help

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  # Register current project
  cmem project:new my-app

  # Save a decision with reasoning
  cmem remember "Using Prisma ORM for type-safety" --type=decision --importance=4 --reasoning="Better DX than raw SQL"

  # Save a preference (goes to global)
  cmem remember "Prefer early returns for readability" --type=preference

  # Search memories
  cmem recall "database orm"

  # List recent project memories
  cmem list 5

  # Mark old info as outdated
  cmem obsolete 42

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY TYPES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  preference   → Global (coding style, tools, habits)
  decision     → Project (technical choices + why)
  fact         → Project (API limits, configs, etc.)
  pattern      → Global (detected behavioral patterns)
  conversation → Project (session summaries)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALIAS: Add to ~/.zshrc
  alias cmem="node ~/.claude/cmem/dist/cli.js"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];
  const manager = new MemoryManager();

  // Parse flags
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value ?? true;
    } else {
      positional.push(arg);
    }
  }

  try {
    switch (command) {
      case 'remember': {
        const content = positional.join(' ');
        if (!content) {
          console.error('Error: Content required');
          process.exit(1);
        }

        const ids = await manager.remember({
          content,
          type: (flags.type as MemoryType) || 'fact',
          importance: flags.importance ? parseInt(flags.importance as string) : 3,
          category: flags.category as string,
          reasoning: flags.reasoning as string,
          project: flags.project as string,
          source: 'manual'
        });

        console.log(`Stored ${ids.length} memory chunk(s): ${ids.join(', ')}`);
        break;
      }

      case 'recall': {
        const query = positional.join(' ');
        if (!query) {
          console.error('Error: Query required');
          process.exit(1);
        }

        const results = await manager.recall(query, {
          limit: flags.limit ? parseInt(flags.limit as string) : undefined,
          type: flags.type as MemoryType
        });

        if (flags.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          if (results.length === 0) {
            console.log('No memories found.');
          } else {
            for (const r of results) {
              const projectLabel = r.source ? `📁 ${r.source}` : '🌍 global';
              console.log(`\n${projectLabel} [${r.memory.type}] #${r.memory.id} (score: ${r.score.toFixed(3)})`);
              console.log(`   ${r.memory.content}`);
              if (r.memory.reasoning) {
                console.log(`   💭 ${r.memory.reasoning}`);
              }
            }
          }
        }
        break;
      }

      case 'list': {
        const limit = positional[0] ? parseInt(positional[0]) : 10;
        const allProjects = flags['all-projects'] === true;
        const project = flags.global ? null : (flags.project as string) ?? undefined;

        const memories = await manager.listRecent(limit, project, allProjects);

        if (flags.json) {
          console.log(JSON.stringify(memories, null, 2));
        } else {
          let scope: string;
          if (allProjects) {
            scope = 'All projects';
          } else if (flags.global) {
            scope = 'Global';
          } else if (flags.project) {
            scope = `Project: ${flags.project}`;
          } else {
            const detected = manager.detectProject();
            scope = detected ? `Project: ${detected} + Global` : 'Global';
          }

          console.log(`\n${scope} - Recent memories:\n`);

          for (const m of memories) {
            const date = new Date(m.createdAt * 1000).toLocaleDateString();
            const projectLabel = m.project ? `[${m.project}]` : '[global]';
            console.log(`#${m.id} ${projectLabel} [${m.type}] ${date} (imp: ${m.importance})`);
            console.log(`   ${m.content}`);
            if (m.reasoning) {
              console.log(`   💭 ${m.reasoning}`);
            }
            console.log();
          }
        }
        break;
      }

      case 'dump': {
        // Get project name from positional arg or detect from cwd
        const projectArg = positional[0];
        const project = projectArg || manager.detectProject();

        if (!project) {
          console.error('Error: No project specified and none detected from current directory.');
          console.error('Usage: cmem dump <project-name>');
          console.error('   or: cd into a registered project directory');
          process.exit(1);
        }

        const includeObsolete = flags['include-obsolete'] === true;

        // Get ALL memories for this project (use very large limit)
        const memories = await manager.listRecent(100000, project, false);

        // Also get global memories if not filtering to project-only
        const globalMemories = await manager.listRecent(100000, null, false);

        // Combine: project memories + global memories
        const allMemories = [...memories, ...globalMemories];

        // Filter obsolete if needed
        const filtered = includeObsolete
          ? allMemories
          : allMemories.filter(m => !m.isObsolete);

        if (flags.json) {
          console.log(JSON.stringify(filtered, null, 2));
        } else {
          // Group by type
          const byType: Record<string, typeof filtered> = {};
          for (const m of filtered) {
            const type = m.type || 'unknown';
            if (!byType[type]) byType[type] = [];
            byType[type].push(m);
          }

          // Output Markdown
          console.log(`# 📚 ${project} - Memory Dump\n`);
          console.log(`> Generated: ${new Date().toISOString()}`);
          console.log(`> Total: ${filtered.length} memories\n`);

          // Stats summary
          console.log(`## Statistics\n`);
          console.log(`| Type | Count |`);
          console.log(`|------|-------|`);
          for (const [type, mems] of Object.entries(byType)) {
            console.log(`| ${type} | ${mems.length} |`);
          }
          console.log();

          // Order: decisions first, then facts, then others
          const typeOrder = ['decision', 'preference', 'fact', 'pattern', 'conversation'];
          const sortedTypes = Object.keys(byType).sort((a, b) => {
            const aIdx = typeOrder.indexOf(a);
            const bIdx = typeOrder.indexOf(b);
            if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
            if (aIdx === -1) return 1;
            if (bIdx === -1) return -1;
            return aIdx - bIdx;
          });

          for (const type of sortedTypes) {
            const mems = byType[type];
            const emoji = type === 'decision' ? '🎯' :
                          type === 'preference' ? '⚙️' :
                          type === 'fact' ? '📋' :
                          type === 'pattern' ? '🔄' : '💬';

            console.log(`## ${emoji} ${type.charAt(0).toUpperCase() + type.slice(1)}s (${mems.length})\n`);

            for (const m of mems) {
              const date = new Date(m.createdAt * 1000).toISOString().split('T')[0];
              const projectLabel = m.project ? `📁 ${m.project}` : '🌍 global';
              const importance = '⭐'.repeat(m.importance || 3);

              // Truncate content for title
              const titleContent = m.content.replace(/\n/g, ' ').slice(0, 80);
              const hasMore = m.content.length > 80;

              console.log(`### #${m.id} ${titleContent}${hasMore ? '...' : ''}\n`);
              console.log(`- **Scope**: ${projectLabel}`);
              console.log(`- **Date**: ${date}`);
              console.log(`- **Importance**: ${importance} (${m.importance || 3}/5)`);
              if (m.category) console.log(`- **Category**: ${m.category}`);
              if (m.source && m.source !== 'manual') console.log(`- **Source**: ${m.source}`);
              console.log();
              console.log(m.content);
              if (m.reasoning) {
                console.log(`\n> 💭 **Reasoning**: ${m.reasoning}`);
              }
              console.log(`\n---\n`);
            }
          }
        }
        break;
      }

      case 'forget': {
        const id = parseInt(positional[0]);
        if (!id) {
          console.error('Error: Memory ID required');
          process.exit(1);
        }

        const project = flags.project as string ?? manager.detectProject();
        await manager.forget(id, project);
        console.log(`Memory #${id} deleted.`);
        break;
      }

      case 'forget:category': {
        const category = positional[0];
        if (!category) {
          console.error('Error: Category required');
          console.error('Usage: cmem forget:category <category-name>');
          process.exit(1);
        }

        const project = flags.global ? null : (flags.project as string) ?? manager.detectProject();
        const dryRun = flags['dry-run'] === true;

        const count = await manager.forgetByCategory(category, project, dryRun);

        if (dryRun) {
          console.log(`Would delete ${count} memories with category "${category}".`);
          console.log('Remove --dry-run to actually delete.');
        } else {
          console.log(`Deleted ${count} memories with category "${category}".`);
        }
        break;
      }

      case 'forget:source': {
        const source = positional[0];
        if (!source) {
          console.error('Error: Source required');
          console.error('Usage: cmem forget:source <source-name>');
          console.error('Sources: manual, auto:session, auto:commit, auto:pattern, auto:bootstrap, auto:ingest');
          process.exit(1);
        }

        const project = flags.global ? null : (flags.project as string) ?? manager.detectProject();
        const dryRun = flags['dry-run'] === true;

        const count = await manager.forgetBySource(source, project, dryRun);

        if (dryRun) {
          console.log(`Would delete ${count} memories with source "${source}".`);
          console.log('Remove --dry-run to actually delete.');
        } else {
          console.log(`Deleted ${count} memories with source "${source}".`);
        }
        break;
      }

      case 'obsolete': {
        const id = parseInt(positional[0]);
        if (!id) {
          console.error('Error: Memory ID required');
          process.exit(1);
        }

        const project = flags.project as string ?? manager.detectProject();
        await manager.markObsolete(id, project);
        console.log(`Memory #${id} marked as obsolete.`);
        break;
      }

      case 'update': {
        const id = parseInt(positional[0]);
        const content = positional.slice(1).join(' ');
        if (!id || !content) {
          console.error('Error: Memory ID and content required');
          process.exit(1);
        }

        const project = flags.project as string ?? manager.detectProject();
        await manager.update(id, content, project);
        console.log(`Memory #${id} updated.`);
        break;
      }

      case 'gc': {
        const dryRun = flags['dry-run'] === true;

        if (flags['clean-corrupted']) {
          const result = await manager.cleanupCorrupted(dryRun);
          if (dryRun) {
            console.log(`Would remove ${result.count} corrupted memories:`);
            for (const s of result.samples) console.log(`  ${s}`);
            if (result.count > result.samples.length) console.log(`  ... and ${result.count - result.samples.length} more`);
          } else {
            console.log(`Removed ${result.count} corrupted memories.`);
          }
          break;
        }

        if (flags.consolidate) {
          const project = flags.project as string ?? (flags.all ? undefined : manager.detectProject());
          const result = await manager.consolidate(project, dryRun);
          if (dryRun) {
            console.log(`Would consolidate ${result.consolidated} memories in ${result.clusters.length} clusters:`);
            for (const c of result.clusters) {
              console.log(`  Keep #${c.kept} → merge #${c.merged.join(', #')}`);
            }
          } else {
            console.log(`Consolidated ${result.consolidated} memories in ${result.clusters.length} clusters.`);
          }
          break;
        }

        if (flags.all) {
          // GC all projects + global
          const registry = manager.getProjectRegistry();
          let total = 0;

          // Global
          const globalDeleted = await manager.garbageCollect(null);
          total += globalDeleted;
          console.log(`Global: ${globalDeleted} memories cleaned`);

          // Each project
          for (const { name } of registry.listProjects()) {
            const deleted = await manager.garbageCollect(name);
            total += deleted;
            console.log(`${name}: ${deleted} memories cleaned`);
          }

          console.log(`\nTotal: ${total} memories cleaned`);
        } else {
          const project = flags.project as string ?? manager.detectProject();
          const deleted = await manager.garbageCollect(project);
          console.log(`${deleted} memories cleaned.`);
        }
        break;
      }

      case 'stats': {
        const allProjects = flags['all'] === true || flags['all-projects'] === true;
        const project = flags.global ? null : (flags.project as string) ?? undefined;
        const stats = await manager.getStats(project, allProjects);

        let scope: string;
        if (allProjects) {
          scope = 'All Projects';
        } else if (flags.global) {
          scope = 'Global';
        } else if (flags.project) {
          scope = `Project: ${flags.project}`;
        } else {
          const detected = manager.detectProject();
          scope = detected ? `Project: ${detected} + Global` : 'Global';
        }

        console.log(`\n${scope} Statistics:\n`);
        console.log(`Total memories: ${stats.total}`);
        console.log(`Obsolete: ${stats.obsolete}`);
        console.log(`Avg importance: ${stats.avgImportance.toFixed(1)}`);

        console.log(`\nBy type:`);
        for (const [type, count] of Object.entries(stats.byType)) {
          console.log(`  ${type}: ${count}`);
        }

        if (stats.byProject && Object.keys(stats.byProject).length > 0) {
          console.log(`\nBy project:`);
          for (const [proj, count] of Object.entries(stats.byProject)) {
            console.log(`  ${proj}: ${count}`);
          }
        }
        break;
      }

      case 'project:new': {
        const name = positional[0];
        if (!name) {
          console.error('Error: Project name required');
          process.exit(1);
        }

        const registry = manager.getProjectRegistry();
        registry.createProject(
          name,
          flags.path as string,
          flags.description as string
        );
        console.log(`Project '${name}' created.`);
        break;
      }

      case 'project:list': {
        const registry = manager.getProjectRegistry();
        const projects = registry.listProjects();

        if (projects.length === 0) {
          console.log('No projects registered.');
          console.log('Use: claude-memory project:new <name>');
        } else {
          console.log('\nRegistered projects:\n');
          for (const { name, info } of projects) {
            console.log(`${name}`);
            console.log(`  Description: ${info.description}`);
            console.log(`  Paths: ${info.paths.join(', ')}`);
            console.log();
          }
        }
        break;
      }

      case 'project:add-path': {
        const [name, path] = positional;
        if (!name || !path) {
          console.error('Error: Project name and path required');
          process.exit(1);
        }

        const registry = manager.getProjectRegistry();
        registry.addPath(name, path);
        console.log(`Path added to '${name}'.`);
        break;
      }

      case 'project:delete': {
        const name = positional[0];
        if (!name) {
          console.error('Error: Project name required');
          process.exit(1);
        }

        const registry = manager.getProjectRegistry();
        registry.deleteProject(name);
        console.log(`Project '${name}' deleted from registry.`);
        break;
      }

      case 'status': {
        console.log('\nClaude Memory Status\n');

        const mlxReady = await manager.isReady();
        console.log(`MLX Server: ${mlxReady ? '✅ Ready' : '❌ Not available (run: ~/.claude/cmem/mlx-server/start.sh)'}`);

        const project = manager.detectProject();
        console.log(`Current project: ${project || '(none detected)'}`);

        const registry = manager.getProjectRegistry();
        console.log(`Registered projects: ${registry.listProjects().length}`);
        break;
      }

      case 'log': {
        const { readFileSync, writeFileSync, existsSync } = await import('fs');
        const { homedir } = await import('os');
        const { join } = await import('path');

        const logPath = join(homedir(), '.claude', 'cmem', 'hooks.log');

        if (flags.clear) {
          if (existsSync(logPath)) {
            writeFileSync(logPath, '');
            console.log('Log file cleared.');
          } else {
            console.log('No log file to clear.');
          }
          break;
        }

        if (!existsSync(logPath)) {
          console.log('No hook logs yet.');
          break;
        }

        const content = readFileSync(logPath, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l);
        const limit = positional[0] ? parseInt(positional[0]) : 20;
        const recent = lines.slice(-limit);

        console.log(`\n🧠 Hook Logs (last ${recent.length}/${lines.length}):\n`);
        for (const line of recent) {
          console.log(line);
        }
        break;
      }

      case 'ingest': {
        const target = positional[0];
        if (!target) {
          console.error('Error: File, directory, or glob pattern required');
          console.error('Usage: cmem ingest <path> [options]');
          console.error('  cmem ingest README.md              # Single file');
          console.error('  cmem ingest ./docs                 # Directory (recursive)');
          console.error('  cmem ingest "src/**/*.md"          # Glob pattern');
          process.exit(1);
        }

        const { globSync } = await import('glob');
        const { readFileSync, statSync, existsSync } = await import('fs');
        const { basename, extname, resolve } = await import('path');

        const supportedExts = ['.md', '.txt', '.rst', '.adoc', '.mdx'];
        let files: string[] = [];

        // Detect if target is a directory, file, or glob
        if (existsSync(target)) {
          const stats = statSync(target);

          if (stats.isDirectory()) {
            // Recursive directory scan
            const patterns = supportedExts.map(ext => `${target}/**/*${ext}`);
            for (const pattern of patterns) {
              files.push(...globSync(pattern, { nodir: true }));
            }
            console.log(`\n📁 Scanning directory: ${resolve(target)}`);
          } else if (stats.isFile()) {
            // Single file
            files = [target];
          }
        } else {
          // Treat as glob pattern
          files = globSync(target, { nodir: true });
        }

        // Filter to supported extensions only
        files = files.filter(f => supportedExts.includes(extname(f).toLowerCase()));

        if (files.length === 0) {
          console.error(`No supported files found. Supported: ${supportedExts.join(', ')}`);
          process.exit(1);
        }

        // Sort for consistent ordering
        files.sort();

        console.log(`\n📚 Ingesting ${files.length} file(s)...\n`);

        let totalChunks = 0;
        let totalSections = 0;
        const category = (flags.category as string) || 'documentation';
        const importance = flags.importance ? parseInt(flags.importance as string) : 2;
        const dryRun = flags['dry-run'] === true;

        for (const file of files) {
          const ext = extname(file).toLowerCase();
          const content = readFileSync(file, 'utf-8');
          const fileName = basename(file);

          // Get relative path for context
          const relativePath = file.replace(process.cwd() + '/', '');

          // Split by headers for markdown-like files
          let sections: { title: string; content: string }[] = [];

          if (['.md', '.mdx'].includes(ext)) {
            sections = splitMarkdownByHeaders(content);
          } else {
            sections = [{ title: '', content }];
          }

          // Filter out tiny sections
          sections = sections.filter(s => s.content.trim().length >= 50);

          if (dryRun) {
            console.log(`📄 ${relativePath} → ${sections.length} section(s)`);
            totalSections += sections.length;
            continue;
          }

          for (const section of sections) {
            // Prefix with file path for context during recall
            const contextHeader = section.title
              ? `[${relativePath} > ${section.title}]`
              : `[${relativePath}]`;

            const prefixedContent = `${contextHeader}\n\n${section.content}`;

            const ids = await manager.remember({
              content: prefixedContent,
              type: 'fact',
              category,
              source: 'auto:ingest',
              importance,
              confidence: 0.95,
              tags: [fileName, 'ingested', category]
            });

            totalChunks += ids.length;
          }

          totalSections += sections.length;
          console.log(`✅ ${relativePath} → ${sections.length} section(s)`);
        }

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📊 Files processed: ${files.length}`);
        console.log(`📊 Sections found:  ${totalSections}`);
        if (!dryRun) {
          console.log(`📊 Memory chunks:   ${totalChunks}`);
        } else {
          console.log(`\n💡 Dry run - no memories created. Remove --dry-run to ingest.`);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Use "claude-memory help" for usage.');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// Helper function for markdown parsing
function splitMarkdownByHeaders(content: string): { title: string; content: string }[] {
  const lines = content.split('\n');
  const sections: { title: string; content: string }[] = [];

  let currentTitle = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)$/);

    if (headerMatch) {
      // Save previous section
      if (currentContent.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n').trim()
        });
      }
      currentTitle = headerMatch[1];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Don't forget last section
  if (currentContent.length > 0) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n').trim()
    });
  }

  return sections;
}

main();
