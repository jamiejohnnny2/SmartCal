#!/usr/bin/env python3
"""Train a custom microWakeWord model locally (CPU, WSL2 Ubuntu).

Adapted from the microwakeword-trainer notebook
(https://github.com/alfiedennen/microwakeword-trainer,
notebooks/microWakeWord_train_any_wakeword.ipynb) for local/offline use:
  - no google.colab drive.mount() — everything lives under --work-dir
  - one run trains one phrase; run it twice, once per wake word, pointing
    each at the other as a --confusable-phrase
  - IPA pronunciation is generated with espeak-ng instead of hand-typed,
    with --ipa as an escape hatch if the auto-generated one sounds wrong

Run `setup_wsl.sh` once first to install system packages + the venv this
script expects to be active.

Output: <output-name>.tflite + <output-name>.json, written under
--work-dir/<output-name>/ and copied to ./output/ (next to this script) so
they land back on the Windows side of the OneDrive-synced repo.

Manifest schema matches what linux-voice-assistant's pymicro_wakeword
package actually reads (verified against its bundled okay_nabu.json) — do
not hand-edit the field names.
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

GENERAL_CONFUSABLES = [
    "hey there", "hey you", "hey y'all", "hey now",
    "hey siri", "hey google", "okay google", "hey alexa",
    "okay nabu", "hey jarvis", "hey mycroft",
]
# Phonetic neighbors of "Cal" specifically.
CAL_CONFUSABLES = [
    "hey pal", "hey val", "hey sal", "hey gal", "okay pal", "okay val",
    "cal", "callie", "kale", "decal", "local", "hey cow",
]


def run(cmd, **kwargs):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, **kwargs)


def check_gpu():
    """Report whether TensorFlow (training) and PyTorch (Piper sample
    generation, in its own subprocess) can see a CUDA GPU. Non-fatal either
    way - training/generation still work on CPU, just much slower."""
    try:
        import tensorflow as tf
        gpus = tf.config.list_physical_devices("GPU")
        print(f"TensorFlow sees {len(gpus)} GPU(s): {gpus}" if gpus
              else "TensorFlow sees NO GPU - training will run on CPU (slow). "
                   "If you have an NVIDIA GPU, check `nvidia-smi` works inside WSL "
                   "and that tensorflow was installed as `tensorflow[and-cuda]`.")
    except Exception as ex:
        print(f"Could not check TensorFlow GPU visibility: {ex}")

    try:
        result = subprocess.run(
            [sys.executable, "-c", "import torch; print(torch.cuda.is_available(), "
                                    "torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"],
            capture_output=True, text=True, check=True,
        )
        print(f"PyTorch (used by Piper sample generation) CUDA available: {result.stdout.strip()}")
    except Exception as ex:
        print(f"Could not check PyTorch GPU visibility: {ex}")


def get_ipa(phrase: str) -> str:
    """Auto-generate stress-marked IPA via espeak-ng, e.g. 'hˈeɪ kˈæl'."""
    result = subprocess.run(
        ["espeak-ng", "-q", "--ipa", "-v", "en-us", phrase],
        capture_output=True, text=True, check=True,
    )
    ipa = result.stdout.strip()
    if not ipa:
        raise RuntimeError(f"espeak-ng returned empty IPA for {phrase!r}")
    return ipa


def install_microwakeword(shared_dir: Path):
    """Clone kahrendt/microWakeWord and apply the two upstream-bug patches
    the notebook applies (missing find_packages() in setup.py worked around
    via sys.path instead of an editable install; .numpy() called on values
    that newer TF already returns as ndarrays)."""
    mww_dir = shared_dir / "microWakeWord"
    if not mww_dir.exists():
        run(["git", "clone", "--depth", "1",
             "https://github.com/kahrendt/microWakeWord", str(mww_dir)])

    if str(mww_dir) not in sys.path:
        sys.path.insert(0, str(mww_dir))

    train_py = mww_dir / "microwakeword" / "train.py"
    src = train_py.read_text()
    import re
    patched = re.sub(
        r'(\b[a-zA-Z_]+\["[a-z]+"\])\.numpy\(\)',
        r'(\1.numpy() if hasattr(\1, "numpy") else \1)',
        src,
    )
    if patched.count("hasattr") > src.count("hasattr"):
        train_py.write_text(patched)
        print(f"Patched .numpy() calls in {train_py}")

    import importlib
    importlib.invalidate_caches()
    import microwakeword  # noqa: F401
    from microwakeword.audio.augmentation import Augmentation  # noqa: F401
    from microwakeword.audio.clips import Clips  # noqa: F401
    from microwakeword.audio.spectrograms import SpectrogramGeneration  # noqa: F401
    print("OK: microwakeword.audio.* imports clean")
    return mww_dir


def install_piper(shared_dir: Path):
    """Clone piper and build its monotonic_align extension - the notebook's
    workaround for the same upstream issue. piper-sample-generator itself is
    NOT cloned: its current upstream (unlike when this notebook was written)
    no longer ships a standalone generate_samples.py script, only an
    importable `piper_sample_generator` package - which setup_wsl.sh already
    installs from PyPI, invoked below via `python -m piper_sample_generator`.
    That package's __main__.py does `from piper_train.vits import commons`,
    which is why piper's monotonic_align extension still has to be built and
    put on PYTHONPATH even though piper-sample-generator itself isn't cloned.
    (apt packages / pip installs are assumed already done by setup_wsl.sh.)"""
    piper_repo_dir = shared_dir / "piper"

    if not piper_repo_dir.exists():
        run(["git", "clone", "--depth", "1",
             "https://github.com/rhasspy/piper", str(piper_repo_dir)])

    piper_python_dir = piper_repo_dir / "src" / "python"
    ma_dir = piper_python_dir / "piper_train" / "vits" / "monotonic_align"
    ma_import_dir = ma_dir / "monotonic_align"
    ma_build_dir = ma_dir / "piper_train" / "vits" / "monotonic_align"

    core_built = list(ma_import_dir.glob("core.*")) if ma_import_dir.exists() else []
    if not core_built:
        shutil.rmtree(piper_python_dir / "build", ignore_errors=True)
        shutil.rmtree(ma_import_dir, ignore_errors=True)
        shutil.rmtree(ma_dir / "piper_train", ignore_errors=True)
        ma_import_dir.mkdir(parents=True, exist_ok=True)
        ma_build_dir.mkdir(parents=True, exist_ok=True)
        (ma_import_dir / "__init__.py").touch()
        run(f"cd '{ma_dir}' && {sys.executable} setup.py build_ext --inplace", shell=True)
        built = next(iter(ma_build_dir.glob("core.*")), None)
        if not built:
            raise RuntimeError("monotonic_align core extension build failed")
        shutil.copy2(built, ma_import_dir)

    model_path = shared_dir / "models" / "en_US-libritts_r-medium.pt"
    model_config_path = Path(str(model_path) + ".json")
    model_path.parent.mkdir(parents=True, exist_ok=True)
    if not model_path.exists():
        print("Downloading libritts_r model (~75 MB)...")
        import urllib.request
        urllib.request.urlretrieve(
            "https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt",
            model_path,
        )
        urllib.request.urlretrieve(
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json",
            model_config_path,
        )
    return piper_python_dir, model_path


def _piper_env(piper_python_dir: Path) -> dict:
    """PYTHONPATH for the piper_sample_generator subprocess so its
    `from piper_train.vits import commons` import resolves - sys.path
    changes in this process don't propagate to a subprocess on their own."""
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{piper_python_dir}:" + env.get("PYTHONPATH", "")
    return env


