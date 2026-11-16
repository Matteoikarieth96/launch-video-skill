"""launch-video music: synthesises an original soundtrack in time with the video (no samples, no third-party audio).

    python3 engine/music.py            (from the video folder, after python3 engine/build.py)

Reads build/timeline.json (tempo, key, mood, and the beats of titles, logos, counters, typing and the end card)
and writes audio/music.wav (48 kHz stereo, 24-bit), mastered to about -14 LUFS with true peak under -1 dBTP
(measured with ffmpeg's ebur128 filter, the loudness YouTube, Instagram and TikTok normalise to).
Moods: calm (soft pads, plucked arpeggio, light groove), bright (fuller groove, four-on-the-floor), minimal (pads and
a few notes, no drums), none (no music: the render uses silence). Needs numpy and ffmpeg.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import wave

import numpy as np

ENGINE = pathlib.Path(__file__).resolve().parent
ROOT = ENGINE.parent
SR = 48000


def find_ffmpeg():
    for c in (os.environ.get("FFMPEG"), str(pathlib.Path.home() / ".local/bin/ffmpeg"), shutil.which("ffmpeg")):
        if c and pathlib.Path(c).is_file():
            return c
    sys.exit("ffmpeg not found: install it (brew install ffmpeg) or set FFMPEG=/path/to/ffmpeg")


TLF = ROOT / "build" / "timeline.json"
if not TLF.is_file():
    sys.exit("build/timeline.json missing: run python3 engine/build.py first")
TL = json.loads(TLF.read_text())
BPM, MOOD = TL["bpm"], TL["mood"]
BEAT = 60 / BPM
BAR = 4 * BEAT
TOTAL = TL["beats"] * BEAT
N = int(round(TOTAL * SR))
NBARS = int(np.ceil(TL["beats"] / 4))
SHIFT = (TL["key"] - 2 + 5) % 12 - 5          # the chords below are in D; move them to the chosen key (-5..+6)
rng = np.random.default_rng(2026)


def mtof(m):
    return 440.0 * 2 ** ((m + SHIFT - 69) / 12)


def bus():
    return np.zeros((N, 2), np.float64)


def put(b, x, t, g=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N or len(x) == 0:
        return
    if i < 0:
        x, i = x[-i:], 0
    x = np.asarray(x, np.float64)
    if x.ndim == 1:
        a = (pan + 1) * np.pi / 4
        x = np.stack([x * np.cos(a), x * np.sin(a)], 1) * 1.41421356
    n = min(len(x), N - i)
    b[i:i + n] += x[:n] * g


# ---------- filters (zero-phase, in the frequency domain, Butterworth-shaped magnitude) ----------
def _filt(x, resp):
    x = np.asarray(x, np.float64)
    n = len(x)
    pad = min(n, int(0.1 * SR))
    m = 1 << int(np.ceil(np.log2(n + pad)))
    f = np.fft.rfftfreq(m, 1 / SR)
    h = resp(np.maximum(f, 1e-3))
    X = np.fft.rfft(x, m, axis=0)
    X *= h[:, None] if x.ndim == 2 else h
    return np.fft.irfft(X, m, axis=0)[:n]


def lp(x, fc, order=2):
    fc = min(fc, SR * 0.45)
    return _filt(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))


def hp(x, fc, order=2):
    return _filt(x, lambda f: 1 / np.sqrt(1 + (fc / f) ** (2 * order)))


def bp(x, lo, hi, order=2):
    return _filt(x, lambda f: 1 / np.sqrt((1 + (f / hi) ** (2 * order)) * (1 + (lo / f) ** (2 * order))))


def tt(n):
    return np.arange(n) / SR


def adsr(n, a, d, s, r):
    e = np.ones(n) * s
    na = min(int(a * SR), n)
    e[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(int(d * SR), n - na)
    e[na:na + nd] = np.linspace(1, s, nd, endpoint=False)
    nr = min(int(r * SR), n)
    if nr > 0:
        e[n - nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e


# ---------- instruments ----------
def saw(ph):
    return 2 * ((ph / (2 * np.pi)) % 1.0) - 1


def pad(midis, dur, bright=1400, a=1.2, r=1.6):
    n = int((dur + r) * SR)
    t = tt(n)
    out = np.zeros((n, 2))
    for k, m in enumerate(midis):
        f = mtof(m)
        for j, det in enumerate((-0.07, 0.0, 0.07)):
            ph = 2 * np.pi * f * 2 ** (det / 12) * t + rng.random() * 2 * np.pi
            x = saw(ph) * 0.6 + np.sin(ph) * 0.4
            pan = -0.6 + 1.2 * ((k * 3 + j) % 7) / 6
            out[:, 0] += x * np.cos((pan + 1) * np.pi / 4)
            out[:, 1] += x * np.sin((pan + 1) * np.pi / 4)
    out = lp(out, bright, 2)
    e = adsr(n, a, 0.5, 0.85, r) * (1 + 0.08 * np.sin(2 * np.pi * 0.23 * t))
    return out * e[:, None] / (len(midis) * 3)


def pluck(m, dur=0.5, bright=3200):
    n = int(dur * SR)
    t = tt(n)
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 18) + 0.12 * np.sin(6 * np.pi * f * t) * np.exp(-t * 30)
    return lp(x * (1 - np.exp(-t * 900)) * np.exp(-t * 7.5), bright) * 0.5


def mallet(m, dur=1.6):
    t = tt(int(dur * SR))
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 3.2) + 0.5 * np.sin(2 * np.pi * f * 3.99 * t) * np.exp(-t * 11) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6)
    return x * (1 - np.exp(-t * 2000)) * 0.6


def bell(m, dur=3.5):
    t = tt(int(dur * SR))
    f = mtof(m)
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in ((1, 1, 1.4), (2.76, 0.35, 3.5), (5.4, 0.18, 6), (8.93, 0.08, 9)))
    return x * (1 - np.exp(-t * 3000)) * 0.45


def sub(m, dur):
    n = int(dur * SR)
    t = tt(n)
    f = mtof(m)
    return (np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)) * adsr(n, 0.04, 0.3, 0.8, 0.25) * 0.55


def kick():
    n = int(0.4 * SR)
    t = tt(n)
    f = 46 + 70 * np.exp(-t * 32)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    return (x + lp(rng.standard_normal(n), 2500) * np.exp(-t * 300) * 0.15) * 0.8


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    return hp(rng.standard_normal(n), 7000, 2) * np.exp(-tt(n) * (22 if open_ else 80)) * 0.22


def shaker():
    n = int(0.09 * SR)
    t = tt(n)
    return bp(rng.standard_normal(n), 4500, 11000) * np.sin(np.pi * np.clip(t / 0.09, 0, 1)) ** 2 * 0.12


def rim():
    n = int(0.12 * SR)
    t = tt(n)
    return (bp(rng.standard_normal(n), 1500, 5000) * np.exp(-t * 60) + 0.4 * np.sin(2 * np.pi * 820 * t) * np.exp(-t * 70)) * 0.3


def clap():
    n = int(0.25 * SR)
    t = tt(n)
    env = sum(np.exp(-np.clip(t - d, 0, None) * 90) * (t >= d) for d in (0, 0.008, 0.017)) + 0.5 * np.exp(-t * 14)
    return bp(rng.standard_normal(n), 900, 6000) * env * 0.22


def swell(dur=0.45):
    n = int(dur * SR)
    return bp(rng.standard_normal((n, 2)), 600, 6000) * ((tt(n) / dur) ** 2.4)[:, None] * 0.12


def thump():
    t = tt(int(0.6 * SR))
    return np.sin(2 * np.pi * (52 + 30 * np.exp(-t * 20)) * t) * np.exp(-t * 7) * 0.5


def tick():
    n = int(0.03 * SR)
    return bp(rng.standard_normal(n), 2500, 7000) * np.exp(-tt(n) * 260) * 0.35


def reverb(x, dur=2.6, tau=0.55, seed=11):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    ir = lp(r.standard_normal((n, 2)) * np.exp(-tt(n) / tau)[:, None], 5000)
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(0))
    m = 1 << int(np.ceil(np.log2(len(x) + n)))
    return np.stack([np.fft.irfft(np.fft.rfft(x[:, c], m) * np.fft.rfft(ir[:, c], m), m)[:N] for c in range(2)], 1)


# ---------- the song ----------
# per mood: (bass, pad voicing, 8 arpeggio notes) for 4 chords, in D
CHORDS = {
    "calm": [(50, [54, 57, 61, 64], [62, 66, 69, 73, 76, 73, 69, 66]),     # Dmaj9
             (47, [57, 61, 62, 66], [59, 62, 66, 69, 73, 69, 66, 62]),     # Bm9
             (43, [59, 62, 66, 69], [55, 59, 62, 66, 69, 66, 62, 59]),     # Gmaj9
             (45, [57, 62, 64, 67], [57, 62, 64, 67, 69, 67, 64, 62])],    # A7sus4
    "bright": [(50, [54, 57, 62, 66], [62, 66, 69, 74, 78, 74, 69, 66]),   # D
               (45, [57, 61, 64, 69], [57, 61, 64, 69, 73, 69, 64, 61]),   # A
               (47, [54, 59, 62, 66], [59, 62, 66, 71, 74, 71, 66, 62]),   # Bm
               (43, [55, 59, 62, 67], [55, 59, 62, 67, 71, 67, 62, 59])],  # G
}
CHORDS["minimal"] = CHORDS["calm"]
SCENES = TL["scenes"]
END_BEAT = next((a for a, b, s in SCENES if s == "end"), max(0, TL["beats"] - 8))
LIGHT = [(a, b) for a, b, s in SCENES if s in ("code", "logo")]   # lighter groove under these


def level(bar):
    """0..1 intensity per bar: a quiet start, a build, the full groove, lighter under code and logo scenes."""
    b0 = bar * 4
    if b0 >= END_BEAT:
        return 0.0
    if bar < 2:
        return 0.0
    if bar < 4:
        return 0.35
    if bar < 6:
        return 0.7
    if any(a <= b0 + 2 < b for a, b in LIGHT):
        return 0.55
    return 1.0


def main():
    if MOOD == "none":
        f = ROOT / "audio" / "music.wav"
        if f.is_file():
            f.unlink()
        print('music.mood is "none": no music, the video gets silence')
        return
    ch = CHORDS[MOOD]
    pads, arps, bass, drums, hits, ticks = bus(), bus(), bus(), bus(), bus(), bus()
    end_t = END_BEAT * BEAT
    for bar in range(NBARS):
        t0 = bar * BAR
        if t0 >= end_t:
            break
        bassm, voicing, arp = ch[bar % 4]
        lv = level(bar)
        span = min(BAR, end_t - t0)
        put(pads, pad(voicing, span + 0.1, bright=900 + 900 * lv + (400 if MOOD == "bright" else 0), a=0.9 if bar else 2.0, r=1.2), t0, 0.9)
        if MOOD == "minimal":
            if bar >= 1:
                for k in (0, 3, 6):
                    if t0 + k * BEAT / 2 < end_t:
                        put(arps, pluck(arp[k], 0.9), t0 + k * BEAT / 2, 0.36, pan=0.3 * np.sin(k + bar))
            if bar >= 2:
                put(bass, sub(bassm, span * 0.95), t0, 0.3)
            continue
        if bar >= 2:
            for k in range(8):
                if t0 + k * BEAT / 2 >= end_t:
                    break
                vel = 0.75 + 0.25 * (k % 2 == 0)
                up = 12 if bar % 8 >= 4 and k in (3, 4) else 0
                put(arps, pluck(arp[k] + up), t0 + k * BEAT / 2, 0.42 * vel * (0.6 + 0.4 * lv), pan=0.35 * np.sin(k * 1.3))
            put(bass, sub(bassm, span * 0.95), t0, 0.55 * (0.5 + 0.5 * lv))
        beats_here = [k for k in range(4) if t0 + k * BEAT < end_t - 0.05]
        if lv >= 0.7:
            kicks = (0, 1, 2, 3) if MOOD == "bright" else (0, 2)
            for k in kicks:
                if k in beats_here:
                    put(drums, kick(), t0 + k * BEAT, 0.55 * lv)
            for k in (1, 3):
                if k in beats_here:
                    put(drums, clap() if MOOD == "bright" else rim(), t0 + k * BEAT, 0.32 * lv, pan=0.15)
            for k in range(8):
                if t0 + k * BEAT / 2 + BEAT / 4 < end_t:
                    put(drums, hat(open_=(k % 4 == 3)), t0 + k * BEAT / 2 + BEAT / 4, 0.35 * lv, pan=-0.25)
        if lv >= 0.35:
            for k in range(16):
                if t0 + k * BEAT / 4 < end_t:
                    put(drums, shaker(), t0 + k * BEAT / 4, (0.5 + 0.5 * (k % 2)) * 0.5 * lv, pan=0.3)
    # the end card: one long chord to the end
    if end_t < TOTAL:
        bassm, voicing, _ = ch[0]
        put(pads, pad(voicing + [69], max(1.0, TOTAL - end_t - 1.4), bright=1100, a=0.6, r=2.2), end_t, 0.95)
        put(bass, sub(bassm, max(1.0, TOTAL - end_t - 0.6)), end_t, 0.45)

    # title hits: the big word lands one beat after its scene starts
    for b in TL["hits"]:
        t = b * BEAT
        voicing = ch[int(b // 4) % 4][1]
        put(hits, swell(), t - 0.45, 0.9)
        for k, m in enumerate(voicing[1:]):
            put(hits, mallet(m + 12), t + k * 0.012, 0.32, pan=-0.3 + 0.3 * k)
        put(hits, thump(), t, 0.5)
    for b in TL["logo"]:
        put(hits, bell(74), b * BEAT, 0.55, pan=-0.1)
        put(hits, bell(81), b * BEAT + 0.02, 0.3, pan=0.2)
    for j, b in enumerate(TL["counters"]):          # rising notes, one per counter
        put(hits, mallet([69, 71, 73, 74, 76, 78][j % 6] + 12), b * BEAT, 0.4, pan=-0.2 + 0.1 * (j % 5))
    for b in TL["end"]:
        t = b * BEAT
        put(hits, swell(0.6), t - 0.6, 0.8)
        for m in (62, 66, 69, 74):
            put(hits, bell(m + 12), t, 0.28)
    for ty in TL["typing"]:                         # a soft tick per typed character
        for k in range(ty["n"]):
            put(ticks, tick(), ty["at"] * BEAT + k / ty["cps"] + 0.004 * rng.standard_normal(), 0.5, pan=0.2 * rng.standard_normal())

    dry = pads * 0.9 + arps * 0.85 + bass * 0.9 + drums * 0.8 + hits * 0.9 + ticks * 0.55
    wet = reverb(pads * 0.5 + arps * 0.6 + hits * 0.8 + drums * 0.15)
    mix = hp(dry + wet * 0.35, 28, 2)
    t = tt(N)
    mix *= (np.clip((TOTAL - t) / 2.6, 0, 1) ** 1.6)[:, None]       # gentle ending
    mix *= np.clip(t / 0.03, 0, 1)[:, None]                         # never start with a click
    master(mix)


# ---------- mastering ----------
def write_wav(path, x):
    a = np.clip(x, -1, 1)
    pcm = np.round(a * 8388607).astype("<i4").view(np.uint8).reshape(-1, 4)[:, :3]
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def measure(ff, path):
    r = subprocess.run([ff, "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    s = r[r.rfind("Summary:"):]
    I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", s).group(1))
    TP = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", s).group(1))
    return I, TP


def limit(x, ceiling_db, release=0.12):
    """peak limiter: gain from the 4x oversampled peak, 4 ms lookahead, smooth release"""
    ceil = 10 ** (ceiling_db / 20)
    m = 1 << int(np.ceil(np.log2(len(x))))
    X = np.fft.rfft(x, m, axis=0)
    up = np.fft.irfft(X, 4 * m, axis=0)[: 4 * len(x)] * 4          # band-limited 4x upsample
    pk = np.abs(up).max(1).reshape(-1, 4).max(1)[: len(x)]
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    la = int(0.004 * SR)
    padded = np.pad(need, la, constant_values=1.0)
    g = np.lib.stride_tricks.sliding_window_view(padded, 2 * la + 1).min(1)
    a = np.exp(-1 / (release * SR))
    out = np.empty_like(g)
    cur = 1.0
    idx = np.flatnonzero(g < 1.0)
    if not len(idx):
        return x
    # run the one-pole release only where the gain is below 1 (and for a while after)
    out[:] = 1.0
    i, n = idx[0], len(g)
    while i < n:
        v = g[i]
        cur = v if v < cur else a * cur + (1 - a) * v
        out[i] = cur
        i += 1
        if cur > 0.99999 and (i >= n or g[i] >= 1.0):
            cur = 1.0
            nxt = np.searchsorted(idx, i)
            if nxt >= len(idx):
                break
            i = idx[nxt]
    return x * out[:, None]


def master(mix):
    ff = find_ffmpeg()
    out = ROOT / "audio"
    out.mkdir(exist_ok=True)
    tmp = out / "_tmp.wav"
    x = mix / (np.abs(mix).max() + 1e-9) * 0.5
    ceiling = -1.4
    try:
        for it in range(6):
            write_wav(tmp, x)
            I, TP = measure(ff, tmp)
            print(f"pass {it}: {I:.2f} LUFS, true peak {TP:.2f} dBTP")
            if abs(I + 14) < 0.2 and TP < -1.0:
                break
            if TP >= -1.0 and abs(I + 14) < 0.2:
                ceiling -= 0.3
            x = limit(x * 10 ** ((-14 - I) / 20), ceiling)
    finally:
        tmp.unlink(missing_ok=True)
    write_wav(out / "music.wav", x)
    I, TP = measure(ff, out / "music.wav")
    print(f"audio/music.wav  {TOTAL:.2f} s  {MOOD}, {BPM:g} BPM  {I:.2f} LUFS  true peak {TP:.2f} dBTP")
    if TP >= -1.0:
        print("  note: true peak is above -1 dBTP: run again or lower the mood's level")


if __name__ == "__main__":
    main()
