# MLX Embedding Server

## Overview

CMEM uses a local FastAPI server running MLX to generate embeddings. This provides:
- Native Apple Silicon optimization
- No cloud API dependencies
- Fast inference (~10-50ms)
- Automatic startup via macOS LaunchAgent

## Server Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MLX Embedding Server                      │
│                                                              │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │   FastAPI    │  │ mlx-embeddings│  │ MiniLM-L6-v2    │  │
│  │  Web Server  │  │   Library     │  │   4-bit Model   │  │
│  │   :8767      │  │               │  │   (~100MB)      │  │
│  └──────────────┘  └───────────────┘  └─────────────────┘  │
│                                                              │
│  Endpoints:                                                  │
│  POST /embed    - Generate embeddings                       │
│  GET  /health   - Health check                              │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Apple Silicon Mac (M1/M2/M3)
- Python 3.9+
- ~500MB disk space (model + dependencies)

### Setup Steps

```bash
# 1. Create directory
mkdir -p ~/.claude/cmem/mlx-server
cd ~/.claude/cmem/mlx-server

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
cat > requirements.txt << 'EOF'
fastapi>=0.109.0
uvicorn>=0.27.0
mlx-embeddings>=0.1.0
EOF

pip install -r requirements.txt

# 4. Deactivate venv
deactivate
```

## Server Code

Create `~/.claude/cmem/mlx-server/server.py`:

```python
"""
MLX Embedding Server for CMEM
FastAPI server providing embeddings via MLX on Apple Silicon
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import logging
import mlx.core as mx

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global model reference
model = None
tokenizer = None
MODEL_NAME = "mlx-community/all-MiniLM-L6-v2-4bit"
DIMENSIONS = 384


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dimensions: int


class HealthResponse(BaseModel):
    status: str
    model: str
    dimensions: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    global model, tokenizer
    logger.info(f"Loading model: {MODEL_NAME}...")

    from mlx_embeddings.utils import load
    model, tokenizer = load(MODEL_NAME)

    logger.info("Model loaded successfully")
    yield
    logger.info("Shutting down...")


app = FastAPI(
    title="MLX Embedding Server",
    description="Embedding server for CMEM using MLX",
    version="1.0.0",
    lifespan=lifespan
)


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest) -> EmbedResponse:
    """Generate embeddings for a list of texts."""
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if not request.texts:
        raise HTTPException(status_code=400, detail="No texts provided")

    try:
        # Use internal tokenizer for batch encoding
        encoded = tokenizer._tokenizer(
            request.texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors='np'
        )

        # Convert to MLX arrays
        input_ids = mx.array(encoded['input_ids'])
        attention_mask = mx.array(encoded['attention_mask'])

        # Generate embeddings
        outputs = model(input_ids, attention_mask=attention_mask)

        # Get normalized embeddings
        embeddings = outputs.text_embeds.tolist()

        return EmbedResponse(
            embeddings=embeddings,
            dimensions=len(embeddings[0]) if embeddings else DIMENSIONS
        )
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check endpoint."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    return HealthResponse(
        status="ok",
        model=MODEL_NAME,
        dimensions=DIMENSIONS
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8767, log_level="warning")
```

## API Reference

### POST /embed

Generate embeddings for one or more texts.

**Request:**
```json
{
  "texts": ["First text to embed", "Second text to embed"]
}
```

**Response:**
```json
{
  "embeddings": [
    [0.123, -0.456, 0.789, ...],  // 384 floats
    [0.234, -0.567, 0.891, ...]   // 384 floats
  ],
  "dimensions": 384
}
```

**Errors:**
- 400: No texts provided
- 500: Embedding error
- 503: Model not loaded

### GET /health

Check server status.

**Response:**
```json
{
  "status": "ok",
  "model": "mlx-community/all-MiniLM-L6-v2-4bit",
  "dimensions": 384
}
```

## LaunchAgent Setup (Auto-Start)

Create `~/Library/LaunchAgents/com.cmem.mlx-server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
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
```

**Note:** Replace `YOUR_USERNAME` with your actual username.

### Managing the LaunchAgent

```bash
# Load (start server)
launchctl load ~/Library/LaunchAgents/com.cmem.mlx-server.plist

# Unload (stop server)
launchctl unload ~/Library/LaunchAgents/com.cmem.mlx-server.plist

# Check status
launchctl list | grep cmem

# View logs
tail -f ~/.claude/cmem/mlx-server/server.log
```