def generate_samples(piper_python_dir: Path, model_path: Path, target_word_ipa: str,
                      max_samples: int, output_dir: Path, batch_size: int):
    output_dir.mkdir(parents=True, exist_ok=True)
    run([
        sys.executable, "-m", "piper_sample_generator",
        target_word_ipa, "--phoneme-input", "--model", str(model_path),
        "--max-samples", str(max_samples),
        "--batch-size", str(batch_size),
        "--noise-scales", "0.5", "--noise-scale-ws", "0.6",
        "--output-dir", str(output_dir),
    ], env=_piper_env(piper_python_dir))


def generate_confusables(piper_python_dir: Path, model_path: Path, phrases: list[str],
                          samples_per_phrase: int, output_dir: Path, tmp_dir: Path,
                          batch_size: int):
    output_dir.mkdir(parents=True, exist_ok=True)
    env = _piper_env(piper_python_dir)
    for phrase in phrases:
        safe = phrase.replace(" ", "_").replace(",", "").replace("'", "")
        existing = len(list(output_dir.glob(f"{safe}_*.wav")))
        if existing >= samples_per_phrase:
            print(f"  {phrase!r}: {existing} already, skip")
            continue
        tmp = tmp_dir / f"confusable_{safe}"
        tmp.mkdir(parents=True, exist_ok=True)
        print(f"  generating {samples_per_phrase} for {phrase!r}...")
        run([
            sys.executable, "-m", "piper_sample_generator",
            phrase, "--model", str(model_path),
            "--max-samples", str(samples_per_phrase),
            "--batch-size", str(batch_size),
            "--noise-scales", "0.5", "--noise-scale-ws", "0.6",
            "--output-dir", str(tmp),
        ], env=env)
        for f in tmp.glob("*.wav"):
            f.rename(output_dir / f"{safe}_{f.name}")


