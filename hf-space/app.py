"""NarraForge API launcher for HF Spaces (Gradio SDK fallback path).

Gradio SDK Spaces are free. HF runs `pip install -r requirements.txt` and then
`python app.py`; nothing here uses Gradio — app.py simply starts uvicorn serving
the NarraForge FastAPI backend (workers feature set) on the port HF expects.

The Space repo layout for this path (produced by scripts/sync-hf-space.sh --sdk gradio):
    app.py              <- this file
    requirements.txt    <- exported from backend/pyproject.toml (core + local-services)
    backend/            <- full backend source (main:app lives here)
"""

import os
import sys

BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")

sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

os.environ.setdefault("DEPLOY_TARGET", "workers")
os.environ.setdefault("LOG_TO_FILE", "false")

import uvicorn

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