## Start Script

Create `~/.claude/cmem/mlx-server/start.sh`:

```bash
#!/bin/bash
# MLX Embedding Server starter script

PORT=8767

# Check if server is already running on this port
if lsof -i :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    exit 0
fi

cd "$(dirname "$0")"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate venv
source venv/bin/activate

# Install/update dependencies
pip install -q -r requirements.txt

# Start server
echo "Starting MLX embedding server on port $PORT..."
uvicorn server:app --host 127.0.0.1 --port $PORT --log-level warning
```

Make it executable:
```bash
chmod +x ~/.claude/cmem/mlx-server/start.sh
```

**Important:** The `lsof` check at the beginning prevents multiple instances from starting. Without this, concurrent calls (e.g., from hooks and LaunchAgent) can cause memory accumulation as each failed bind attempt loads the model before failing.

## Manual Running

For development or debugging:

```bash
cd ~/.claude/cmem/mlx-server
source venv/bin/activate
python server.py
# or with uvicorn directly:
uvicorn server:app --host 127.0.0.1 --port 8767 --reload
```

## Alternative Models

The default model is `all-MiniLM-L6-v2-4bit` (384 dimensions).

To use a different model:

1. **Find MLX-compatible model** on Hugging Face under `mlx-community`

2. **Update server.py:**
   ```python
   MODEL_NAME = "mlx-community/bge-small-en-v1.5-4bit"  # example
   DIMENSIONS = 384  # must match model output
   ```

3. **Update config.json:**
   ```json
   "embedding": {
     "dimensions": 384,  // must match
     ...
   }
   ```

4. **Re-embed all memories** (required if dimensions change)

### Recommended Models

| Model | Dimensions | Size | Notes |
|-------|------------|------|-------|
| all-MiniLM-L6-v2-4bit | 384 | ~100MB | Default, good balance |
| bge-small-en-v1.5-4bit | 384 | ~120MB | Better quality |
| all-mpnet-base-v2-4bit | 768 | ~250MB | Higher quality, larger |

## Troubleshooting

### Server Won't Start

```bash
# Check if port is in use
lsof -i :8767

# Check Python version
python3 --version  # Needs 3.9+

# Check MLX installation
python3 -c "import mlx; print(mlx.__version__)"
```

### Model Download Issues

First run downloads the model. If it fails:

```bash
# Clear cache
rm -rf ~/.cache/huggingface/hub/models--mlx-community*

# Manually download
source venv/bin/activate
python -c "from mlx_embeddings.utils import load; load('mlx-community/all-MiniLM-L6-v2-4bit')"
```

### Memory Issues

The model uses ~200-400MB RAM when loaded. If memory is tight:

1. Use a smaller model
2. Reduce `max_length` in tokenizer
3. Process smaller batches

### Excessive Memory Usage (Multi-GB)

**Symptom:** Python process using 10+ GB of RAM.

**Cause:** Multiple concurrent start attempts (hooks + LaunchAgent) where each:
1. Loads the model (~100-200MB)
2. Fails to bind port ("address already in use")
3. Shuts down but memory not immediately freed
4. Next attempt starts...

After 50-100+ cycles, memory accumulates to gigabytes.

**Fix:** Ensure `start.sh` checks if port is already in use before starting:

```bash
# At the top of start.sh
if lsof -i :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    exit 0
fi
```

**Recovery:**
```bash
# Stop LaunchAgent
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.cmem.mlx-server.plist

# Kill all instances
pkill -9 -f "uvicorn server:app.*8767"

# Restart cleanly
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cmem.mlx-server.plist
```

### Performance Tuning

```python
# In server.py, adjust batch processing:
encoded = tokenizer._tokenizer(
    request.texts,
    padding=True,
    truncation=True,
    max_length=256,  # Reduce from 512 for speed
    return_tensors='np'
)
```

## Security Considerations

- Server binds to `127.0.0.1` only (not accessible from network)
- No authentication (local use only)
- No rate limiting (trusted local client)
- Logs may contain embedded text summaries

For shared machines, consider:
- Running in user's namespace only
- Adding simple token authentication
- Binding to Unix socket instead of TCP
