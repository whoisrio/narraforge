FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (ffmpeg for audio merge)
# Use --no-install-recommends to avoid pulling heavy optional dependencies
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

# Create venv with Python 3.12 explicitly
RUN uv venv --python 3.12 .venv

# Set the venv in PATH
ENV PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./

# Sync dependencies with the correct Python
RUN uv sync --no-dev && rm -rf /root/.cache

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]