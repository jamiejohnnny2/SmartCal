#!/usr/bin/env bash
# One-time setup, run manually inside WSL2 Ubuntu (not from Windows):
#
#   cd /mnt/c/Users/jjohnson/OneDrive\ -\ Roto/Documents/GitHub/Smart\ Calender/wakeword-training
#   chmod +x setup_wsl.sh
#   ./setup_wsl.sh
#
# Installs system packages (needs sudo) + creates a Python venv with the
# training dependencies, adapted from the microwakeword-trainer notebook's
# "Install microWakeWord" and "Piper sample generator install" cells.
#
# The venv and all downloaded datasets/models live on the WSL native
# filesystem ($HOME), NOT under /mnt/c — the 9p bridge to Windows is slow
# for the tens of thousands of small files this pipeline creates. Only the
# scripts here and the final .tflite/.json outputs touch the Windows side.

set -euo pipefail

WORK_DIR="${MWW_WORK_DIR:-$HOME/mww_work}"

echo "=== GPU check ==="
echo "WSL2 passes your NVIDIA GPU through via the Windows driver - do NOT install"
echo "a Linux NVIDIA driver inside WSL, it will conflict. If nvidia-smi below"
echo "doesn't show your GPU, update the Windows-side NVIDIA driver instead"
echo "(Settings > Windows Update, or the GeForce Experience / app driver update),"
echo "then reopen this WSL terminal."
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi || echo "nvidia-smi found but failed to run - see note above."
else
  echo "nvidia-smi not found. Training/sample-generation will fall back to CPU"
  echo "(much slower) until this is resolved - see note above."
fi
echo

echo "=== apt packages ==="
sudo apt-get update
sudo apt-get install -y \
  build-essential python3-venv python3-dev python3-pip \
  espeak-ng git wget unzip ffmpeg pkg-config

echo "=== Python venv at $WORK_DIR/.venv ==="
mkdir -p "$WORK_DIR"
python3 -m venv "$WORK_DIR/.venv"
# shellcheck disable=SC1091
source "$WORK_DIR/.venv/bin/activate"
pip install --upgrade pip setuptools wheel cython

echo "=== Core microWakeWord deps (tensorflow[and-cuda] pulls in CUDA/cuDNN as ==="
echo "=== pip wheels - several GB, no system CUDA toolkit install needed)      ==="
pip install \
  audiomentations audio_metadata datasets mmap_ninja numpy \
  pymicro-features pyyaml "tensorflow[and-cuda]>=2.16" webrtcvad-wheels \
  ai-edge-litert huggingface_hub

echo "=== Patched audio-metadata fork (must install AFTER the PyPI one above) ==="
pip install "git+https://github.com/whatsnowplaying/audio-metadata@d4ebb238e6a401bb1a5aaaac60c9e2b3cb30929f"

echo "=== Piper (sample generation) ==="
pip install piper-tts piper-sample-generator

echo "=== pymicro_wakeword (for check_model.py - the actual runtime the Pi uses) ==="
pip install pymicro-wakeword

echo
echo "=== Verifying GPU is visible to TensorFlow + PyTorch ==="
python3 -c "
import tensorflow as tf
gpus = tf.config.list_physical_devices('GPU')
print('TensorFlow GPUs:', gpus or 'NONE - will train on CPU')
"
python3 -c "
import torch
print('PyTorch CUDA available:', torch.cuda.is_available(),
      torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')
"

echo
echo "Done. Work dir: $WORK_DIR"
echo "Next time, activate with:"
echo "  source $WORK_DIR/.venv/bin/activate"
echo
echo "Then run, once per phrase:"
echo '  python3 train_wakeword.py --wake-word "Hey Cal"  --output-name hey_cal  --confusable-phrase "Okay Cal"'
echo '  python3 train_wakeword.py --wake-word "Okay Cal" --output-name okay_cal --confusable-phrase "Hey Cal"'
