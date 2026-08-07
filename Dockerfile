FROM python:3.12-slim

WORKDIR /app

# Install deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "\
import os, sys, time; \
f = '/tmp/bot_heartbeat'; \
sys.exit(0 if os.path.exists(f) and time.time() - os.path.getmtime(f) < 90 else 1)"

# Run
CMD ["python", "main.py"]
