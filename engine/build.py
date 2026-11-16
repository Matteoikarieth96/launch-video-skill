"""launch-video: check video.json and turn it into the data the engine, the capture and the music read.

    python3 engine/build.py            (from the video folder)

Writes build/data.json (for the node scripts), build/data.js (for engine/video.html) and build/timeline.json
(for engine/music.py). Prints the length of every scene and any problem it finds. Exit code 1 on an error.
Standard library only. video.json is data: nothing in it is ever run.
"""
import json
import os
import tempfile
import math
import pathlib
import re
import sys

ENGINE = pathlib.Path(__file__).resolve().parent
ROOT = ENGINE.parent

SHOWS = ("text", "page", "phone", "image", "numbers", "cards", "code", "logo", "end")
ICONS = ("chart", "doc", "money", "search", "map", "lock", "bolt", "check", "star", "globe", "phone", "code", "people", "heart", "clock", "leaf")
MOODS = ("calm", "bright", "minimal", "none")
KEYS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
IMG_EXT = (".png", ".jpg", ".jpeg", ".svg", ".webp")
HEX = re.compile(r"^#[0-9a-fA-F]{6}\Z")
MAX_PAGES, MAX_SCENES = 20, 60
ASSET_NAME = re.compile(r"^(?:[A-Za-z0-9_][A-Za-z0-9._ @+-]*/)*[A-Za-z0-9_][A-Za-z0-9._ @+-]*\.(?:png|jpe?g|svg|webp)\Z", re.I)
SITE_DIR = [None]  # the local site folder (site.url file:...), relative to the video folder
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}\Z")

# the theme tokens; video.json "colors" overrides any of them per theme
DEFAULT_COLORS = {
    "light": {"bg": "#f5f5f7", "card": "#ffffff", "surface": "#f0f0f3", "ink": "#1d1d1f", "muted": "#424245", "soft": "#68686d",
              "faint": "#86868b", "accent": "#2f5bea", "accent2": "#6f8ff2", "accentBg": "#e9eefc", "onAccent": "#ffffff",
              "phoneBody": "#1d1d1f"},
    "dark": {"bg": "#000000", "card": "#1c1c1e", "surface": "#2c2c2e", "ink": "#f5f5f7", "muted": "#d1d1d6", "soft": "#98989d",
             "faint": "#7c7c80", "accent": "#8fa8ff", "accent2": "#5a72c9", "accentBg": "#1c2440", "onAccent": "#0b1230",
             "phoneBody": "#1c1c1e"},
}

errors, warnings = [], []


def err(msg):
    errors.append(msg)


