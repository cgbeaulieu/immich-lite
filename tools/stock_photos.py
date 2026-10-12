"""Fetch the stock photos the mock library shows, for README screenshots.

    python tools/stock_photos.py                # downloads into tools/stock/ (git-ignored)
    python tools/devserver.py --mock --photos tools/stock

The photos come from picsum.photos, which serves Unsplash photos under the Unsplash
License (free to use, no permission needed). The list below is fixed, so every run gets
the same library. Each photo is saved twice, a small grid thumbnail and a large preview,
cropped to the shape given in PHOTOS. Faces for the People row are cut from FACES.

Writes tools/stock/manifest.json for the dev server and docs/screenshots/CREDITS.md
naming each photographer. Needs Pillow (pip install pillow) for the face crops.
"""

import argparse
import io
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (picsum id, shape) - shape is width/height, or None to keep the photo's own shape.
# Mostly landscapes and travel, some food, animals and people, with a few tall,
# square and panorama crops so the justified rows look like a real phone library.
PHOTOS = [
    (17, None), (29, None), (49, None), (54, None), (74, None), (116, None), (164, None),
    (174, None), (191, None), (199, None), (211, None), (235, None), (257, None), (287, None),
    (323, None), (392, None), (419, None), (434, None), (436, None), (482, None), (512, None),
    (523, None), (525, None), (553, None), (584, None), (645, None), (655, None), (696, None),
    (701, None), (767, None), (829, None), (849, None), (883, None), (901, None), (903, None),
    (906, None), (1016, None), (1036, None), (1040, None), (1043, None),
    # food, square like a phone's food shots
    (429, 1.0), (431, 1.0), (1080, 1.0), (835, 1.0), (493, None),
    # animals
    (169, None), (219, None), (237, None), (244, None), (433, 1.0), (582, None), (593, None),
    (659, None), (718, None), (837, None), (1003, None), (1024, None), (1069, 0.75), (1084, None),
    # people and moments
    (129, None), (203, None), (342, None), (469, None), (646, 0.5625), (656, 0.75), (695, None),
    (777, None), (822, None), (828, None), (838, None), (839, None), (841, None), (845, None),
    (1011, 0.75), (1012, None), (1035, 0.5625),
    # tall and panorama
    (509, 0.5625), (870, 0.75), (916, 2.8), (477, 2.8), (575, 2.8),
]

# Faces for the mock's PEOPLE, in order: (picsum id, face centre x, y as fractions of a
# 3:2 centre crop, crop side as a fraction of its height). Some are pets, as in a real library.
FACES = [
    (64, 0.52, 0.39, 0.40), (1027, 0.55, 0.42, 0.85), (836, 0.32, 0.22, 0.36), (1005, 0.53, 0.37, 0.45),
    (823, 0.51, 0.25, 0.42), (838, 0.48, 0.39, 0.30), (1014, 0.62, 0.40, 0.50), (832, 0.52, 0.20, 0.36),
    (839, 0.66, 0.26, 0.22), (237, 0.56, 0.45, 0.60), (822, 0.48, 0.33, 0.30), (978, 0.50, 0.39, 0.50),
    (659, 0.64, 0.28, 0.50), (1062, 0.44, 0.42, 0.45), (837, 0.66, 0.37, 0.60),
]

THUMB_LONG, PREVIEW_LONG, FACE_SIZE = 640, 1440, 300


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "immich-lite-stock/1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def size_for(shape, long_side):
    if shape >= 1:
        return long_side, int(round(long_side / shape))
    return int(round(long_side * shape)), long_side


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(ROOT, "tools", "stock"))
    args = ap.parse_args()
    from PIL import Image  # only the face crops need it

    os.makedirs(args.out, exist_ok=True)
    info = {}

    def about(pid):
        if pid not in info:
            info[pid] = json.loads(get("https://picsum.photos/id/%d/info" % pid))
        return info[pid]

    photos = []
    for n, (pid, shape) in enumerate(PHOTOS):
        meta = about(pid)
        shape = shape or meta["width"] / float(meta["height"])
        entry = {"picsum": pid, "ratio": round(shape, 4)}
        for kind, long_side in (("thumb", THUMB_LONG), ("preview", PREVIEW_LONG)):
            w, h = size_for(shape, long_side)
            name = "%d_%s.jpg" % (pid, kind)
            path = os.path.join(args.out, name)
            if not os.path.exists(path):
                with open(path, "wb") as f:
                    f.write(get("https://picsum.photos/id/%d/%d/%d.jpg" % (pid, w, h)))
            entry[kind] = name
        photos.append(entry)
        print("photo %d/%d: %d" % (n + 1, len(PHOTOS), pid))

    faces = []
    for pid, cx, cy, side in FACES:
        about(pid)  # for the credits
        name = "%d_face.jpg" % pid
        path = os.path.join(args.out, name)
        if not os.path.exists(path):
            w, h = 1200, 800
            im = Image.open(io.BytesIO(get("https://picsum.photos/id/%d/%d/%d.jpg" % (pid, w, h)))).convert("RGB")
            s = side * h
            left = min(max(cx * w - s / 2, 0), w - s)
            top = min(max(cy * h - s / 2, 0), h - s)
            im.crop((int(left), int(top), int(left + s), int(top + s))).resize((FACE_SIZE, FACE_SIZE), Image.LANCZOS) \
                .save(path, quality=88)
        faces.append(name)
    print("faces: %d" % len(faces))

    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump({"photos": photos, "faces": faces}, f, indent=1)

    used = sorted({p for p, _ in PHOTOS} | {f[0] for f in FACES})
    lines = ["# Photo credits", "",
             "The photos in these screenshots are a fake library shown by the dev server's mock mode",
             "(`tools/stock_photos.py`). They come from [Unsplash](https://unsplash.com) through",
             "[Lorem Picsum](https://picsum.photos), under the [Unsplash License](https://unsplash.com/license).",
             "Thank you to the photographers:", ""]
    for pid in used:
        lines.append("- [%s](%s)" % (info[pid]["author"], info[pid]["url"]))
    credits = os.path.join(ROOT, "docs", "screenshots", "CREDITS.md")
    os.makedirs(os.path.dirname(credits), exist_ok=True)
    with open(credits, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote %s and %s" % (os.path.join(args.out, "manifest.json"), credits))


if __name__ == "__main__":
    main()
