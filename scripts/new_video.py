"""Start a launch video folder: a copy of the engine, a video.json to fill in, an assets folder.

    python3 scripts/new_video.py <folder>              a new video from templates/video.json
    python3 scripts/new_video.py <folder> --example    the fictional demo (Brightwater Budget) with its own local site
    python3 scripts/new_video.py <folder> --update     refresh only the engine of an existing video folder

The folder must not exist yet (or be empty), unless --update. Nothing outside it is written.
"""
import json
import pathlib
import shutil
import sys

SKILL = pathlib.Path(__file__).resolve().parent.parent
MARK = ".launch-video"


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    flags = {a for a in argv if a.startswith("--")}
    unknown = flags - {"--example", "--update"}
    if len(args) != 1 or unknown:
        print(__doc__)
        return 2
    dest = pathlib.Path(args[0]).expanduser().resolve()
    if "--update" in flags:
        if not (dest / MARK).is_file():
            print(f"{dest} is not a launch video folder (no {MARK} file)")
            return 1
        shutil.rmtree(dest / "engine")
        shutil.copytree(SKILL / "engine", dest / "engine", ignore=shutil.ignore_patterns("__pycache__"))
        print("engine updated in", dest)
        return 0
    if dest.exists() and any(dest.iterdir()):
        print(f"{dest} exists and is not empty: pick a new folder")
        return 1
    if SKILL == dest or SKILL in dest.parents:
        print("make the video folder outside the skill folder")
        return 1
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SKILL / "engine", dest / "engine", ignore=shutil.ignore_patterns("__pycache__"))
    if "--example" in flags:
        ex = SKILL / "examples" / "demo"
        shutil.copytree(ex / "assets", dest / "assets")
        shutil.copytree(ex / "site", dest / "site")
        shutil.copy(ex / "video.json", dest / "video.json")
    else:
        (dest / "assets").mkdir()
        v = json.loads((SKILL / "templates" / "video.json").read_text(encoding="utf-8"))
        v["name"] = "".join(c if c.isalnum() else "-" for c in dest.name.lower()).strip("-")[:48] or "launch-video"
        (dest / "video.json").write_text(json.dumps(v, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (dest / MARK).write_text("made with the launch-video skill; engine/ is a copy, refresh it with new_video.py --update\n")
    (dest / ".gitignore").write_text("build/\ncaptures/\npreviews/\nout/\naudio/\n")
    print("video folder ready:", dest)
    print("next: edit video.json, then from that folder:")
    print("  python3 engine/build.py && node engine/capture.mjs && python3 engine/music.py && node engine/render.mjs sheet --format all")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
