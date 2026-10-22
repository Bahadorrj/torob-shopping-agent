"""plan_visit and get_directions: getting from the origin to the shops, down to floor and unit."""

from pydantic import BaseModel, Field

from pasazhgard.routing import LatLon, Route, Router, TravelMode


class DirectionsQuery(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    mode: TravelMode = "walk"


class MapLinks(BaseModel):
    """One-tap turn-by-turn navigation in a map app."""

    neshan: str
    balad: str
    google: str


class LastLeg(BaseModel):
    """Inside the pasaj: what the route to the street address does not cover."""

    pasaj: str | None
    landmark: str | None
    floor: str | None
    unit: str | None


class Directions(BaseModel):
    shop_id: str
    shop_name: str
    lat: float
    lon: float
    route: Route
    links: MapLinks
    last_leg: LastLeg


def map_links(a: LatLon, b: LatLon, mode: TravelMode) -> MapLinks:
    origin, dest = f"{a[0]},{a[1]}", f"{b[0]},{b[1]}"
    google_mode = {"walk": "walking", "transit": "transit", "car": "driving"}[mode]
    return MapLinks(
        # Neshan's web and Android links route by car only
        neshan=f"https://nshn.ir/?origin={origin}&destination={dest}&vehicle=d",
        # Balad has no documented route link, so it opens the shop's point
        balad=f"https://balad.ir/location?latitude={b[0]}&longitude={b[1]}&zoom=18",
        google=f"https://www.google.com/maps/dir/?api=1&origin={origin}&destination={dest}&travelmode={google_mode}",
    )


def _shops(conn, shop_ids: list[str]) -> dict[str, dict]:
    # shortcut: a shop without coordinates counts as not found; every shop in the dataset has them
    rows = conn.execute(
        "SELECT shop_id, name, lat, lon, pasaj, landmark, floor, unit, hours FROM shops WHERE shop_id = ANY(%s) AND lat IS NOT NULL",
        [shop_ids],
    )
    return {s["shop_id"]: s for s in rows}


def _directions(shop: dict, a: LatLon, route: Route, mode: TravelMode) -> Directions:
    b = (shop["lat"], shop["lon"])
    return Directions(
        shop_id=shop["shop_id"],
        shop_name=shop["name"],
        lat=b[0],
        lon=b[1],
        route=route,
        links=map_links(a, b, mode),
        last_leg=LastLeg(**{k: shop[k] for k in LastLeg.model_fields}),
    )


def get_directions(conn, shop_id: str, q: DirectionsQuery, router: Router) -> Directions | None:
    shop = _shops(conn, [shop_id]).get(shop_id)
    if shop is None:
        return None
    a = (q.lat, q.lon)
    return _directions(shop, a, router.route(a, (shop["lat"], shop["lon"]), q.mode), q.mode)
