# CMEM Installation Guide

## Prerequisites

### Required Software

1. **Node.js 18+**
   ```bash
   node --version  # Should be v18+
   ```

2. **Python 3.9+**
   ```bash
   python3 --version  # Should be 3.9+
   ```

3. **Apple Silicon Mac** (for MLX embeddings)
   ```bash
   uname -m  # Should be arm64
   ```

### Optional but Recommended

- **Claude Code CLI** installed and configured
- **git** for version control integration

## Step-by-Step Installation

### Step 1: Create Directory Structure

```bash
mkdir -p ~/.claude/cmem/{src,dist,mlx-server,hooks}
mkdir -p ~/.claude/skills/cmem
```

### Step 2: Create Configuration Files

#### config.json
```bash
cat > ~/.claude/cmem/config.json << 'EOF'
{
  "embedding": {
    "provider": "mlx",
    "model": "all-MiniLM-L6-v2-4bit",
    "dimensions": 384,
    "baseUrl": "http://127.0.0.1:8767"
  },
  "chunking": {
    "maxTokens": 500,
    "overlapTokens": 50,
    "minChunkSize": 100
  },
  "recall": {
    "projectResults": 5,
    "globalResults": 2,
    "globalTypesInProject": ["preference", "fact"],
    "distanceThreshold": 50.0,
    "boostRecency": true,
    "recencyHalfLifeDays": 30
  },
  "capture": {
    "autoSession": true,
    "autoCommit": true,
    "commitPatterns": ["^(feat|fix|refactor|breaking|perf)"],
    "minImportance": 3
  },
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
  },
  "gc": {
    "maxAgeUnusedDays": 180,
    "minConfidence": 0.3
  }
}
EOF
```

#### project-registry.json
```bash
cat > ~/.claude/cmem/project-registry.json << 'EOF'
{
  "projects": {}
}
EOF
```

#### package.json
```bash
cat > ~/.claude/cmem/package.json << 'EOF'
{
  "name": "claude-memory",
  "version": "1.0.0",
  "description": "Persistent vector memory system for Claude Code",
  "type": "module",
  "main": "dist/cli.js",
  "bin": {
    "claude-memory": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "memory": "node dist/cli.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "glob": "^11.0.0",
    "sqlite-vec": "^0.1.6"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0"
  }
}
EOF
```

#### tsconfig.json
```bash
cat > ~/.claude/cmem/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
EOF
```

### Step 3: Install Node.js Dependencies

```bash
cd ~/.claude/cmem
npm install
```

### Step 4: Setup MLX Embedding Server

#### Create Python virtual environment
```bash
cd ~/.claude/cmem/mlx-server
python3 -m venv venv
source venv/bin/activate
```

#### Create requirements.txt
```bash
cat > requirements.txt << 'EOF'
fastapi>=0.109.0
uvicorn>=0.27.0
mlx-embeddings>=0.1.0
EOF
```

#### Install Python dependencies
```bash
pip install -r requirements.txt
deactivate
```

#### Create server.py
See [EMBEDDING-SERVER.md](./EMBEDDING-SERVER.md) for the complete server code.

### Step 5: Setup LaunchAgent (macOS Auto-Start)

```bash
# Create LaunchAgent plist (replace YOUR_USERNAME with your actual username)
cat > ~/Library/LaunchAgents/com.cmem.mlx-server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cmem.mlx-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/.claude/cmem/mlx-server/venv/bin/uvicorn</string>
        <string>server:app</string>
        <string>--host</string>
        <string>127.0.0.1</string>
        <string>--port</string>
        <string>8767</string>
        <string>--log-level</string>
        <string>warning</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/.claude/cmem/mlx-server</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.claude/cmem/mlx-server/server.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.claude/cmem/mlx-server/server.log</string>
</dict>
</plist>
EOF

# Load the agent
launchctl load ~/Library/LaunchAgents/com.cmem.mlx-server.plist
```

### Step 6: Copy TypeScript Source Files

Copy all `.ts` files from the source templates to `~/.claude/cmem/src/`.

See the `templates/` directory in this repository for complete source files.

### Step 7: Build TypeScript

```bash
cd ~/.claude/cmem
npm run build
```

### Step 8: Configure Claude Code Hooks

Add to `~/.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/cmem/dist/hooks/recall.js",
            "timeout": 3000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": { "tools": ["Bash"] },
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/cmem/dist/hooks/capture-commit.js",
            "timeout": 5000
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/cmem/dist/hooks/extract-before-compact.js",
            "timeout": 30000
          }
        ]
      }
    ]
  }
}
```

### Step 9: Create Skill File

```bash
mkdir -p ~/.claude/skills/cmem
# Copy SKILL.md content (see templates/SKILL.md)
```

### Step 10: Add Shell Alias (Optional)

```bash
echo 'alias cmem="node ~/.claude/cmem/dist/cli.js"' >> ~/.zshrc
source ~/.zshrc
```

## Verification

### Check MLX Server

```bash
curl http://127.0.0.1:8767/health
# Should return: {"status":"ok","model":"mlx-community/all-MiniLM-L6-v2-4bit","dimensions":384}
```

### Check CLI

```bash
cmem status
# Should show MLX Server: ✅ Ready
```

### Test Memory Operations

```bash
# Register a project
cd ~/your-project
cmem project:new my-project

# Save a memory
cmem remember "This is a test memory" --type=fact

# Recall it
cmem recall "test"
```

## Troubleshooting

### MLX Server Not Starting

```bash
# Check logs
tail -f ~/.claude/cmem/mlx-server/server.log

# Manually start server
cd ~/.claude/cmem/mlx-server
source venv/bin/activate
python server.py
```

### sqlite-vec Installation Issues

```bash
# Rebuild native modules
cd ~/.claude/cmem
npm rebuild
```

### TypeScript Compilation Errors

```bash
# Check Node.js version
node --version  # Must be 18+

# Clean rebuild
rm -rf dist
npm run build
```

## Uninstallation

```bash
# Stop the MLX server
launchctl unload ~/Library/LaunchAgents/com.cmem.mlx-server.plist
rm ~/Library/LaunchAgents/com.cmem.mlx-server.plist

# Remove hooks from settings.local.json (manual edit)

# Delete cmem directory
rm -rf ~/.claude/cmem
rm -rf ~/.claude/skills/cmem
```
