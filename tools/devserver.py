"""Dev server for Immich-Lite.

Serves app/ and forwards /api/* to an Immich server, so the app and the API share
one origin and CORS never comes into play. Use it from a desktop browser, or from
the TV's own web browser (it listens on all interfaces).

    python tools/devserver.py --immich http://192.168.1.10:2283
    python tools/devserver.py --mock          # fake library, no Immich needed

Then open http://<this-pc>:8000/ . The capability probe is at /capabilities.html.
"""

import argparse
import hashlib
import http.server
import json
import os
import random
import shutil
import socket
import struct
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, "app")
HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
              "proxy-authenticate", "proxy-authorization"}
FORWARD_HEADERS = ("Content-Type", "Accept", "Range", "x-api-key", "Authorization", "Cookie")


class Handler(http.server.SimpleHTTPRequestHandler):
    upstream = None
    mock = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def do_GET(self):
        self.route("GET")

    def do_HEAD(self):
        self.route("HEAD")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def end_headers(self):
        # Always serve fresh files while developing.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def route(self, method):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            if self.mock:
                return Mock(self).handle(method, path)
            return self.proxy(method)
        if method not in ("GET", "HEAD"):
            return self.send_error(405)
        if path == "/capabilities.html":
            self.directory = ROOT  # the probe lives at the repo root, outside app/
        if method == "HEAD":
            return super().do_HEAD()
        return super().do_GET()

    def proxy(self, method):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(self.upstream + self.path, data=body, method=method)
        for name in FORWARD_HEADERS:
            if self.headers.get(name):
                req.add_header(name, self.headers[name])
        try:
            resp = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as e:
            resp = e
        except OSError as e:
            return self.send_json(502, {"message": "Dev server could not reach Immich: %s" % e})
        with resp:
            self.send_response(resp.status)
            for name, value in resp.headers.items():
                if name.lower() not in HOP_BY_HOP:
                    self.send_header(name, value)
            self.end_headers()
            if method != "HEAD":
                shutil.copyfileobj(resp, self.wfile)

    def send_json(self, status, data):
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class Server(http.server.ThreadingHTTPServer):
    # http.server sets SO_REUSEADDR, which on Windows lets a second server bind a port
    # that is already in use; requests then land on either server at random.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


FAVORITES = {}  # asset id -> bool, set through PUT /api/assets while the mock runs
RATINGS = {}    # asset id -> 1..5, -1 or None, set through PUT /api/assets
# album id -> asset ids added through PUT /api/albums/{id}/assets. Each album already
# holds its cover photo, so adding the first timeline photo to "Summer 2026" says "Already in".
ALBUM_ASSETS = {}
# Partners who share with the mock user; inTimeline flips through PUT /api/partners/{id}.
PARTNERS = [{"id": "partner-user-1", "name": "Jane", "email": "jane@example.test", "inTimeline": True},
            {"id": "partner-user-2", "name": "Emma", "email": "emma@example.test", "inTimeline": False}]