def download_negative_datasets(shared_dir: Path):
    neg_dir = shared_dir / "negative_datasets"
    if not neg_dir.exists() or not any(neg_dir.iterdir()):
        from huggingface_hub import snapshot_download
        snapshot_download(
            "kahrendt/microwakeword", repo_type="dataset",
            local_dir=str(neg_dir),
            allow_patterns=["speech/*", "dinner_party/*", "no_speech/*", "dinner_party_eval/*"],
        )

    mit_rirs = shared_dir / "mit_rirs"
    if not mit_rirs.exists() or not any(mit_rirs.iterdir()):
        print("Downloading MIT room impulse responses...")
        mit_rirs.mkdir(parents=True, exist_ok=True)
        run(f"cd '{mit_rirs}' && wget -q https://www.openslr.org/resources/28/rirs_noises.zip "
            "&& unzip -q rirs_noises.zip", shell=True)

    fma_dir = shared_dir / "fma_16k"
    if not fma_dir.exists() or not any(fma_dir.iterdir()):
        print("Downloading FMA background corpus (~500 MB)...")
        fma_dir.mkdir(parents=True, exist_ok=True)
        run(f"cd '{fma_dir}' && wget -q https://huggingface.co/datasets/kahrendt/microwakeword/resolve/main/fma_16k.tar "
            "&& tar -xf fma_16k.tar && rm fma_16k.tar", shell=True)

    audioset_dir = shared_dir / "audioset_16k"
    if not audioset_dir.exists() or not any(audioset_dir.iterdir()):
        print("Downloading AudioSet background corpus (~500 MB)...")
        audioset_dir.mkdir(parents=True, exist_ok=True)
        run(f"cd '{audioset_dir}' && wget -q https://huggingface.co/datasets/kahrendt/microwakeword/resolve/main/audioset_16k.tar "
            "&& tar -xf audioset_16k.tar && rm audioset_16k.tar", shell=True)

    return neg_dir, mit_rirs, fma_dir, audioset_dir


SPLIT_CONFIG = {
    "training":   {"split_name": "train",      "repetition": 3, "slide_frames": 10},
    "validation": {"split_name": "validation", "repetition": 1, "slide_frames": 10},
    "testing":    {"split_name": "test",       "repetition": 1, "slide_frames": 1},
}


