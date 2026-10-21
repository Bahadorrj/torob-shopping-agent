FROM python:3.14-slim
RUN pip install --no-cache-dir uv==0.12.10
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev
EXPOSE 8000
CMD ["python", "-m", "pasazhgard"]
