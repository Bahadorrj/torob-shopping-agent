"""The routing port: route distance and time between two points."""

import logging
import os
from math import ceil
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel

from pasazhgard.sellers import distance_m

log = logging.getLogger(__name__)

TravelMode = Literal["walk", "transit", "car"]
LatLon = tuple[float, float]

# straight-line estimate: a flat speed per mode, ignoring streets and traffic
SPEED_KMH = {"walk": 4.5, "transit": 15, "car": 20}


class Route(BaseModel):
    distance_m: int
    duration_min: int
    source: Literal["neshan", "straight_line"]


class Router(Protocol):
    def route(self, a: LatLon, b: LatLon, mode: TravelMode) -> Route: ...


def straight_line(a: LatLon, b: LatLon, mode: TravelMode) -> Route:
    d = distance_m(*a, *b)
    return Route(distance_m=d, duration_min=ceil(d / (SPEED_KMH[mode] * 1000 / 60)), source="straight_line")


class StraightLine:
    """The fallback adapter, used when no routing key is set."""

    def route(self, a: LatLon, b: LatLon, mode: TravelMode) -> Route:
        return straight_line(a, b, mode)


class Neshan:
    """Neshan Direction API (ADR-0001). Any error, quota hit (HTTP 481/482) or odd body falls back to a straight line."""

    url = "https://api.neshan.org/v4/direction"

    def __init__(self, key: str, client: httpx.Client | None = None):
        self.key = key
        self.client = client or httpx.Client(timeout=3)

    def route(self, a: LatLon, b: LatLon, mode: TravelMode) -> Route:
        # the Direction API routes cars and motorcycles only
        if mode != "car":
            return straight_line(a, b, mode)
        try:
            r = self.client.get(
                self.url,
                params={"type": "car", "origin": f"{a[0]},{a[1]}", "destination": f"{b[0]},{b[1]}"},
                headers={"Api-Key": self.key},
            )
            r.raise_for_status()
            legs = r.json()["routes"][0]["legs"]
            return Route(
                distance_m=sum(leg["distance"]["value"] for leg in legs),
                duration_min=ceil(sum(leg["duration"]["value"] for leg in legs) / 60),
                source="neshan",
            )
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            log.warning("neshan direction failed, using a straight line", exc_info=True)
            return straight_line(a, b, mode)


def router_from_env() -> Router:
    key = os.environ.get("NESHAN_API_KEY")
    return Neshan(key) if key else StraightLine()
