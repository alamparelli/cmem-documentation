# MLX Embedding Server

## Overview

CMEM uses a local FastAPI server running MLX to generate embeddings. This provides:
- Native Apple Silicon optimization
- No cloud API dependencies
- Fast inference (~10-50ms)
- **Memory efficient**: Lazy loading + auto-unload after 15min idle

## Server Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MLX Embedding Server                      │
│                                                              │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │   FastAPI    │  │ mlx-embeddings│  │ MiniLM-L6-v2    │  │
│  │  Web Server  │  │   Library     │  │   4-bit Model   │  │
│  │   :8767      │  │               │  │   (lazy load)   │  │
│  └──────────────┘  └───────────────┘  └─────────────────┘  │
│                                                              │
│  Endpoints:                                                  │
│  POST /embed    - Generate embeddings (lazy loads model)    │
│  GET  /health   - Health check (shows loaded state)         │
│  POST /unload   - Force unload model to free GPU memory     │
│                                                              │
│  Memory Management:                                          │
│  - Server idle: ~60 MB                                       │
│  - Model loaded: ~400 MB                                     │
│  - Auto-unloads after 15 min idle                           │
└─────────────────────────────────────────────────────────────┘
```

## Memory Management

The server implements intelligent memory management to minimize GPU memory usage:

| State | RAM Usage | Description |
|-------|-----------|-------------|
| Server idle | ~60 MB | Model not loaded |
| Model loaded | ~400 MB | After first /embed request |
| After 15min idle | ~60 MB | Auto-unloaded |

### How It Works

1. **Lazy Loading**: Model loads only on first `/embed` request, not at server startup
2. **Auto-Unload**: Background task checks every minute; unloads model after 15min without requests
3. **Manual Unload**: `POST /unload` immediately frees GPU memory
4. **GPU Memory Release**: Uses `mx.metal.clear_cache()` to properly free Metal GPU memory

## Installation

### Prerequisites

- Apple Silicon Mac (M1/M2/M3/M4)
- Python 3.12+
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
MLX Embedding Server for cmem
FastAPI server providing embeddings via MLX on Apple Silicon
Auto-unloads model after 15 minutes of inactivity to save GPU memory
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import logging
import mlx.core as mx
import asyncio
import gc
from datetime import datetime, timedelta

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global model reference
model = None
tokenizer = None
MODEL_NAME = "mlx-community/all-MiniLM-L6-v2-4bit"
DIMENSIONS = 384

# Auto-unload settings
UNLOAD_AFTER_MINUTES = 15
last_used: datetime | None = None
unload_task: asyncio.Task | None = None


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dimensions: int


class HealthResponse(BaseModel):
    status: str
    model: str
    dimensions: int
    loaded: bool


def load_model():
    """Load model into GPU memory."""
    global model, tokenizer, last_used
    if model is not None:
        return  # Already loaded

    logger.info(f"Loading model: {MODEL_NAME}...")
    from mlx_embeddings.utils import load
    model, tokenizer = load(MODEL_NAME)
    last_used = datetime.now()
    logger.info("Model loaded successfully")


def unload_model():
    """Unload model from GPU memory."""
    global model, tokenizer, last_used
    if model is None:
        return  # Already unloaded

    logger.info("Unloading model to free GPU memory...")
    model = None
    tokenizer = None
    last_used = None

    # Force garbage collection and clear MLX cache
    gc.collect()
    mx.metal.clear_cache()
    logger.info("Model unloaded, GPU memory freed")


async def auto_unload_checker():
    """Background task to unload model after inactivity."""
    global last_used
    while True:
        await asyncio.sleep(60)  # Check every minute
        if model is not None and last_used is not None:
            idle_time = datetime.now() - last_used
            if idle_time > timedelta(minutes=UNLOAD_AFTER_MINUTES):
                logger.info(f"Model idle for {idle_time}, auto-unloading...")
                unload_model()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background unload checker (model loads lazily on first request)."""
    global unload_task

    # Start background unload checker
    unload_task = asyncio.create_task(auto_unload_checker())
    logger.info(f"Server ready (model will load on first request, auto-unload after {UNLOAD_AFTER_MINUTES}min idle)")

    yield

    # Cleanup
    if unload_task:
        unload_task.cancel()
    unload_model()
    logger.info("Shutting down...")


app = FastAPI(
    title="MLX Embedding Server",
    description="Embedding server for cmem using MLX",
    version="2.0.0",
    lifespan=lifespan
)


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest) -> EmbedResponse:
    """Generate embeddings for a list of texts."""
    global last_used

    if not request.texts:
        raise HTTPException(status_code=400, detail="No texts provided")

    # Lazy load model on first request
    load_model()
    last_used = datetime.now()

    try:
        # Use internal tokenizer for batch encoding with numpy
        encoded = tokenizer._tokenizer(
            request.texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors='np'
        )

        # Convert numpy to MLX arrays
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
    """Health check endpoint (does not load model)."""
    return HealthResponse(
        status="ok",
        model=MODEL_NAME,
        dimensions=DIMENSIONS,
        loaded=model is not None
    )


@app.post("/unload")
async def force_unload():
    """Force unload model to free GPU memory."""
    unload_model()
    return {"status": "unloaded"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8767, log_level="warning")
```

## API Reference

### POST /embed

Generate embeddings for one or more texts. **Lazy loads model on first call.**

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

### GET /health

Check server status. **Does not load model.**

**Response:**
```json
{
  "status": "ok",
  "model": "mlx-community/all-MiniLM-L6-v2-4bit",
  "dimensions": 384,
  "loaded": false
}
```

The `loaded` field indicates whether the model is currently in memory:
- `false`: Model not loaded (~60MB RAM)
- `true`: Model loaded (~400MB RAM)

### POST /unload

Force unload model to free GPU memory immediately.

**Response:**
```json
{
  "status": "unloaded"
}
```

Use this when you want to free memory without waiting for the 15-minute auto-unload.

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

**Important:** The `lsof` check at the beginning prevents multiple instances from starting.

## Manual Running

For development or debugging:

```bash
cd ~/.claude/cmem/mlx-server
source venv/bin/activate
python server.py
# or with uvicorn directly:
uvicorn server:app --host 127.0.0.1 --port 8767 --reload --log-level info
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
python3 --version  # Needs 3.12+

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

### High Memory Usage

Check if model is loaded when it shouldn't be:

```bash
# Check loaded state
curl http://127.0.0.1:8767/health

# Force unload if needed
curl -X POST http://127.0.0.1:8767/unload
```

The model auto-unloads after 15 minutes of inactivity. If memory stays high after unload, this is normal Python behavior (memory isn't immediately returned to OS), but GPU memory is freed.

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
