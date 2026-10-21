import json
import logging
import logging.config

from pasazhgard.logs import LOG_CONFIG


def test_logs_are_one_json_object_per_line(capsys):
    logging.config.dictConfig(LOG_CONFIG)
    log = logging.getLogger("uvicorn.error")

    log.info("started on %s", "0.0.0.0:8000")
    try:
        1 / 0
    except ZeroDivisionError:
        log.exception("boom")

    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 2
    first, second = map(json.loads, lines)
    assert first["level"] == "INFO"
    assert first["logger"] == "uvicorn.error"
    assert first["message"] == "started on 0.0.0.0:8000"
    assert "time" in first
    assert second["level"] == "ERROR"
    assert "ZeroDivisionError" in second["exc"]
