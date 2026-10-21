"""Run the API server: python -m pasazhgard"""

import uvicorn

from pasazhgard.logs import LOG_CONFIG

uvicorn.run("pasazhgard.api:app", host="0.0.0.0", port=8000, log_config=LOG_CONFIG)
