FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/python:3.12-slim

WORKDIR /app

# 换阿里云 apt 镜像源，避免容器内访问外网失败
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends ffmpeg \
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