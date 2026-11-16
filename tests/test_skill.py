"""Offline tests for the launch-video skill (no Chrome, no ffmpeg needed).

    python3 -m unittest discover -s tests -v
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

SKILL = pathlib.Path(__file__).resolve().parent.parent


def make(tmp, example=True):
    d = pathlib.Path(tmp) / "video"
    r = subprocess.run([sys.executable, str(SKILL / "scripts" / "new_video.py"), str(d)] + (["--example"] if example else []),
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    return d


def build(d):
    return subprocess.run([sys.executable, "engine/build.py"], cwd=d, capture_output=True, text=True)


class NewVideo(unittest.TestCase):
    def test_example_builds(self):
        with tempfile.TemporaryDirectory() as t:
            d = make(t)
            r = build(d)
            self.assertEqual(r.returncode, 0, r.stdout)
            data = json.loads((d / "build" / "data.json").read_text())
            self.assertEqual(data["formats"], ["16x9", "9x16"])
            self.assertTrue(data["pages"][0]["url"].startswith("file://"))
            tl = json.loads((d / "build" / "timeline.json").read_text())
            self.assertEqual(tl["beats"], sum(s["beats"] for s in data["scenes"]))
            self.assertTrue(tl["hits"] and tl["typing"] and tl["counters"] and tl["end"])
            js = (d / "build" / "data.js").read_text()
            self.assertNotIn("<", js.split("=", 1)[1])

    def test_template_builds(self):
        with tempfile.TemporaryDirectory() as t:
            d = make(t, example=False)
            r = build(d)
            self.assertEqual(r.returncode, 0, r.stdout)
            self.assertIn("not captured yet", r.stdout)

    def test_refuses_non_empty_folder(self):
        with tempfile.TemporaryDirectory() as t:
            (pathlib.Path(t) / "video").mkdir()
            (pathlib.Path(t) / "video" / "x.txt").write_text("x")
            r = subprocess.run([sys.executable, str(SKILL / "scripts" / "new_video.py"), str(pathlib.Path(t) / "video")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)

    def test_update_engine(self):
        with tempfile.TemporaryDirectory() as t:
            d = make(t)
            (d / "engine" / "core.js").write_text("old")
            r = subprocess.run([sys.executable, str(SKILL / "scripts" / "new_video.py"), str(d), "--update"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout)
            self.assertEqual((d / "engine" / "core.js").read_text(), (SKILL / "engine" / "core.js").read_text())


class Validation(unittest.TestCase):
    def check(self, mutate, needle):
        with tempfile.TemporaryDirectory() as t:
            d = make(t)
            v = json.loads((d / "video.json").read_text())
            mutate(v)
            (d / "video.json").write_text(json.dumps(v))
            r = build(d)
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertIn(needle, r.stdout)

    def test_asset_outside_folder(self):
        self.check(lambda v: v["product"].update(logo="../../etc/hosts.png"), "outside the video folder")

    def test_absolute_asset(self):
        self.check(lambda v: v["product"].update(logo="/etc/passwd"), "inside the video folder")

    def test_css_with_tag(self):
        self.check(lambda v: v["pages"][0].update(css="</style><script>alert(1)</script>"), "must not contain <")

    def test_hide_with_brace(self):
        self.check(lambda v: v["pages"][0].update(hide=["a{color:red}"]), "without braces")

    def test_unknown_show(self):
        self.check(lambda v: v["scenes"].append({"show": "video"}), "show: one of")

    def test_unknown_icon(self):
        self.check(lambda v: v["scenes"][7]["items"][0].update(icon="rocket"), "icon: one of")

    def test_bad_colour(self):
        self.check(lambda v: v["colors"]["light"].update(accent="red"), "must be a colour")

    def test_bad_name(self):
        self.check(lambda v: v.update(name="My Video!"), "name:")

    def test_page_leaves_site(self):
        self.check(lambda v: v["pages"][0].update(path="../../../etc/passwd"), "leaves the site folder")

    def test_bad_url_scheme(self):
        self.check(lambda v: v["site"].update(url="javascript:alert(1)"), "must start with")

    def test_highlight_unknown_box(self):
        self.check(lambda v: v["scenes"][4]["highlight"].update(box="nope"), "is not in the boxes")


class Engine(unittest.TestCase):
    def test_every_show_has_a_drawer(self):
        src = (SKILL / "engine" / "scenes.js").read_text()
        shows = re.search(r"SHOWS = \(([^)]*)\)", (SKILL / "engine" / "build.py").read_text()).group(1)
        for s in re.findall(r'"(\w+)"', shows):
            self.assertIn(f"SHOW.{s} = ", src, s)

    def test_every_icon_is_drawn(self):
        src = (SKILL / "engine" / "scenes.js").read_text()
        icons = re.search(r"ICONS = \(([^)]*)\)", (SKILL / "engine" / "build.py").read_text()).group(1)
        for i in re.findall(r'"(\w+)"', icons):
            self.assertIn(f"case '{i}'", src, i)

    def test_chrome_flags(self):
        src = (SKILL / "engine" / "chrome.mjs").read_text()
        for flag in ("--use-mock-keychain", "--password-store=basic", "--headless=new"):
            self.assertIn(flag, src)

    def test_master_quality(self):
        src = (SKILL / "engine" / "render.mjs").read_text()
        for k in ("'-crf', '10'", "bt709", "'-b:a', '320k'", "image2pipe"):
            self.assertIn(k, src)

    def test_example_is_fictional(self):
        v = json.loads((SKILL / "examples" / "demo" / "video.json").read_text())
        self.assertTrue(v["site"]["label"].endswith(".example"))
        self.assertIn("github.com/example/", json.dumps(v))


class Music(unittest.TestCase):
    def test_music_loudness(self):
        if not FFMPEG:
            self.skipTest("ffmpeg not installed")
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("numpy not installed")
        with tempfile.TemporaryDirectory() as t:
            d = make(t)
            v = json.loads((d / "video.json").read_text())
            v["scenes"] = v["scenes"][:2] + v["scenes"][-1:]
            (d / "video.json").write_text(json.dumps(v))
            self.assertEqual(build(d).returncode, 0)
            r = subprocess.run([sys.executable, "engine/music.py"], cwd=d, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            m = re.search(r"(-?[\d.]+) LUFS\s+true peak (-?[\d.]+) dBTP", r.stdout.splitlines()[-1])
            self.assertAlmostEqual(float(m.group(1)), -14, delta=0.5)
            self.assertLess(float(m.group(2)), -0.9)


def find_chrome():
    import os
    for c in (os.environ.get("CHROME_PATH"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
              "/usr/bin/chromium", "/usr/bin/chromium-browser"):
        if c and pathlib.Path(c).exists():
            return c
    return None


def node_ok():
    try:
        v = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
        return int(v.lstrip("v").split(".")[0]) >= 22
    except (OSError, ValueError):
        return False


def png_size(path):
    b = pathlib.Path(path).read_bytes()[:24]
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    return int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big")


def find_ffmpeg():
    import os
    for c in (os.environ.get("FFMPEG"), shutil.which("ffmpeg"), str(pathlib.Path.home() / ".local/bin/ffmpeg")):
        if c and pathlib.Path(c).is_file():
            return c
    return None


FFMPEG = find_ffmpeg()
HAVE_PIPELINE = bool(find_chrome() and node_ok() and FFMPEG)


class Pipeline(unittest.TestCase):
    """capture -> music -> stills and a short full render, on the fictional demo (needs Chrome, Node 22+, ffmpeg)"""

    @classmethod
    def setUpClass(cls):
        import os
        if not HAVE_PIPELINE:
            if os.environ.get("REQUIRE_PIPELINE") == "1":
                raise AssertionError("REQUIRE_PIPELINE=1 but Chrome, Node 22+ or ffmpeg is missing")
            raise unittest.SkipTest("Chrome, Node 22+ or ffmpeg not installed")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.d = make(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_in(self, *cmd, timeout=600):
        r = subprocess.run(list(cmd), cwd=self.d, capture_output=True, text=True, timeout=timeout)
        self.assertEqual(r.returncode, 0, r.stdout[-2000:] + r.stderr[-2000:])
        return r.stdout

    def test_1_capture_and_stills(self):
        self.run_in(sys.executable, "engine/build.py")
        out = self.run_in("node", "engine/capture.mjs")
        self.assertIn("capture dark home", out)
        meta = json.loads((self.d / "captures" / "light" / "meta.json").read_text())
        self.assertIn("home@typed", meta)
        self.assertTrue(meta["home"]["boxes"]["explore"], "the highlight box was found")
        self.run_in(sys.executable, "engine/build.py")
        for fmt, size in (("16x9", (1920, 1080)), ("9x16", (1080, 1920))):
            for theme in ("light", "dark"):
                out = self.run_in("node", "engine/render.mjs", "still", "10.5", "16", "47", "--format", fmt, "--theme", theme)
                ready = json.loads(re.search(r"ready \S+ \S+ (\{.*\})", out).group(1))
                self.assertEqual(ready["warnings"], [], f"{fmt} {theme}")
                for t in ("10.50", "16.00", "47.00"):
                    self.assertEqual(png_size(self.d / "previews" / f"{fmt}-{theme}" / f"t{t}.png"), size)

    def test_2_short_full_render(self):
        v = json.loads((self.d / "video.json").read_text())
        v["scenes"] = [v["scenes"][1], v["scenes"][2], v["scenes"][-1]]
        (self.d / "video.json").write_text(json.dumps(v))
        self.run_in(sys.executable, "engine/build.py")
        if not (self.d / "captures" / "light" / "meta.json").is_file():
            self.run_in("node", "engine/capture.mjs", "--theme", "light")
        self.run_in(sys.executable, "engine/music.py")
        self.run_in("node", "engine/render.mjs", "full", "--format", "9x16", "--theme", "light", timeout=900)
        mp4 = self.d / "out" / f"{v['name']}-9x16-light.mp4"
        self.assertTrue(mp4.is_file())
        info = subprocess.run([FFMPEG, "-hide_banner", "-i", str(mp4)], capture_output=True, text=True).stderr
        self.assertIn("1080x1920", info)
        self.assertIn("bt709", info)
        self.assertIn("Audio: aac", info)


if __name__ == "__main__":
    unittest.main()