def build_features(input_dir: Path, features_dir: Path, mit_rirs: Path, fma_dir: Path, audioset_dir: Path):
    from microwakeword.audio.augmentation import Augmentation
    from microwakeword.audio.clips import Clips
    from microwakeword.audio.spectrograms import SpectrogramGeneration
    from mmap_ninja.ragged import RaggedMmap

    clips = Clips(
        input_directory=str(input_dir), file_pattern="*.wav",
        max_clip_duration_s=None, remove_silence=True,
        random_split_seed=42, split_count=0.1,
    )
    augmenter = Augmentation(
        augmentation_duration_s=3.2,
        augmentation_probabilities={
            "SevenBandParametricEQ": 0.15, "TanhDistortion": 0.10,
            "PitchShift": 0.15, "BandStopFilter": 0.10,
            "AddColorNoise": 0.20, "AddBackgroundNoise": 0.85,
            "Gain": 1.00, "GainTransition": 0.25, "RIR": 0.60,
        },
        impulse_paths=[str(mit_rirs)],
        background_paths=[str(fma_dir), str(audioset_dir)],
        background_min_snr_db=-5, background_max_snr_db=20,
        min_jitter_s=0.10, max_jitter_s=0.50,
    )

    features_dir.mkdir(parents=True, exist_ok=True)
    for split, cfg in SPLIT_CONFIG.items():
        out = features_dir / split
        mmap = out / "wakeword_mmap"
        if mmap.exists() and any(mmap.iterdir()):
            print(f"{features_dir.name}/{split}: cached, skipping")
            continue
        if mmap.exists():
            shutil.rmtree(mmap)
        out.mkdir(parents=True, exist_ok=True)
        print(f"Generating {features_dir.name}/{split} "
              f"(rep={cfg['repetition']}, slide={cfg['slide_frames']})...")
        try:
            sg = SpectrogramGeneration(clips=clips, augmenter=augmenter,
                                        slide_frames=cfg["slide_frames"], step_ms=10)
            RaggedMmap.from_generator(
                out_dir=str(mmap), batch_size=200, verbose=True,
                sample_generator=sg.spectrogram_generator(
                    split=cfg["split_name"], repeat=cfg["repetition"]),
            )
        except Exception:
            traceback.print_exc()
            if mmap.exists():
                shutil.rmtree(mmap)
            raise


def write_training_config(phrase_dir: Path, output_name: str, neg_dir: Path,
                           has_confusables: bool, training_steps: list[int]):
    import yaml

    config = {
        "window_step_ms": 10,
        "train_dir": str(phrase_dir / "trained_models" / output_name),
        "features": [
            dict(features_dir=str(phrase_dir / "generated_augmented_features"), sampling_weight=8.0,
                 penalty_weight=2.0, truth=True, truncation_strategy="truncate_start", type="mmap"),
            dict(features_dir=str(neg_dir / "speech"), sampling_weight=10.0,
                 penalty_weight=2.5, truth=False, truncation_strategy="random", type="mmap"),
            dict(features_dir=str(neg_dir / "dinner_party"), sampling_weight=15.0,
                 penalty_weight=3.0, truth=False, truncation_strategy="random", type="mmap"),
            dict(features_dir=str(neg_dir / "no_speech"), sampling_weight=5.0,
                 penalty_weight=1.0, truth=False, truncation_strategy="random", type="mmap"),
            dict(features_dir=str(neg_dir / "dinner_party_eval"), sampling_weight=0.0,
                 penalty_weight=1.0, truth=False, truncation_strategy="split", type="mmap"),
        ],
        "training_steps": training_steps,
        "positive_class_weight": [2, 2],
        "negative_class_weight": [40, 50],
        "learning_rates": [0.001, 0.0001],
        "batch_size": 256,
        "time_mask_max_size": [5, 5], "time_mask_count": [1, 1],
        "freq_mask_max_size": [3, 3], "freq_mask_count": [1, 1],
        "eval_step_interval": 500,
        "clip_duration_ms": 1500,
        "target_minimization": 0.4,
        "minimization_metric": "ambient_false_positives_per_hour",
        "maximization_metric": "average_viable_recall",
    }
    if len(config["training_steps"]) != 2:
        # positive_class_weight/negative_class_weight/learning_rates are
        # zipped against training_steps by microwakeword; keep them the same
        # length if --training-steps was overridden with a different count.
        n = len(config["training_steps"])
        config["positive_class_weight"] = [2] * n
        config["negative_class_weight"] = [40 + 10 * i for i in range(n)]
        config["learning_rates"] = [0.001 * (0.1 ** i) for i in range(n)]
        config["time_mask_max_size"] = [5] * n
        config["time_mask_count"] = [1] * n
        config["freq_mask_max_size"] = [3] * n
        config["freq_mask_count"] = [1] * n

    if has_confusables:
        config["features"].append(dict(
            features_dir=str(phrase_dir / "confusable_features"), sampling_weight=8.0,
            penalty_weight=5.0, truth=False, truncation_strategy="random", type="mmap"))

    (phrase_dir / "trained_models" / output_name).mkdir(parents=True, exist_ok=True)
    config_path = phrase_dir / "training_parameters.yaml"
    with open(config_path, "w") as f:
        yaml.dump(config, f)
    print(f"{config_path} ready ({len(config['features'])} feature sets, "
          f"{sum(training_steps)} total steps)")
    return config_path


