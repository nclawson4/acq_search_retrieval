"""Scene detection + keyframe extraction via PySceneDetect + ffmpeg."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image
from scenedetect import ContentDetector, detect

MAX_WIDTH = 600
JPEG_QUALITY = 82


@dataclass
class Keyframe:
    t_s: float
    path: Path


def _extract_frame(video_path: Path, t_s: float, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{t_s:.3f}", "-i", str(video_path),
            "-frames:v", "1", "-q:v", "3",
            str(dst),
        ],
        check=True,
    )


def _resize(jpg: Path) -> None:
    with Image.open(jpg) as im:
        im = im.convert("RGB")
        if im.width > MAX_WIDTH:
            new_h = int(im.height * (MAX_WIDTH / im.width))
            im = im.resize((MAX_WIDTH, new_h), Image.LANCZOS)
        im.save(jpg, "JPEG", quality=JPEG_QUALITY, optimize=True)


def extract_keyframes(video_path: Path, out_dir: Path, threshold: float = 27.0) -> list[Keyframe]:
    """Detect scenes, then extract one keyframe at the midpoint of each scene."""
    out_dir.mkdir(parents=True, exist_ok=True)
    scenes = detect(str(video_path), ContentDetector(threshold=threshold))

    keyframes: list[Keyframe] = []
    if not scenes:
        return keyframes

    for idx, (start_tc, end_tc) in enumerate(scenes):
        mid_s = (start_tc.get_seconds() + end_tc.get_seconds()) / 2.0
        dst = out_dir / f"{idx:05d}_{mid_s:.2f}.jpg"
        _extract_frame(video_path, mid_s, dst)
        _resize(dst)
        keyframes.append(Keyframe(t_s=mid_s, path=dst))

    return keyframes