def num(v, what, lo=None, hi=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        err(f"{what} must be a number")
        return None
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        err(f"{what} must be between {lo} and {hi}")
        return None
    return v


def text(v, what, maxlen=200, required=False):
    if v is None:
        if required:
            err(f"{what} is missing")
        return None
    if not isinstance(v, str):
        err(f"{what} must be text")
        return None
    if len(v) > maxlen:
        err(f"{what} is longer than {maxlen} characters")
    return v


def asset(v, what):
    """a file inside the video folder (assets/...), never an absolute path or one that leaves the folder"""
    if v is None:
        return None
    if not isinstance(v, str) or not v or v.startswith(("/", "\\")) or ":" in v or "\\" in v:
        err(f"{what}: use a path inside the video folder, like assets/logo.svg")
        return None
    p = (ROOT / v).resolve()
    if ROOT not in p.parents:
        err(f"{what}: {v} is outside the video folder")
        return None
    if p.suffix.lower() not in IMG_EXT:
        err(f"{what}: {v} must be one of {', '.join(IMG_EXT)}")
        return None
    if not p.is_file():
        err(f"{what}: {v} not found")
        return None
    rel = p.relative_to(ROOT).as_posix()
    if not ASSET_NAME.match(rel):
        err(f"{what}: {rel}: use letters, digits, spaces and . - _ @ + in file and folder names (no leading dot): rename the file")
        return None
    return rel


def site_url(base, path):
    if base.startswith("file:"):
        rel = base[5:]
        if rel.startswith(("/", "\\")) or ":" in rel:
            err("site.url: file: takes a folder inside the video folder, like file:site")
            return None
        d = (ROOT / rel).resolve()
        if d != ROOT and ROOT not in d.parents:
            err(f"site.url: {rel} is outside the video folder")
            return None
        if not d.is_dir():
            err(f"site.url: folder {rel} not found")
            return None
        SITE_DIR[0] = d.relative_to(ROOT).as_posix() or "."
        path_only, _, query = path.partition("?")
        f = (d / path_only.lstrip("/")).resolve()
        if f.is_dir():
            f = f / "index.html"
        if d != f and d not in f.parents:
            err(f"page path {path} leaves the site folder")
            return None
        return f.as_uri() + ("?" + query if query else "")
    return base.rstrip("/") + "/" + path.lstrip("/")


def main():
    vf = ROOT / "video.json"
    if not vf.is_file():
        print("video.json not found in", ROOT)
        return 1
    try:
        v = json.loads(vf.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"video.json is not valid JSON: {e}")
        return 1
    if not isinstance(v, dict):
        print("video.json must be an object")
        return 1

    name = v.get("name", "launch-video")
    if not isinstance(name, str) or not ID.match(name):
        err("name: lowercase letters, digits and dashes, like my-app-launch")
    out = {"name": name, "language": text(v.get("language", "en"), "language", 12) or "en"}

    prod = v.get("product") or {}
    out["product"] = {"name": text(prod.get("name"), "product.name", 60, True) or "",
                      "logo": asset(prod.get("logo"), "product.logo"), "logoDark": asset(prod.get("logoDark"), "product.logoDark")}
    mk = v.get("maker") or {}
    out["maker"] = {"name": text(mk.get("name"), "maker.name", 60) or "", "logo": asset(mk.get("logo"), "maker.logo"),
                    "logoDark": asset(mk.get("logoDark"), "maker.logoDark")}

    site = v.get("site") or {}
    base = text(site.get("url"), "site.url", 300) or ""
    if base and (not re.match(r"^(https?://|file:)", base) or base.startswith("file:/")):
        err("site.url must start with https://, http:// or file:<folder inside the video folder>")
    out["site"] = {"url": base, "label": text(site.get("label"), "site.label", 80) or re.sub(r"^https?://", "", base).rstrip("/")}

    fm = v.get("formats", ["16x9", "9x16"])
    if not isinstance(fm, list) or not fm or any(f not in ("16x9", "9x16") for f in fm):
        err('formats: a list of "16x9" and/or "9x16"')
        fm = ["16x9"]
    th = v.get("themes", ["light"])
    if not isinstance(th, list) or not th or any(t not in ("light", "dark") for t in th):
        err('themes: a list of "light" and/or "dark"')
        th = ["light"]
    out["formats"], out["themes"] = list(dict.fromkeys(fm)), list(dict.fromkeys(th))

    colors = {}
    user_c = v.get("colors") or {}
    for t in ("light", "dark"):
        c = dict(DEFAULT_COLORS[t])
        for k, val in (user_c.get(t) or {}).items():
            if k not in c:
                err(f"colors.{t}.{k}: unknown token (known: {', '.join(c)})")
            elif not isinstance(val, str) or not HEX.match(val):
                err(f"colors.{t}.{k} must be a colour like #2f5bea")
            else:
                c[k] = val
        colors[t] = c
    out["colors"] = colors

    font = v.get("font") or {}
    fam = font.get("family", "system")
    if not isinstance(fam, str) or not re.match(r"^[A-Za-z0-9 ]{1,40}\Z", fam):
        err("font.family: letters, digits and spaces only")
        fam = "system"
    out["font"] = {"family": fam, "google": bool(font.get("google")) and fam != "system"}

    mu = v.get("music") or {}
    mood = mu.get("mood", "calm")
    if mood not in MOODS:
        err(f"music.mood: one of {', '.join(MOODS)}")
        mood = "calm"
    bpm = num(mu.get("bpm", 105), "music.bpm", 60, 160) or 105
    key = mu.get("key", "D")
    if key not in KEYS:
        err("music.key: a note name like D, F# or Bb")
        key = "D"

    # pages
    pages, pids = [], {}
    if len(v.get("pages") or []) > MAX_PAGES:
        err(f"pages: at most {MAX_PAGES}")
    for i, p in enumerate((v.get("pages") or [])[:MAX_PAGES]):
        w = f"pages[{i}]"
        if not isinstance(p, dict):
            err(f"{w} must be an object")
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not ID.match(pid):
            err(f"{w}.id: lowercase letters, digits and dashes")
            continue
        if pid in pids:
            err(f"{w}.id {pid} is used twice")
        mobile = bool(p.get("mobile"))
        q = {"id": pid, "mobile": mobile, "path": text(p.get("path", "/"), f"{w}.path", 300) or "/",
             "width": int(num(p.get("width", 390 if mobile else 1280), f"{w}.width", 320, 2560) or 1280),
             "dsf": num(p.get("dsf", 3 if mobile else 2), f"{w}.dsf", 1, 3) or 2,
             "maxHeight": int(num(p.get("maxHeight", 5000), f"{w}.maxHeight", 600, 12000) or 5000),
             "wait": int(num(p.get("wait", 1200), f"{w}.wait", 0, 15000) or 0),
             "hide": [], "css": text(p.get("css", ""), f"{w}.css", 4000) or "", "boxes": {}, "crop": None, "typing": None,
             "themeAttribute": p.get("themeAttribute", site.get("themeAttribute")), "image": asset(p.get("image"), f"{w}.image"), "url": None}
        if q["themeAttribute"] is not None and (not isinstance(q["themeAttribute"], str) or not re.match(r"^[a-z][a-z0-9-]{0,30}\Z", q["themeAttribute"])):
            err(f"{w}.themeAttribute: an attribute name like data-theme")
            q["themeAttribute"] = None
        if "</" in q["css"] or "<" in q["css"]:
            err(f"{w}.css must not contain <")
        for s in p.get("hide") or []:
            if not isinstance(s, str) or len(s) > 200 or re.search(r"[{}<]", s):
                err(f"{w}.hide: CSS selectors without braces or <")
            else:
                q["hide"].append(s)
        for k, s in (p.get("boxes") or {}).items():
            if not re.match(r"^[A-Za-z][A-Za-z0-9_]{0,30}\Z", k) or not isinstance(s, str) or len(s) > 300:
                err(f"{w}.boxes.{k}: a short name and a CSS selector (or text:TAG|Starts with)")
            else:
                q["boxes"][k] = s
        if p.get("crop") is not None:
            cr = p["crop"]
            if not (isinstance(cr, list) and len(cr) == 2 and all(isinstance(x, (int, float)) for x in cr) and 0 <= cr[0] < cr[1]):
                err(f"{w}.crop: [left, right] in CSS px of the page, like [240, 1280]")
            else:
                q["crop"] = cr
        if p.get("typing") is not None:
            ty = p["typing"]
            if not isinstance(ty, dict) or not isinstance(ty.get("selector"), str) or not isinstance(ty.get("text"), str) or not ty["text"]:
                err(f'{w}.typing: {{"selector": "input[type=search]", "text": "what to type", "submit": true}}')
            else:
                q["typing"] = {"selector": ty["selector"][:300], "text": ty["text"][:80], "submit": bool(ty.get("submit"))}
        if not q["image"]:
            if not base:
                err(f"{w}: site.url is needed to capture it (or give an image)")
            else:
                q["url"] = site_url(base, q["path"])
        pids[pid] = q
        pages.append(q)
    out["pages"] = pages

    # captures already made: used to check box names
    caps = {}
    for t in out["themes"]:
        mf = ROOT / "captures" / t / "meta.json"
        if mf.is_file():
            try:
                caps[t] = json.loads(mf.read_text())
            except json.JSONDecodeError:
                warnings.append(f"captures/{t}/meta.json is not valid JSON: capture again")

    # scenes and timeline (in beats)
    scenes, beat = [], 0.0
    hits, logo_b, counters, end_b, typing = [], [], [], [], []
    if len(v.get("scenes") or []) > MAX_SCENES:
        err(f"scenes: at most {MAX_SCENES}")
    for i, s in enumerate((v.get("scenes") or [])[:MAX_SCENES]):
        w = f"scenes[{i}]"
        if not isinstance(s, dict):
            err(f"{w} must be an object")
            continue
        show = s.get("show", "text")
        if show not in SHOWS:
            err(f"{w}.show: one of {', '.join(SHOWS)}")
            continue
        n = num(s.get("beats", 8), f"{w}.beats", 2, 64) or 8
        q = {"show": show, "a": beat, "b": beat + n, "beats": n}
        for k, ml in (("lead", 80), ("big", 60), ("sub", 160), ("link", 80)):
            q[k] = text(s.get(k), f"{w}.{k}", ml)
        q["alt"] = bool(s.get("alt"))
        q["brand"] = bool(s.get("brand"))
        if q["big"]:
            hits.append(beat + 1)
        if show in ("page", "phone"):
            pg = pids.get(s.get("page"))
            if not pg:
                err(f"{w}.page: the id of one of the pages")
            else:
                q["page"] = pg["id"]
                if show == "phone" and not pg["mobile"]:
                    warnings.append(f"{w}: page {pg['id']} is not \"mobile\": the phone shows the desktop layout")
            if show == "page":
                cam = s.get("camera") or [[0, 0], [n, 0]]
                good = isinstance(cam, list) and cam and all(isinstance(k, list) and 2 <= len(k) <= 4 and all(isinstance(x, (int, float)) for x in k) for k in cam)
                if not good:
                    err(f"{w}.camera: a list of [beat, scroll y, zoom, x] keys, like [[0, 0], [4, 0], [7, 600]]")
                    cam = [[0, 0]]
                q["camera"] = sorted(([k[0], k[1], k[2] if len(k) > 2 else 1, k[3] if len(k) > 3 else None] for k in cam), key=lambda k: k[0])
                if s.get("typing") is not None:
                    if not pg or not pg["typing"]:
                        err(f"{w}.typing: page {s.get('page')} needs a \"typing\" block in pages")
                    else:
                        at = num((s.get("typing") or {}).get("at", 1.5), f"{w}.typing.at", 0, n) or 1.5
                        q["typing"] = {"at": at, "cps": 9, "text": pg["typing"]["text"]}
                        typing.append({"at": beat + at, "cps": 9, "n": len(pg["typing"]["text"])})
                if s.get("highlight") is not None:
                    hl = s["highlight"]
                    if not isinstance(hl, dict) or not isinstance(hl.get("box"), str):
                        err(f'{w}.highlight: {{"box": "name from the page boxes", "at": 2}}')
                    elif pg and hl["box"] not in pg["boxes"]:
                        err(f"{w}.highlight.box {hl['box']} is not in the boxes of page {pg['id']}")
                    else:
                        q["highlight"] = {"box": hl["box"], "at": num(hl.get("at", 2), f"{w}.highlight.at", 0, n) or 2}
                        for t, m in caps.items():
                            if pg and pg["id"] in m and not (m[pg["id"]].get("boxes") or {}).get(hl["box"]):
                                warnings.append(f"{w}: box {hl['box']} was not found on the {t} capture of {pg['id']}")
            else:
                q["from"] = num(s.get("from", 0), f"{w}.from", 0) or 0
                q["to"] = num(s.get("to", 1600), f"{w}.to", 0)
                q["to"] = 1600 if q["to"] is None else q["to"]
        if show == "image":
            q["src"] = asset(s.get("src"), f"{w}.src")
            if not q["src"]:
                err(f"{w}.src is needed")
            q["frame"] = s.get("frame", "card") if s.get("frame", "card") in ("card", "none") else "card"
        if show == "numbers":
            items = s.get("items") or []
            if not isinstance(items, list) or not 1 <= len(items) <= 6:
                err(f"{w}.items: 1 to 6 numbers")
                items = []
            q["items"] = []
            step = min(1.75, max(0.5, (n - 2.5) / max(1, len(items))))
            for j, it in enumerate(items):
                wj = f"{w}.items[{j}]"
                if not isinstance(it, dict):
                    err(f"{wj} must be an object")
                    continue
                val = num(it.get("value"), f"{wj}.value", -1e15, 1e15)
                dec = int(num(it.get("decimals", 0), f"{wj}.decimals", 0, 3) or 0)
                q["items"].append({"value": val or 0, "decimals": dec, "prefix": text(it.get("prefix", ""), f"{wj}.prefix", 8) or "",
                                   "suffix": text(it.get("suffix", ""), f"{wj}.suffix", 12) or "", "label": text(it.get("label", ""), f"{wj}.label", 60) or "",
                                   "at": 1 + step * j})
                counters.append(beat + 1 + step * j)
            q["src"] = asset(s.get("image"), f"{w}.image")
            q["decimal"] = "," if str(out["language"]).lower().startswith(("it", "de", "fr", "es", "pt", "nl")) else "."
        if show == "cards":
            items = s.get("items") or []
            if not isinstance(items, list) or not 1 <= len(items) <= 4:
                err(f"{w}.items: 1 to 4 cards")
                items = []
            q["items"] = []
            for j, it in enumerate(items):
                wj = f"{w}.items[{j}]"
                if not isinstance(it, dict):
                    err(f"{wj} must be an object")
                    continue
                ic = it.get("icon", "check")
                if ic not in ICONS:
                    err(f"{wj}.icon: one of {', '.join(ICONS)}")
                    ic = "check"
                q["items"].append({"icon": ic, "title": text(it.get("title"), f"{wj}.title", 40, True) or "",
                                   "text": text(it.get("text", ""), f"{wj}.text", 80) or ""})
            q["note"] = text(s.get("note"), f"{w}.note", 100)
        if show == "code":
            q["repo"] = text(s.get("repo"), f"{w}.repo", 80, True) or ""
            lines = s.get("lines") or []
            if not isinstance(lines, list) or len(lines) > 12 or not all(isinstance(x, str) and len(x) <= 60 for x in lines):
                err(f"{w}.lines: up to 12 lines of up to 60 characters")
                lines = []
            q["lines"] = lines
            typing.append({"at": beat + 1.4, "cps": 22, "n": len(q["repo"])})
        if show == "logo":
            q["src"] = logo_ref(s.get("src", "maker"), out, f"{w}.src")
            q["caption"] = text(s.get("caption"), f"{w}.caption", 60)
            logo_b.append(beat + 0.5)
        if show == "end":
            q["url"] = text(s.get("url", out["site"]["label"]), f"{w}.url", 60) or ""
            q["repo"] = text(s.get("repo"), f"{w}.repo", 80)
            q["by"] = text(s.get("by"), f"{w}.by", 60)
            q["logo"] = logo_ref(s.get("logo"), out, f"{w}.logo") if s.get("logo") else None
            q["credit"] = text(s.get("credit"), f"{w}.credit", 200)
            end_b += [beat + 0.5, beat + 2.5]
        if show == "text" and not q["big"]:
            err(f"{w}: a text scene needs \"big\"")
        scenes.append(q)
        beat += n
    if not scenes:
        err("scenes: at least one scene")
    total_beats = beat
    out["scenes"] = scenes
    out["timeline"] = {"bpm": bpm, "beats": total_beats}
    out["googleFont"] = fam if out["font"]["google"] else None
    out["siteDir"] = SITE_DIR[0]

    if errors:
        print("video.json has problems:")
        for e in errors:
            print("  -", e)
        return 1

    secs = total_beats * 60 / bpm
    b = out_dir("build")
    write_file(b / "data.json", json.dumps(out, indent=1, ensure_ascii=False))
    write_file(b / "data.js", "window.VIDEO = " + json.dumps(out, ensure_ascii=False).replace("<", "\\u003c") + ";\n")
    tl = {"bpm": bpm, "beats": total_beats, "mood": mood, "key": KEYS[key], "hits": hits, "logo": logo_b, "counters": counters,
          "end": end_b, "typing": typing, "scenes": [[s["a"], s["b"], s["show"]] for s in scenes]}
    write_file(b / "timeline.json", json.dumps(tl, indent=1))

    print(f"{name}: {len(scenes)} scenes, {total_beats:g} beats at {bpm:g} BPM = {secs:.1f} s, formats {', '.join(out['formats'])}, themes {', '.join(out['themes'])}")
    for s in scenes:
        label = (s.get("lead") or "") + " " + (s.get("big") or "").replace("\n", " ")
        print(f"  {s['a'] * 60 / bpm:6.2f}-{s['b'] * 60 / bpm:6.2f} s  {s['show']:<8} {label.strip()[:60]}")
    if "9x16" in out["formats"] and secs > 90:
        warnings.append(f"{secs:.0f} s is long for a Reel or a Short: 30 to 75 s keeps people watching")
    missing = [p["id"] for p in pages if p["url"] and any(p["id"] not in caps.get(t, {}) for t in out["themes"])]
    if missing:
        warnings.append("not captured yet: " + ", ".join(missing) + " (run node engine/capture.mjs)")
    for wmsg in warnings:
        print("  note:", wmsg)
    return 0


def out_dir(*parts):
    """an output folder inside the video folder; refuses one that is (or sits under) a symlink or leaves the folder"""
    d = ROOT
    for part in parts:
        d = d / part
        if d.is_symlink():
            sys.exit(f"{d.relative_to(ROOT)} is a symlink: remove it (output folders must be real folders inside the video folder)")
    d.mkdir(parents=True, exist_ok=True)
    if ROOT not in d.resolve().parents:
        sys.exit(f"{d} is outside the video folder")
    return d


def write_file(path, text):
    """write without following a symlink planted at the name: a fresh temp file, then a rename over the name"""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".lv-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def logo_ref(val, out, what):
    """"maker" or "product" (their logos), or an asset path"""
    if val in ("maker", "product"):
        lg = out[val]
        if not lg["logo"]:
            err(f"{what}: {val}.logo is not set")
            return None
        return {"light": lg["logo"], "dark": lg["logoDark"] or lg["logo"]}
    a = asset(val, what)
    return {"light": a, "dark": a} if a else None


if __name__ == "__main__":
    sys.exit(main())