def train_model(mww_dir: Path, config_path: Path, output_name: str, phrase_dir: Path):
    train_dir = phrase_dir / "trained_models" / output_name
    shutil.rmtree(train_dir, ignore_errors=True)

    env = os.environ.copy()
    env["PYTHONPATH"] = f"{mww_dir}:" + env.get("PYTHONPATH", "")
    env["XLA_FLAGS"] = "--xla_gpu_autotune_level=0"

    cmd = [
        sys.executable, "-m", "microwakeword.model_train_eval",
        "--training_config", str(config_path),
        "--train", "1", "--restore_checkpoint", "0",
        "--test_tflite_streaming_quantized", "1",
        "--use_weights", "best_weights",
        "mixednet",
        "--pointwise_filters", "64,64,64,64",
        "--repeat_in_block", "1, 1, 1, 1",
        "--mixconv_kernel_sizes", "[5], [7,11], [9,15], [23]",
        "--residual_connection", "0,0,0,0",
        "--first_conv_filters", "32",
        "--first_conv_kernel_size", "5",
        "--stride", "3",
    ]
    print("Running:", " ".join(cmd), "\n")
    proc = subprocess.Popen(cmd, cwd=str(phrase_dir), env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in proc.stdout:
        print(line, end="")
    proc.wait()
    print("\nExit code:", proc.returncode)
    if proc.returncode != 0:
        raise RuntimeError("training failed - see output above")


def export_model(phrase_dir: Path, output_name: str, wake_word: str, author: str,
                  author_website: str, probability_cutoff: float, sliding_window_size: int,
                  tensor_arena_size: int, final_out_dir: Path):
    tflite_src = (phrase_dir / "trained_models" / output_name /
                  "tflite_stream_state_internal_quant" / "stream_state_internal_quant.tflite")
    if not tflite_src.exists():
        raise FileNotFoundError(f"No model at {tflite_src}")

    out_tflite = phrase_dir / f"{output_name}.tflite"
    out_json = phrase_dir / f"{output_name}.json"
    shutil.copy2(tflite_src, out_tflite)
    print(f"wrote {out_tflite} ({out_tflite.stat().st_size / 1024:.1f} KB)")

    # Schema verified against pymicro_wakeword's bundled okay_nabu.json
    # (what linux-voice-assistant actually loads) - see wakeword-training/README.md.
    manifest = {
        "type": "micro",
        "wake_word": wake_word,
        "author": author,
        "website": author_website,
        "model": out_tflite.name,
        "trained_languages": ["en"],
        "version": 2,
        "micro": {
            "probability_cutoff": probability_cutoff,
            "feature_step_size": 10,
            "sliding_window_size": sliding_window_size,
            "tensor_arena_size": tensor_arena_size,
            "minimum_esphome_version": "2024.7.0",
        },
    }
    out_json.write_text(json.dumps(manifest, indent=2))
    print(f"wrote {out_json}")
    print(json.dumps(manifest, indent=2))

    final_out_dir.mkdir(parents=True, exist_ok=True)
    for f in (out_tflite, out_json):
        shutil.copy2(f, final_out_dir / f.name)
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (final_out_dir / f"{output_name}_run_finished.txt").write_text(f"Training run finished at {ts}\n")
    print(f"\nDONE. Copied to {final_out_dir}/{output_name}.tflite (+ .json)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--wake-word", required=True, help='e.g. "Hey Cal"')
    p.add_argument("--output-name", required=True, help="e.g. hey_cal (no spaces, lowercase)")
    p.add_argument("--confusable-phrase", action="append", default=[],
                   help="Phrase that must NOT trigger this model; repeatable. "
                        "Pass the *other* Cal phrase here (e.g. --confusable-phrase \"Okay Cal\").")
    p.add_argument("--ipa", default=None,
                   help="Override auto-generated (espeak-ng) IPA pronunciation.")
    p.add_argument("--author", default=os.environ.get("USER", "smart-calendar"))
    p.add_argument("--author-website", default="")
    p.add_argument("--work-dir", default=str(Path.home() / "mww_work"),
                   help="Scratch dir on WSL's native filesystem (default: ~/mww_work). "
                        "Do NOT point this at /mnt/c - the 9p bridge is slow for this many files.")
    p.add_argument("--samples", type=int, default=15000,
                   help="Positive samples to generate (notebook default 30000; halved here "
                        "since CPU training time scales with the whole pipeline, not just this).")
    p.add_argument("--samples-per-confusable", type=int, default=1000)
    p.add_argument("--training-steps", type=int, nargs="+", default=[25000, 20000],
                   help="Two-phase step counts, same shape as the notebook default. "
                        "This is the dominant cost on CPU - consider [8000, 6000] for a "
                        "faster first pass, then retrain at full size if it works.")
    p.add_argument("--probability-cutoff", type=float, default=0.85)
    p.add_argument("--sliding-window-size", type=int, default=5)
    p.add_argument("--tensor-arena-size", type=int, default=50000)
    p.add_argument("--piper-batch-size", type=int, default=256,
                   help="Notebook default (assumes a CUDA GPU, auto-detected by "
                        "piper-sample-generator via torch.cuda.is_available()). "
                        "Drop to 16-32 if running on CPU only.")
    args = p.parse_args()

    work_dir = Path(args.work_dir).expanduser().resolve()
    shared_dir = work_dir / "shared"
    phrase_dir = work_dir / args.output_name
    for d in (shared_dir, phrase_dir):
        d.mkdir(parents=True, exist_ok=True)

    print(f"=== {args.wake_word} -> {args.output_name} ===")
    print(f"work dir: {work_dir}")

    ipa = args.ipa or get_ipa(args.wake_word)
    print(f"IPA: {ipa!r}")

    check_gpu()

    mww_dir = install_microwakeword(shared_dir)
    piper_python_dir, model_path = install_piper(shared_dir)

    generate_samples(piper_python_dir, model_path, ipa, args.samples,
                      phrase_dir / "generated_samples", args.piper_batch_size)

    confusables = GENERAL_CONFUSABLES + CAL_CONFUSABLES + args.confusable_phrase
    generate_confusables(piper_python_dir, model_path, confusables, args.samples_per_confusable,
                          phrase_dir / "confusable_negatives", work_dir / "tmp", args.piper_batch_size)

    neg_dir, mit_rirs, fma_dir, audioset_dir = download_negative_datasets(shared_dir)

    build_features(phrase_dir / "generated_samples", phrase_dir / "generated_augmented_features",
                    mit_rirs, fma_dir, audioset_dir)
    has_confusables = any((phrase_dir / "confusable_negatives").glob("*.wav"))
    if has_confusables:
        build_features(phrase_dir / "confusable_negatives", phrase_dir / "confusable_features",
                        mit_rirs, fma_dir, audioset_dir)

    config_path = write_training_config(phrase_dir, args.output_name, neg_dir,
                                         has_confusables, args.training_steps)
    train_model(mww_dir, config_path, args.output_name, phrase_dir)
    export_model(phrase_dir, args.output_name, args.wake_word, args.author, args.author_website,
                 args.probability_cutoff, args.sliding_window_size, args.tensor_arena_size,
                 SCRIPT_DIR / "output")


if __name__ == "__main__":
    main()
