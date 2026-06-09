"""Audio quality + emphasis features per Q→A moment.

For each moment we compute features over the question window and the
answer window separately, then combine into a moment-level audio_quality
and energy_peak score in [0, 1].

Rationale:
- Quality matters for the question: the attendee mic is the weakest link
  in short-form output. If the question is too quiet, too noisy, or
  clipped, the clip is unusable as a hook.
- Energy peaks in the answer correlate with emphasis ("if you can't do
  THAT..."). They're a cheap proxy for quotability before we layer in a
  laughter / applause detector.

We load the full audio once per video and reuse it across moments to
avoid repeated decode cost.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

import librosa


SR = 16000  # downsample for speech


@dataclass
class MomentAudio:
    audio_quality: float  # 0-1
    energy_peak: float  # 0-1 normalized within video


def load_audio(audio_path: Path) -> tuple[np.ndarray, int]:
    y, sr = librosa.load(str(audio_path), sr=SR, mono=True)
    return y, sr


def _window(y: np.ndarray, sr: int, t0: float, t1: float) -> np.ndarray:
    a = max(0, int(t0 * sr))
    b = min(len(y), int(t1 * sr))
    if b <= a:
        return np.zeros(1, dtype=np.float32)
    return y[a:b]


def _quality(seg: np.ndarray, sr: int) -> float:
    """Heuristic quality score in [0, 1].

    Penalize: dead-quiet (no voice), nearly all noise (high spectral flatness),
    aggressive clipping (samples near ±1.0), large dynamic dropouts.
    Reward: speech-like flatness + reasonable RMS variance.
    """
    if seg.size < sr // 4:  # less than 0.25s of audio
        return 0.0
    rms = librosa.feature.rms(y=seg, frame_length=1024, hop_length=512)[0]
    flat = librosa.feature.spectral_flatness(y=seg, n_fft=1024, hop_length=512)[0]
    mean_rms = float(np.mean(rms))
    mean_flat = float(np.mean(flat))
    peak = float(np.max(np.abs(seg)))
    clip_ratio = float(np.mean(np.abs(seg) > 0.99))

    # Components, each in [0, 1].
    loudness = float(np.clip(mean_rms / 0.10, 0.0, 1.0))  # 0.10 RMS = healthy speech
    voice_like = float(np.clip(1.0 - mean_flat * 4.0, 0.0, 1.0))  # flatness ~0.05 ideal voice
    no_clip = float(np.clip(1.0 - clip_ratio * 50.0, 0.0, 1.0))  # any clipping is bad
    no_silence = float(np.clip(peak / 0.3, 0.0, 1.0))

    return float(0.35 * loudness + 0.30 * voice_like + 0.20 * no_clip + 0.15 * no_silence)


def _energy_peak(seg: np.ndarray, sr: int, baseline_rms: float) -> float:
    """Normalized peak RMS of this segment relative to a per-video baseline."""
    if seg.size < sr // 4:
        return 0.0
    rms = librosa.feature.rms(y=seg, frame_length=1024, hop_length=512)[0]
    peak = float(np.max(rms))
    if baseline_rms <= 1e-6:
        return 0.0
    # Express peak as a multiplier of baseline, then squash into [0, 1]. A
    # 3x-over-baseline peak is "loud emphasis"; a 1.5x peak is "above average".
    ratio = peak / baseline_rms
    return float(np.clip((ratio - 1.0) / 4.0, 0.0, 1.0))


def video_baseline_rms(y: np.ndarray, sr: int) -> float:
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=512)[0]
    return float(np.median(rms))


def moment_features(
    y: np.ndarray,
    sr: int,
    baseline_rms: float,
    q_start: float,
    q_end: float,
    a_start: float,
    a_end: float,
) -> MomentAudio:
    q_seg = _window(y, sr, q_start, q_end)
    a_seg = _window(y, sr, a_start, a_end)
    # The question quality is the binding constraint for clip-worthiness:
    # take the min of the two windows, weighted toward the question.
    q_quality = _quality(q_seg, sr)
    a_quality = _quality(a_seg, sr)
    audio_quality = float(0.6 * q_quality + 0.4 * a_quality)
    energy_peak = _energy_peak(a_seg, sr, baseline_rms)
    return MomentAudio(audio_quality=audio_quality, energy_peak=energy_peak)
