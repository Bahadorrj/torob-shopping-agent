"""Run the API server: python -m pasazhgard"""

import uvicorn

from pasazhgard.logs import LOG_CONFIG

# async psycopg cannot run on Windows' default Proactor loop; Linux already gets this loop under "auto"
uvicorn.run(
    "pasazhgard.api:app", host="0.0.0.0", port=8000, log_config=LOG_CONFIG, loop="asyncio:SelectorEventLoop"
)
