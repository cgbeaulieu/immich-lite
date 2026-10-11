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


class Mock:
    """A small fake Immich library, shaped like the v3.3.1 API responses."""

    MONTHS = ["2026-09", "2026-08", "2026-06", "2026-05", "2025-12", "2025-07"]
    ALBUMS = ["Summer 2026", "Hyrox race day", "Cabin weekend", "Birthdays", "Garden",
              "Road trip", "Swim meet", "Snow day", "Camping", "First steps"]

    def __init__(self, handler):
        self.h = handler
        self.query = parse_qs(urlsplit(handler.path).query)

    def arg(self, name):
        return (self.query.get(name) or [None])[0]

    def handle(self, method, path):
        if path == "/api/server/ping":
            return self.h.send_json(200, {"res": "pong"})
        if path == "/api/server/version":
            return self.h.send_json(200, {"major": 3, "minor": 3, "patch": 1, "prerelease": None})
        if not (self.arg("apiKey") or self.h.headers.get("x-api-key")):
            return self.h.send_json(401, {"message": "Authentication required", "statusCode": 401})
        if path == "/api/users/me":
            return self.h.send_json(200, {"id": "mock-user", "name": "Mock User", "email": "mock@example.test"})
        if path == "/api/albums":
            return self.h.send_json(200, [self.album(i) for i in range(len(self.ALBUMS))])
        if path == "/api/timeline/buckets":
            months = self.MONTHS[:2] if self.arg("albumId") else self.MONTHS
            return self.h.send_json(200, [{"timeBucket": m + "-01T00:00:00.000Z", "count": self.count(m)}
                                          for m in months])
        if path == "/api/timeline/bucket":
            return self.h.send_json(200, self.bucket(self.arg("timeBucket") or "", self.arg("albumId")))
        if path == "/api/search/random" and method == "POST":
            length = int(self.h.headers.get("Content-Length") or 0)
            body = json.loads(self.h.rfile.read(length) or b"{}")
            months = self.MONTHS[:2] if body.get("albumIds") else self.MONTHS
            pool = []
            for m in months:
                b = self.bucket(m + "-01T00:00:00.000Z", body.get("albumIds"))
                pool += [{"id": i, "type": "IMAGE" if img else "VIDEO", "fileCreatedAt": d, "localDateTime": d}
                         for i, img, d in zip(b["id"], b["isImage"], b["fileCreatedAt"])]
            if body.get("type"):
                pool = [a for a in pool if a["type"] == body["type"]]
            random.shuffle(pool)
            return self.h.send_json(200, pool[:min(int(body.get("size", 250)), 1000)])
        if path.startswith("/api/assets/") and path.endswith("/thumbnail"):
            return self.thumbnail(path.split("/")[3], self.arg("size") or "thumbnail")
        return self.h.send_json(404, {"message": "Not mocked: " + path, "statusCode": 404})

    @staticmethod
    def count(month):
        return 20 + int(hashlib.md5(month.encode()).hexdigest(), 16) % 60

    def album(self, i):
        return {"id": "album-%d" % i, "albumName": self.ALBUMS[i], "assetCount": 12 + i * 7,
                "albumThumbnailAssetId": None if i == 3 else "%s-0-%d" % (self.MONTHS[i % 6], i),
                "updatedAt": "2026-%02d-01T00:00:00.000Z" % (10 - i % 9),
                "lastModifiedAssetTimestamp": "2026-%02d-15T00:00:00.000Z" % (10 - i % 9)}

    def bucket(self, time_bucket, album_id):
        month = time_bucket[:7]
        n = 9 if album_id else self.count(month)
        ids = ["%s-%d-%d" % (month, i // 10, i) for i in range(n)]
        return {
            "id": ids,
            "isImage": [i % 11 != 5 for i in range(n)],
            "ratio": [1.5] * n,
            "fileCreatedAt": ["%s-%02dT12:00:00.000Z" % (month, 28 - (i * 27 // max(n, 1))) for i in range(n)],
            "createdAt": [None] * n, "duration": [None] * n, "isFavorite": [False] * n,
            "isTrashed": [False] * n, "livePhotoVideoId": [None] * n, "localOffsetHours": [0] * n,
            "ownerId": ["mock-user"] * n, "projectionType": [None] * n, "thumbhash": [None] * n,
            "visibility": ["timeline"] * n,
        }

    def thumbnail(self, asset_id, size):
        hue = int(hashlib.md5(asset_id.encode()).hexdigest(), 16) % 360
        w, h = (1440, 960) if size == "preview" else (250, 250)
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">'
               '<rect width="100%%" height="100%%" fill="hsl(%d,45%%,38%%)"/>'
               '<text x="50%%" y="50%%" fill="#fff" font-family="Arial" font-size="%d" '
               'text-anchor="middle" dominant-baseline="middle">%s</text></svg>'
               % (w, h, hue, 64 if size == "preview" else 22, asset_id))
        raw = svg.encode("utf-8")
        self.h.send_response(200)
        self.h.send_header("Content-Type", "image/svg+xml")
        self.h.send_header("Content-Length", str(len(raw)))
        self.h.end_headers()
        self.h.wfile.write(raw)


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
