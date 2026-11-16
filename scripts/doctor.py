"""Check that this machine can make launch videos: Node 22+, Python 3.9+ with numpy, ffmpeg with x264, Chrome or Chromium.

    python3 scripts/doctor.py

Prints one line per check (ok / MISSING) with the fix. Exit code 1 if something required is missing.
"""
import os
import pathlib
import platform
import shutil
import subprocess
import sys

mac = platform.system() == "Darwin"
bad = 0


def line(ok, what, fix="", required=True):
    global bad
    print(f"{'ok     ' if ok else ('MISSING' if required else 'note   ')} {what}" + ("" if ok or not fix else f"  ->  {fix}"))
    if not ok and required:
        bad += 1


def out(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


v = out(["node", "--version"])
try:
    major = int(v.lstrip("v").split(".")[0]) if v else 0
except ValueError:
    major = 0
line(major >= 22, f'Node {v or "not found"} (22 or newer, for its built-in WebSocket)', "brew install node" if mac else "install Node 22+ from nodejs.org")
line(sys.version_info >= (3, 9), f"Python {platform.python_version()} (3.9 or newer)", "install a newer Python")
try:
    import numpy  # noqa: F401
    line(True, "numpy (for the music)")
except ImportError:
    line(False, "numpy (for the music)", f"{sys.executable} -m pip install numpy")

ff = next((c for c in (os.environ.get("FFMPEG"), str(pathlib.Path.home() / ".local/bin/ffmpeg"), shutil.which("ffmpeg")) if c and os.path.isfile(c)), None)
line(bool(ff), f'ffmpeg{": " + ff if ff else ""}', "brew install ffmpeg" if mac else "sudo apt install ffmpeg (or set FFMPEG=/path/to/ffmpeg)")
if ff:
    enc = out([ff, "-hide_banner", "-encoders"])
    line("libx264" in enc, "ffmpeg with libx264 (H.264 video)", "install an ffmpeg build with libx264")
    line(" aac " in enc or "aac" in enc, "ffmpeg with an AAC encoder", "install a full ffmpeg build")
    line("ebur128" in out([ff, "-hide_banner", "-filters"]), "ffmpeg ebur128 filter (music loudness)", "install a full ffmpeg build")

chromes = [os.environ.get("CHROME_PATH", ""), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
           "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
           "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
found = next((c for c in chromes if c and os.path.exists(c)), None)
line(bool(found), f'Chrome or Chromium{": " + found if found else ""}', "install Google Chrome, or set CHROME_PATH")
print("\nready" if not bad else f"\n{bad} required item(s) missing")
sys.exit(1 if bad else 0)
