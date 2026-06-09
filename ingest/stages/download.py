"""Download stage: yt-dlp for video + low-bitrate audio + metadata."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import yt_dlp


@dataclass
class DownloadResult:
    video_id: str
    title: str
    channel: str
    duration_s: float
    url: str
    video_path: Path
    audio_path: Path
    info_path: Path


def _ydl_opts_video(out_dir: Path) -> dict:
    return {
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best",
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "writeinfojson": True,
        "writethumbnail": False,
        "noprogress": True,
    }


def _ydl_opts_audio(out_dir: Path) -> dict:
    # Mono, 16 kHz, 32 kbps mp3 — ~14 MB per hour. Safe under Whisper's 25 MB limit
    # for videos up to ~100 minutes; longer videos are chunked downstream.
    return {
        "outtmpl": str(out_dir / "%(id)s.audio.%(ext)s"),
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "32",
            }
        ],
        "postprocessor_args": ["-ac", "1", "-ar", "16000"],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }


def download(url: str, out_dir: Path) -> DownloadResult:
    out_dir.mkdir(parents=True, exist_ok=True)

    with yt_dlp.YoutubeDL(_ydl_opts_video(out_dir)) as ydl:
        info = ydl.extract_info(url, download=True)

    video_id = info["id"]
    title = info.get("title", "")
    channel = info.get("uploader") or info.get("channel") or ""
    duration_s = float(info.get("duration") or 0.0)
    video_path = out_dir / f"{video_id}.mp4"
    info_path = out_dir / f"{video_id}.info.json"

    if not info_path.exists():
        info_path.write_text(json.dumps(info, default=str), encoding="utf-8")

    with yt_dlp.YoutubeDL(_ydl_opts_audio(out_dir)) as ydl:
        ydl.download([url])
    audio_path = out_dir / f"{video_id}.audio.mp3"

    return DownloadResult(
        video_id=video_id,
        title=title,
        channel=channel,
        duration_s=duration_s,
        url=url,
        video_path=video_path,
        audio_path=audio_path,
        info_path=info_path,
    )