class Mock:
    """A small fake Immich library, shaped like the v3.3.1 API responses."""

    MONTHS = ["2026-09", "2026-08", "2026-06", "2026-05", "2025-12", "2025-07"]
    ALBUMS = ["Summer 2026", "Hyrox race day", "Cabin weekend", "Birthdays", "Garden",
              "Road trip", "Swim meet", "Snow day", "Camping", "First steps"]
    PEOPLE = ["Alex", "Sam", "Jordan", "", "Riley", "Casey", "", "Morgan", "Taylor", "Jamie",
              "Avery", "Quinn", "Drew", "Parker", "Reese"]
    CITIES = [("Calgary", "Canada", 51.05, -114.07), ("Banff", "Canada", 51.18, -115.57),
              ("Kalispell", "United States", 48.20, -114.31), ("Mexico City", "Mexico", 19.43, -99.13),
              ("Vancouver", "Canada", 49.28, -123.12), ("Whitefish", "United States", 48.41, -114.34),
              ("Canmore", "Canada", 51.09, -115.36), ("Seattle", "United States", 47.61, -122.33),
              ("Toronto", "Canada", 43.65, -79.38), ("Lisbon", "Portugal", 38.72, -9.14),
              ("Tokyo", "Japan", 35.68, 139.69), ("Sydney", "Australia", -33.87, 151.21),
              ("Reykjavik", "Iceland", 64.15, -21.94), ("Cancun", "Mexico", 21.16, -86.85)]

    def __init__(self, handler):
        self.h = handler
        self.query = parse_qs(urlsplit(handler.path).query)

    def arg(self, name):
        return (self.query.get(name) or [None])[0]

    def body(self):
        length = int(self.h.headers.get("Content-Length") or 0)
        return json.loads(self.h.rfile.read(length) or b"{}")

    def send(self, data):
        return self.h.send_json(200, data)

    def handle(self, method, path):
        if path == "/api/server/ping":
            return self.send({"res": "pong"})
        if path == "/api/server/version":
            return self.send({"major": 3, "minor": 3, "patch": 1, "prerelease": None})
        if not (self.arg("apiKey") or self.h.headers.get("x-api-key")):
            return self.h.send_json(401, {"message": "Authentication required", "statusCode": 401})

        if path == "/api/partners" and method == "GET":
            return self.send([dict(p, avatarColor="primary", profileImagePath="", profileChangedAt=None) for p in PARTNERS])
        if path.startswith("/api/partners/") and method == "PUT":
            partner_id, b = path.split("/")[3], self.body()
            for p in PARTNERS:
                if p["id"] == partner_id:
                    p["inTimeline"] = bool(b.get("inTimeline"))
                    return self.send(dict(p, avatarColor="primary", profileImagePath="", profileChangedAt=None))
            return self.h.send_json(400, {"message": "Partner not found", "statusCode": 400})
        if path == "/api/users/me":
            return self.send({"id": "mock-user", "name": "Mock User", "email": "mock@example.test",
                              "quotaSizeInBytes": None, "quotaUsageInBytes": 187654321098})
        if path == "/api/assets/statistics":
            items = self.all_assets()
            images = len([a for a in items if a["img"]])
            return self.send({"images": images, "videos": len(items) - images, "total": len(items)})
        if path == "/api/server/storage":
            size, use = 3998614552576, 1514280419328
            return self.send({"diskSize": "3.6 TiB", "diskUse": "1.4 TiB", "diskAvailable": "2.3 TiB",
                              "diskSizeRaw": size, "diskUseRaw": use, "diskAvailableRaw": size - use,
                              "diskUsagePercentage": round(use * 100.0 / size, 2)})
        if path.startswith("/api/stacks/"):
            primary = path.split("/")[3][len("stack-"):]
            members = [a for a in self.assets(primary[:7]) if a.get("stack_of") == "stack-" + primary]
            if not members:
                return self.h.send_json(404, {"message": "Not found", "statusCode": 404})
            return self.send({"id": "stack-" + primary, "primaryAssetId": primary,
                              "assets": [dict(self.dto(a), isTrashed=False) for a in members]})
        if path == "/api/albums":
            return self.send([self.album(i) for i in range(len(self.ALBUMS))])
        if path.startswith("/api/timeline/") and self.partners_refused():
            # Immich v3.3.1 (timeline.service.ts) refuses withPartners outside the plain timeline.
            return self.h.send_json(400, {"message": "withPartners is only supported for non-archived, "
                                                     "non-trashed, non-favorited assets", "statusCode": 400})
        if path == "/api/timeline/buckets":
            out = []
            for m in self.timeline_months():
                n = len(self.filtered(m))
                if n:
                    out.append({"timeBucket": m + "-01T00:00:00.000Z", "count": n})
            return self.send(out)
        if path == "/api/timeline/bucket":
            return self.send(self.columns(self.filtered((self.arg("timeBucket") or "")[:7]),
                                          self.arg("withStacked") == "true"))
        if path == "/api/assets" and method == "PUT":
            b = self.body()
            # v3: 1-5 stars, -1 rejected, null unrated; 0 is refused.
            if "rating" in b and b["rating"] not in (None, -1, 1, 2, 3, 4, 5):
                return self.h.send_json(400, {"message": ["rating must not be less than -1, and 0 is no longer valid"],
                                              "error": "Bad Request", "statusCode": 400})
            for asset_id in b.get("ids", []):
                if "isFavorite" in b:
                    FAVORITES[asset_id] = bool(b["isFavorite"])
                if "rating" in b:
                    RATINGS[asset_id] = b["rating"]
            self.h.send_response(204)
            self.h.send_header("Content-Length", "0")
            self.h.end_headers()
            return None
        if path == "/api/search/random" and method == "POST":
            b = self.body()
            small = bool(b.get("albumIds") or b.get("personIds"))
            pool = [a for m in (self.MONTHS[:2] if small else self.MONTHS) for a in self.assets(m, small)]
            if b.get("isFavorite"):
                pool = [a for a in pool if a["fav"]]
            if b.get("city"):
                pool = [a for a in pool if self.city_name(a["id"]) == b["city"]]
            if b.get("visibility") == "archive":
                pool = self.archived()
            if b.get("tagIds"):
                pool = [a for a in self.all_assets() if all(self.has_tag(a["id"], t) for t in b["tagIds"])]
            if b.get("type"):
                pool = [a for a in pool if a["img"] == (b["type"] == "IMAGE")]
            random.shuffle(pool)
            return self.send([self.dto(a) for a in pool[:min(int(b.get("size", 250)), 1000)]])
        if path == "/api/people":
            people = [{"id": "person-%d" % i, "name": n, "isHidden": False, "thumbnailPath": "x", "birthDate": None,
                       "otherPeople": [], "sharedBy": [], "sharedWith": []} for i, n in enumerate(self.PEOPLE)]
            return self.send({"people": people, "total": len(people), "hidden": 0, "hasNextPage": False})
        if path.startswith("/api/people/") and path.endswith("/thumbnail"):
            i = int(path.split("/")[3].split("-")[1])
            return self.svg(180, 180, i * 47 % 360, self.PEOPLE[i][:1] or "?", 72)
        if path == "/api/search/cities":
            return self.send([{"id": "%s-0-%d" % (self.MONTHS[i % 6], i), "type": "IMAGE",
                               "exifInfo": {"city": c[0], "country": c[1]}} for i, c in enumerate(self.CITIES)])
        if path == "/api/search/metadata" and method == "POST":
            b = self.body()
            return self.page([a for a in self.all_assets() if self.city_name(a["id"]) == b.get("city")], b)
        if path == "/api/search/smart" and method == "POST":
            b = self.body()
            q = (b.get("query") or "").lower()
            return self.page([a for a in self.all_assets()
                              if int(hashlib.md5((q + a["id"]).encode()).hexdigest(), 16) % 4 == 0], b)
        if path == "/api/memories":
            last_year = self.assets("2025-07")[:12]
            older = [{"id": "2023-10-0-%d" % i, "img": True, "fav": False,
                      "date": "2023-10-%02dT12:00:00.000Z" % (11 - i % 3)} for i in range(7)]
            return self.send([
                {"id": "memory-1", "type": "on_this_day", "data": {"year": 2025}, "assets": [self.dto(a) for a in last_year]},
                {"id": "memory-2", "type": "on_this_day", "data": {"year": 2023}, "assets": [self.dto(a) for a in older]},
            ])
        if path == "/api/map/markers":
            out = []
            mine = self.all_assets()
            if self.arg("withPartners") == "true":
                mine += [a for m in self.MONTHS for a in self.partner_assets(m)]
            for a in mine:
                c = self.city_of(a["id"])
                if c:
                    jitter = int(hashlib.md5(a["id"].encode()).hexdigest(), 16)
                    out.append({"id": a["id"], "lat": c[2] + (jitter % 100 - 50) / 900.0,
                                "lon": c[3] + (jitter // 100 % 100 - 50) / 900.0,
                                "city": c[0], "state": None, "country": c[1]})
            return self.send(out)
        if path == "/api/view/folder/unique-paths":
            return self.send(sorted(self.FOLDERS))
        if path == "/api/view/folder":
            return self.send([self.dto(a) for a in self.folder_assets(self.arg("path") or "")])
        if path == "/api/tags":
            return self.send([self.tag(i) for i in range(len(self.TAGS))])
        if path.startswith("/api/assets/") and path.endswith("/thumbnail"):
            asset_id, big = path.split("/")[3], self.arg("size") == "preview"
            return self.svg(1440 if big else 250, 960 if big else 250,
                            int(hashlib.md5(asset_id.encode()).hexdigest(), 16) % 360, asset_id, 64 if big else 22)
        if path.startswith("/api/assets/") and path.endswith("/video/playback"):
            # Videos from December 2025 fail, to try the app's "can't play" fallback.
            if path.split("/")[3].startswith("2025-12"):
                return self.h.send_json(404, {"message": "Mock video missing", "statusCode": 404})
            raw = mock_video()
            self.h.send_response(200)
            self.h.send_header("Content-Type", "video/mp4")
            self.h.send_header("Content-Length", str(len(raw)))
            self.h.end_headers()
            if method != "HEAD":
                self.h.wfile.write(raw)
            return None
        if path.startswith("/api/assets/") and path.count("/") == 3 and method == "GET":
            info = self.asset_info(path.split("/")[3])
            if not info:
                return self.h.send_json(400, {"message": "Not found or no asset.read access", "statusCode": 400})
            return self.send(info)
        if path.startswith("/api/albums/") and path.endswith("/assets") and method == "PUT":
            album_id = path.split("/")[3]
            if album_id not in ["album-%d" % i for i in range(len(self.ALBUMS))]:
                return self.h.send_json(400, {"message": "Not found or no album.read access", "statusCode": 400})
            have, out = self.album_assets(album_id), []
            for asset_id in self.body().get("ids", []):
                if asset_id in have:
                    out.append({"id": asset_id, "success": False, "error": "duplicate"})
                else:
                    ALBUM_ASSETS.setdefault(album_id, set()).add(asset_id)
                    out.append({"id": asset_id, "success": True})
            return self.send(out)
        return self.h.send_json(404, {"message": "Not mocked: " + path, "statusCode": 404})

    # ----- fake library -----

    @staticmethod
    def count(month):
        return 20 + int(hashlib.md5(month.encode()).hexdigest(), 16) % 60

    def assets(self, month, small=False):
        n = 9 if small else self.count(month)
        out = []
        for i in range(n):
            asset_id = "%s-%d-%d" % (month, i // 10, i)
            out.append({"id": asset_id, "img": i % 11 != 5,
                        "fav": FAVORITES.get(asset_id, i % 7 == 3),
                        "date": "%s-%02dT12:00:00.000Z" % (month, 28 - (i * 27 // max(n, 1)))})
        # A few stacks of 3-5 (burst shots): the first photo is the primary. They sit
        # at the same indexes in the full month and the 9-photo album/person view.
        for i in range(2, n, 13):
            size = 3 + int(hashlib.md5(("stack" + out[i]["id"]).encode()).hexdigest(), 16) % 3
            if i + size > n:
                break
            stack_id = "stack-" + out[i]["id"]
            out[i]["stack"] = [stack_id, str(size)]
            for a in out[i:i + size]:
                a["stack_of"] = stack_id
        return out

    def all_assets(self):
        return [a for m in self.MONTHS for a in self.assets(m)]

    def timeline_months(self):
        return self.MONTHS[:2] if (self.arg("albumId") or self.arg("personId")) else self.MONTHS

    def filtered(self, month):
        if self.arg("visibility") == "archive":
            return [a for a in self.archived() if a["date"][:7] == month]
        if month not in self.timeline_months():
            return []
        items = self.assets(month, bool(self.arg("albumId") or self.arg("personId")))
        if self.arg("isFavorite") == "true":
            items = [a for a in items if a["fav"]]
        if self.arg("withStacked") == "true":  # only a stack's primary photo shows
            items = [a for a in items if not a.get("stack_of") or a.get("stack")]
        if self.arg("tagId"):
            items = [a for a in items if self.has_tag(a["id"], self.arg("tagId"))]
        if self.arg("withPartners") == "true":
            items = sorted(items + self.partner_assets(month), key=lambda a: a["date"], reverse=True)
        return items

    # ----- library: archive, folders, tags, partners -----

    # Paths as Immich stores them; the shared /usr/src/app/upload/library/admin prefix
    # is what the app's folder tree skips. 2024 holds photos and subfolders.
    FOLDERS = ["/usr/src/app/upload/library/admin/2024",
               "/usr/src/app/upload/library/admin/2024/2024-05 Banff",
               "/usr/src/app/upload/library/admin/2024/2024-07 Lisbon",
               "/usr/src/app/upload/library/admin/2025/Christmas",
               "/usr/src/app/upload/library/admin/2025/Swim meet/Finals",
               "/usr/src/app/upload/library/admin/Phone/Camera",
               "/usr/src/app/upload/library/admin/Phone/Screenshots",
               "/usr/src/app/upload/library/admin/Scans"]
    TAGS = ["Family", "Places", "Places/Canada", "Places/Canada/Banff", "Places/Portugal", "Events/Hyrox"]

    def partners_refused(self):
        if self.arg("withPartners") != "true":
            return False
        return (self.arg("visibility") in (None, "archive") or self.arg("isFavorite") is not None
                or self.arg("isTrashed") == "true")

    def archived(self):
        out = []
        for m in ("2025-12", "2025-07"):
            for i in range(7):
                out.append({"id": "archived-%s-%d" % (m, i), "img": True, "fav": False,
                            "date": "%s-%02dT12:00:00.000Z" % (m, 26 - i * 3)})
        return out

    def partner_assets(self, month):
        # Like Immich: only partners you show in your timeline contribute photos.
        if month not in self.MONTHS[:3] or not any(p["inTimeline"] for p in PARTNERS):
            return []
        return [{"id": "partner-%s-%d" % (month, i), "img": True, "fav": False,
                 "date": "%s-%02dT18:00:00.000Z" % (month, 25 - i * 5)} for i in range(5)]

    @staticmethod
    def tag_id(i):
        return "00000000-0000-4000-8000-%012d" % (i + 1)

    def tag(self, i):
        value = self.TAGS[i]
        parent = value.rsplit("/", 1)[0] if "/" in value else None
        out = {"id": self.tag_id(i), "name": value.rsplit("/", 1)[-1], "value": value,
               "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"}
        if parent in self.TAGS:
            out["parentId"] = self.tag_id(self.TAGS.index(parent))
        return out

    def has_tag(self, asset_id, tag_id):
        return int(hashlib.md5((tag_id + asset_id).encode()).hexdigest(), 16) % 6 == 0

    def folder_assets(self, path):
        if path not in self.FOLDERS:
            return []
        month = self.MONTHS[self.FOLDERS.index(path) % len(self.MONTHS)]
        n = 4 + int(hashlib.md5(path.encode()).hexdigest(), 16) % 12
        return self.assets(month)[:n]

    def city_of(self, asset_id):
        h = int(hashlib.md5(("place" + asset_id).encode()).hexdigest(), 16)
        return self.CITIES[h % len(self.CITIES)] if h % 10 < 7 else None

    def city_name(self, asset_id):
        c = self.city_of(asset_id)
        return c[0] if c else None

    @staticmethod
    def columns(items, stacked=False):
        n = len(items)
        cols = {
            "id": [a["id"] for a in items], "isImage": [a["img"] for a in items],
            "isFavorite": [a["fav"] for a in items], "fileCreatedAt": [a["date"] for a in items],
            "ratio": [Mock.ratio_of(a["id"]) for a in items], "createdAt": [None] * n, "isTrashed": [False] * n,
            "duration": [None if a["img"] else MOCK_VIDEO_MS for a in items],
            "livePhotoVideoId": [None] * n, "localOffsetHours": [0] * n, "ownerId": ["mock-user"] * n,
            "projectionType": [None] * n, "thumbhash": [None] * n, "visibility": ["timeline"] * n,
        }
        if stacked:  # Immich only sends this column with withStacked=true
            cols["stack"] = [a.get("stack") for a in items]
        return cols

    # A spread of real-world shapes: phone landscape/portrait, 4:3, square, panorama.
    RATIOS = [1.333, 0.75, 1.778, 0.5625, 1.5, 1.0, 0.667, 2.8]

    @classmethod
    def ratio_of(cls, asset_id):
        return cls.RATIOS[int(hashlib.md5(("ratio" + asset_id).encode()).hexdigest(), 16) % len(cls.RATIOS)]

    @staticmethod
    def dto(a):
        return {"id": a["id"], "type": "IMAGE" if a["img"] else "VIDEO", "isFavorite": a["fav"],
                "fileCreatedAt": a["date"], "localDateTime": a["date"],
                "duration": None if a["img"] else MOCK_VIDEO_MS,
                "width": int(1000 * Mock.ratio_of(a["id"])), "height": 1000}

    def page(self, items, body):
        page, size = int(body.get("page") or 1), int(body.get("size") or 100)
        chunk = items[(page - 1) * size:page * size]
        more = page * size < len(items)
        return self.send({"albums": {"items": [], "count": 0, "total": 0, "facets": []},
                          "assets": {"items": [self.dto(a) for a in chunk], "count": len(chunk), "total": len(items),
                                     "facets": [], "nextPage": str(page + 1) if more else None}})

    CAMERAS = [("Apple", "iPhone 15 Pro", "iPhone 15 Pro back triple camera 6.765mm f/1.78"),
               ("Canon", "Canon EOS R6", "RF24-105mm F4 L IS USM"), ("SONY", "ILCE-7M3", "FE 35mm F1.8"),
               ("Google", "Pixel 8", None), (None, None, None)]  # the last: a screenshot, no camera
    STATES = {"Calgary": "Alberta", "Banff": "Alberta", "Canmore": "Alberta", "Vancouver": "British Columbia",
              "Toronto": "Ontario", "Kalispell": "Montana", "Whitefish": "Montana", "Seattle": "Washington"}

    def person(self, i):
        # person-6 (no name) is hidden, to check the app leaves hidden people out.
        return {"id": "person-%d" % i, "name": self.PEOPLE[i], "isHidden": i == 6, "thumbnailPath": "x",
                "birthDate": None, "otherPeople": [], "sharedBy": [], "sharedWith": []}

    def asset_info(self, asset_id):
        """GET /api/assets/{id}: an AssetResponseDto with exifInfo and people."""
        try:
            month, _, i = asset_id.rsplit("-", 2)
            i, year, mon = int(i), int(month[:4]), int(month[5:7])
        except ValueError:
            return None
        h = int(hashlib.md5(("info" + asset_id).encode()).hexdigest(), 16)
        img = i % 11 != 5
        day = max(1, 28 - (i * 27 // max(self.count(month), 1)))
        taken = "%04d-%02d-%02dT%02d:%02d:00.000Z" % (year, mon, day, 7 + h % 14, h // 14 % 60)
        make, model, lens = self.CAMERAS[h % len(self.CAMERAS)]
        w, ht = [(4032, 3024), (6000, 4000), (3024, 4032)][h // 5 % 3]
        c = self.city_of(asset_id)
        people = sorted({(h >> (8 + 4 * j)) % len(self.PEOPLE) for j in range(h // 7 % 4)})
        exif = {
            "make": make, "model": model, "lensModel": lens,
            "fNumber": [1.8, 2.8, 4.0, 5.6, 8.0][h // 3 % 5] if make else None,
            "exposureTime": ["1/60", "1/125", "1/250", "1/1000", "0.5"][h // 11 % 5] if make else None,
            "iso": [50, 100, 200, 400, 1600][h // 13 % 5] if make else None,
            "focalLength": [6.765, 24.0, 35.0, 50.0, 105.0][h // 17 % 5] if make else None,
            "exifImageWidth": w, "exifImageHeight": ht, "fileSizeInByte": 900000 + h % 9000000,
            "dateTimeOriginal": taken, "modifyDate": taken, "timeZone": "America/Edmonton", "orientation": "1",
            "projectionType": None, "latitude": c[2] if c else None, "longitude": c[3] if c else None,
            "city": c[0] if c else None, "state": self.STATES.get(c[0]) if c else None, "country": c[1] if c else None,
            "description": "Fun day out with everyone" if h % 5 == 0 else "",
            "rating": RATINGS.get(asset_id, [None, None, None, 3, 5][h // 19 % 5]),
        }
        return {
            "id": asset_id, "type": "IMAGE" if img else "VIDEO", "ownerId": "mock-user",
            "originalFileName": ("IMG_%04d.%s" % (h % 10000, "JPG" if img else "MOV")),
            "originalMimeType": "image/jpeg" if img else "video/quicktime",
            "originalPath": "/data/library/mock/%s.jpg" % asset_id, "checksum": "bW9jaw==", "thumbhash": None,
            "fileCreatedAt": taken, "fileModifiedAt": taken, "localDateTime": taken,
            "createdAt": taken, "updatedAt": taken, "duration": None if img else 12000,
            "width": w, "height": ht, "isFavorite": FAVORITES.get(asset_id, i % 7 == 3),
            "isArchived": False, "isTrashed": False, "isOffline": False, "isEdited": False, "hasMetadata": True,
            "visibility": "timeline", "livePhotoVideoId": None, "stack": None, "tags": [],
            "exifInfo": exif, "people": [self.person(p) for p in people],
        }

    def album_assets(self, album_id):
        i = int(album_id.split("-")[1])
        return {"%s-0-%d" % (self.MONTHS[i % 6], i)} | ALBUM_ASSETS.get(album_id, set())

    def album(self, i):
        return {"id": "album-%d" % i, "albumName": self.ALBUMS[i], "assetCount": 12 + i * 7 + len(ALBUM_ASSETS.get("album-%d" % i, ())),
                "albumThumbnailAssetId": None if i == 3 else "%s-0-%d" % (self.MONTHS[i % 6], i),
                "updatedAt": "2026-%02d-01T00:00:00.000Z" % (10 - i % 9),
                "lastModifiedAssetTimestamp": "2026-%02d-15T00:00:00.000Z" % (10 - i % 9)}

    def svg(self, w, h, hue, text, font_size):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">'
               '<rect width="100%%" height="100%%" fill="hsl(%d,45%%,38%%)"/>'
               '<text x="50%%" y="50%%" fill="#fff" font-family="Arial" font-size="%d" '
               'text-anchor="middle" dominant-baseline="middle">%s</text></svg>'
               % (w, h, hue, font_size, text))
        raw = svg.encode("utf-8")
        self.h.send_response(200)
        self.h.send_header("Content-Type", "image/svg+xml")
        self.h.send_header("Content-Length", str(len(raw)))
        self.h.end_headers()
        self.h.wfile.write(raw)


# ----- mock video -----
#
# A 6-second H.264 MP4 built with the standard library: one flat colour per second,
# 48x32 pixels. Every frame is a keyframe made of I_PCM macroblocks (raw pixels), so
# no encoder is needed, yet any H.264 decoder (Chrome's, the TV's) can play it.

MOCK_VIDEO_MS = 6000
_MOCK_VIDEO = []
_COLOURS = [(81, 90, 240), (145, 54, 34), (41, 240, 110), (210, 16, 146), (170, 166, 16), (106, 202, 222)]  # Y, Cb, Cr


def mock_video():
    if not _MOCK_VIDEO:
        _MOCK_VIDEO.append(_build_mp4(48, 32))
    return _MOCK_VIDEO[0]


def _ue(n):
    """Exp-Golomb code, as a string of bits."""
    b = bin(n + 1)[2:]
    return "0" * (len(b) - 1) + b


def _nal(bits):
    """Bits (NAL header byte first) -> NAL bytes, with RBSP trailing bits and
    emulation prevention (no 00 00 0x in the payload)."""
    bits += "1"
    bits += "0" * (-len(bits) % 8)
    raw = bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))
    out, zeros = bytearray(raw[:1]), 0
    for b in raw[1:]:
        if zeros >= 2 and b <= 3:
            out.append(3)
            zeros = 0
        out.append(b)
        zeros = zeros + 1 if b == 0 else 0
    return bytes(out)


def _byte_bits(data):
    return "".join("{:08b}".format(b) for b in data)


def _box(kind, *parts):
    data = b"".join(parts)
    return struct.pack(">I4s", 8 + len(data), kind) + data


def _full_box(kind, flags, *parts):
    return _box(kind, struct.pack(">I", flags), *parts)  # version 0


def _build_mp4(w, h):
    mbs = (w // 16) * (h // 16)
    # Baseline profile, level 3.0, POC type 2 (no B-frames), no VUI.
    sps = _nal("01100111" + "01000010" + "11000000" + "00011110" + _ue(0) + _ue(0) + _ue(2) + _ue(1) + "0"
               + _ue(w // 16 - 1) + _ue(h // 16 - 1) + "1" + "1" + "0" + "0")
    # CAVLC, one slice group, no weighted prediction, QP 26, default deblocking.
    pps = _nal("01101000" + _ue(0) + _ue(0) + "0" + "0" + _ue(0) + _ue(0) + _ue(0) + "0" + "00"
               + "1" + "1" + "1" + "0" + "0" + "0")
    samples = []
    for i, (y, cb, cr) in enumerate(_COLOURS):
        # IDR slice header: first_mb 0, slice_type I (7), pps 0, frame_num 0, idr_pic_id
        # alternating (consecutive IDRs must differ), dec_ref_pic_marking 0 0, qp delta 0.
        bits = "01100101" + _ue(0) + _ue(7) + _ue(0) + "0000" + _ue(i % 2) + "00" + _ue(0)
        pcm = _byte_bits(bytes([y] * 256 + [cb] * 64 + [cr] * 64))
        for _ in range(mbs):
            bits += _ue(25)  # mb_type I_PCM
            bits += "0" * (-len(bits) % 8) + pcm
        nal = _nal(bits)
        samples.append(struct.pack(">I", len(nal)) + nal)

    dur = MOCK_VIDEO_MS
    matrix = struct.pack(">9I", 0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
    avcc = _box(b"avcC", bytes([1, 66, 0xC0, 30, 0xFF, 0xE1]), struct.pack(">H", len(sps)), sps,
                b"\x01", struct.pack(">H", len(pps)), pps)
    avc1 = _box(b"avc1", b"\0" * 6, struct.pack(">HHH3IHHIIIH", 1, 0, 0, 0, 0, 0, w, h, 0x480000, 0x480000, 0, 1),
                b"\0" * 32, struct.pack(">Hh", 0x18, -1), avcc)

    def moov(offset):
        stbl = _box(b"stbl",
                    _full_box(b"stsd", 0, struct.pack(">I", 1), avc1),
                    _full_box(b"stts", 0, struct.pack(">III", 1, len(samples), dur // len(samples))),
                    _full_box(b"stsc", 0, struct.pack(">IIII", 1, 1, len(samples), 1)),
                    _full_box(b"stsz", 0, struct.pack(">II", 0, len(samples)),
                              b"".join(struct.pack(">I", len(s)) for s in samples)),
                    _full_box(b"stco", 0, struct.pack(">II", 1, offset)))
        minf = _box(b"minf", _full_box(b"vmhd", 1, b"\0" * 8),
                    _box(b"dinf", _full_box(b"dref", 0, struct.pack(">I", 1), _full_box(b"url ", 1))), stbl)
        mdia = _box(b"mdia", _full_box(b"mdhd", 0, struct.pack(">IIIIHH", 0, 0, 1000, dur, 0x55C4, 0)),
                    _full_box(b"hdlr", 0, struct.pack(">I4s3I", 0, b"vide", 0, 0, 0), b"VideoHandler\0"), minf)
        tkhd = _full_box(b"tkhd", 3, struct.pack(">5I", 0, 0, 1, 0, dur), b"\0" * 8, struct.pack(">hhhH", 0, 0, 0, 0),
                         matrix, struct.pack(">II", w << 16, h << 16))
        mvhd = _full_box(b"mvhd", 0, struct.pack(">IIIIIH", 0, 0, 1000, dur, 0x10000, 0x100), b"\0" * 10, matrix,
                         b"\0" * 24, struct.pack(">I", 2))
        return _box(b"moov", mvhd, _box(b"trak", tkhd, mdia))

    ftyp = _box(b"ftyp", b"isom", struct.pack(">I", 0x200), b"isomiso2avc1mp41")
    head = len(ftyp) + len(moov(0)) + 8  # the first sample starts right after the mdat header
    return ftyp + moov(head) + _box(b"mdat", b"".join(samples))


def main():
    p = argparse.ArgumentParser(description="Serve Immich-Lite and proxy /api to Immich.")
    p.add_argument("--immich", default=os.environ.get("IMMICH_URL", ""),
                   help="Immich server, e.g. http://192.168.1.10:2283 (or set IMMICH_URL)")
    p.add_argument("--mock", action="store_true", help="serve a fake library instead of proxying")
    p.add_argument("--port", type=int, default=8000)
    args = p.parse_args()
    if not args.mock and not args.immich:
        p.error("give --immich URL (or IMMICH_URL), or use --mock")

    Handler.upstream = args.immich.rstrip("/")
    Handler.mock = args.mock
    try:
        server = Server(("0.0.0.0", args.port), Handler)
    except OSError as e:
        p.exit(1, "Port %d is not free (%s). Is another dev server already running?\n" % (args.port, e))
    print("Immich-Lite dev server on http://0.0.0.0:%d/  (%s)"
          % (args.port, "mock library" if args.mock else "proxying /api to " + Handler.upstream))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
