#!/usr/bin/env python3
"""Sanity-check a trained wake-word model before copying it to the kiosk Pi.

1. Validates the .json manifest has the fields pymicro_wakeword actually
   reads (see MicroWakeWord.from_config in that package - not the same
   shape as the ESPHome docs' example).
2. Loads the .tflite through pymicro_wakeword itself (the real runtime the
   Pi will use, not a generic TFLite interpreter) and streams a handful of
   this phrase's own generated positive samples plus some confusable
   negatives through it, reporting the peak detection probability for each.
   A healthy model should show positives clearly above --probability-cutoff
   and negatives clearly below it.

Usage (from inside the WSL venv, after train_wakeword.py has produced a
model for --output-name):

    python3 check_model.py --output-name hey_cal \\
        --work-dir ~/mww_work --wake-word "Hey Cal"
"""
import argparse
import json
import random
import wave
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def load_wav_bytes(path: Path) -> bytes:
    with wave.open(str(path), "rb") as wf:
        assert wf.getframerate() == 16000, f"{path} is not 16kHz"
        assert wf.getsampwidth() == 2, f"{path} is not 16-bit"
        assert wf.getnchannels() == 1, f"{path} is not mono"
        return wf.readframes(wf.getnframes())


def peak_probability(model, audio_bytes: bytes) -> float:
    from pymicro_wakeword import MicroWakeWordFeatures

    features = MicroWakeWordFeatures()
    model.reset()
    best = 0.0
    chunk = 320  # 10ms of 16-bit mono 16kHz audio
    for i in range(0, len(audio_bytes), chunk):
        for feat in features.process_streaming(audio_bytes[i:i + chunk]):
            prob = model.process_streaming_prob(feat)
            if prob is not None:
                best = max(best, prob)
    return best


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--output-name", required=True)
    p.add_argument("--wake-word", required=True, help="For a human-readable header only.")
    p.add_argument("--work-dir", default=str(Path.home() / "mww_work"))
    p.add_argument("--model-dir", default=None,
                   help="Where <output-name>.tflite/.json live (default: <script-dir>/output).")
    p.add_argument("--sample-count", type=int, default=8,
                   help="How many positive / confusable samples each to test.")
    args = p.parse_args()

    model_dir = Path(args.model_dir).expanduser().resolve() if args.model_dir else SCRIPT_DIR / "output"
    tflite_path = model_dir / f"{args.output_name}.tflite"
    json_path = model_dir / f"{args.output_name}.json"

    print(f"=== {args.wake_word} ({args.output_name}) ===")
    print(f"tflite: {tflite_path}")
    print(f"json:   {json_path}")

    assert tflite_path.exists(), f"Missing {tflite_path}"
    assert json_path.exists(), f"Missing {json_path}"

    manifest = json.loads(json_path.read_text())
    required_top = ["type", "wake_word", "model", "trained_languages", "micro"]
    required_micro = ["probability_cutoff", "sliding_window_size"]
    missing = [k for k in required_top if k not in manifest]
    missing += [f"micro.{k}" for k in required_micro if k not in manifest.get("micro", {})]
    if missing:
        raise SystemExit(f"Manifest is missing required field(s): {missing}")
    if manifest["type"] != "micro":
        raise SystemExit(f'manifest "type" must be "micro", got {manifest["type"]!r}')
    if manifest["model"] != tflite_path.name:
        print(f'WARNING: manifest "model" is {manifest["model"]!r} but the file next to it '
              f'is {tflite_path.name!r} - the Pi resolves "model" relative to the .json, '
              f"rename one to match before copying.")
    print("Manifest schema OK:", json.dumps(manifest, indent=2))

    from pymicro_wakeword import MicroWakeWord
    model = MicroWakeWord.from_config(json_path)
    cutoff = manifest["micro"]["probability_cutoff"]

    work_dir = Path(args.work_dir).expanduser().resolve()
    phrase_dir = work_dir / args.output_name
    pos_dir = phrase_dir / "generated_samples"
    neg_dir = phrase_dir / "confusable_negatives"

    def sample_scores(label, directory):
        if not directory.exists():
            print(f"  ({label}: {directory} not found, skipping - run from the same "
                  f"--work-dir used for training, or pass --work-dir explicitly)")
            return
        wavs = list(directory.glob("*.wav"))
        if not wavs:
            print(f"  ({label}: no .wav files in {directory})")
            return
        random.seed(0)
        chosen = random.sample(wavs, min(args.sample_count, len(wavs)))
        print(f"\n{label} ({len(chosen)} of {len(wavs)} samples):")
        for wav_path in chosen:
            score = peak_probability(model, load_wav_bytes(wav_path))
            verdict = "DETECTED" if score > cutoff else "missed"
            print(f"  {wav_path.name:40s} peak={score:.3f}  ({verdict}, cutoff={cutoff})")

    sample_scores("Positive samples (should mostly DETECT)", pos_dir)
    sample_scores("Confusable negatives (should mostly miss)", neg_dir)

    print("\nIf positives are scoring well below cutoff, or negatives well above it, "
          "adjust micro.probability_cutoff in the .json by hand before deploying - "
          "no need to retrain for that alone.")


if __name__ == "__main__":
    main()
