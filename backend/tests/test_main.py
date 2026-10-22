import os
import subprocess
import sys


def test_server_starts_on_this_platform(database_url):
    proc = subprocess.Popen(
        [sys.executable, "-m", "pasazhgard"],
        env={**os.environ, "DATABASE_URL": database_url},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
    )
    try:
        # lifespan opens the psycopg pool before the socket binds, so this line proves startup worked
        for line in proc.stdout:
            if "Application startup complete" in line or "Application startup failed" in line:
                break
        assert "Application startup complete" in line
    finally:
        proc.kill()
        proc.wait()
