# Local wake-word training ("Hey Cal" / "Okay Cal")

Trains custom [microWakeWord](https://github.com/kahrendt/microWakeWord)
models on your own machine instead of Google Colab, adapted from the
[microwakeword-trainer](https://github.com/alfiedennen/microwakeword-trainer)
notebook's actual cells, running inside WSL2 Ubuntu. See
[homeassistant/README.md, "Train and install the wake words"](../homeassistant/README.md)
for how these models fit into the overall voice pipeline and how to deploy
them to the kiosk Pi once trained.

**On WSL2 and your existing Windows install:** `wsl --install` does not
touch partitions, the bootloader, or any existing files — it enables two
Windows features and creates a single virtual-disk file for Ubuntu's
filesystem under your user profile. It's fully reversible with
`wsl --unregister Ubuntu` (or turning the features back off) and has no more
risk to Windows than installing a regular application does.

**On GPU use:** if you have an NVIDIA GPU (e.g. a 3090), WSL2 passes it
through to Ubuntu via your existing *Windows* NVIDIA driver — no separate
Linux driver, no dual-boot, no repartitioning. `setup_wsl.sh` installs
GPU-enabled TensorFlow and checks `nvidia-smi` for you. **Do not** install
an NVIDIA driver from inside WSL itself; that's for bare-metal Linux and
conflicts with the passthrough. Piper's sample generator
(`torch.cuda.is_available()`) and TensorFlow both auto-detect the GPU with
no extra flags once it's visible.

With a 3090 + a fast CPU (feature extraction/augmentation is CPU-bound and
benefits from many cores) this should land close to the notebook's own
~45 min/phrase on an A100 — realistically an hour or two per phrase once
one-time setup and the first phrase's shared dataset downloads (~1 GB,
cached for the second run) are done, rather than the multi-hour CPU-only
estimate this doc used to give. CPU-only (no usable GPU) is still supported
as a fallback — see the `--piper-batch-size`/`--training-steps` flags below —
just expect it to take much longer.

## 0. Install WSL2 + Ubuntu (Windows side, one-time)

From an **elevated** PowerShell:

```bash
wsl --install -d Ubuntu
```

Reboot when prompted. Ubuntu launches once more after reboot to finish
setup and asks you to create a UNIX username/password — that's your login
for every WSL session from then on.

## 1. System + Python setup (inside WSL Ubuntu, one-time)

Open a WSL terminal (`wsl` from PowerShell, or the "Ubuntu" Start Menu
entry), then:

```bash
cd "/mnt/c/Users/jjohnson/OneDrive - Roto/Documents/GitHub/Smart Calender/wakeword-training"
chmod +x setup_wsl.sh
./setup_wsl.sh
```

This installs `espeak-ng`, build tools, etc. via `apt` (asks for your sudo
password once), then creates a Python venv at `~/mww_work/.venv` with
`tensorflow`, `piper-tts`, `pymicro-wakeword`, and the rest of the
notebook's pinned dependencies.

**Why `~/mww_work` and not somewhere under `/mnt/c`:** this pipeline creates
tens of thousands of small files (memory-mapped feature arrays, generated
WAV samples). The 9p bridge WSL uses to reach the Windows filesystem is slow
for that access pattern — training against data on the Windows side can be
several times slower. Only this script and the final `.tflite`/`.json`
outputs need to touch `/mnt/c`; everything else stays on WSL's native
ext4 filesystem.

## 2. Train each phrase

Activate the venv, then run once per wake word:

```bash
source ~/mww_work/.venv/bin/activate
cd "/mnt/c/Users/jjohnson/OneDrive - Roto/Documents/GitHub/Smart Calender/wakeword-training"

python3 train_wakeword.py --wake-word "Hey Cal"  --output-name hey_cal  --confusable-phrase "Okay Cal"
python3 train_wakeword.py --wake-word "Okay Cal" --output-name okay_cal --confusable-phrase "Hey Cal"
```

Each run downloads shared negative-sample datasets once (~1 GB total,
cached under `~/mww_work/shared/` for the second run to reuse), generates
Piper TTS samples for that phrase plus a batch of confusable phrases (other
assistants' wake words + "Cal" phonetic neighbors — see
`GENERAL_CONFUSABLES`/`CAL_CONFUSABLES` in `train_wakeword.py`), then trains.

`train_wakeword.py` prints what TensorFlow/PyTorch detect for a GPU right
at the start (`check_gpu()`) — confirm it's seeing your 3090 before leaving
a run unattended; if it isn't, `nvidia-smi` (run it directly in the WSL
terminal) is the first thing to check.

Useful flags (`python3 train_wakeword.py --help` for the full list):

- `--training-steps 8000 6000` — the default `25000 20000` (same as the
  notebook) is fine on a 3090; only drop this if you end up CPU-only or want
  a faster first pass to sanity-check the pipeline before a full run.
- `--samples 8000` — fewer positive TTS samples, for the same CPU-fallback case.
- `--piper-batch-size 16` — the default `256` assumes a CUDA GPU; lower this
  on CPU-only.
- `--ipa "hˈeɪ kˈæl"` — override the auto-generated (via `espeak-ng`) IPA
  pronunciation if it doesn't sound right; run
  `espeak-ng -q --ipa -v en-us "Hey Cal"` yourself to see what it produces.

Output lands in `wakeword-training/output/`: `hey_cal.tflite` +
`hey_cal.json`, `okay_cal.tflite` + `okay_cal.json`.

## 3. Sanity-check before copying to the Pi

```bash
python3 check_model.py --output-name hey_cal  --wake-word "Hey Cal"
python3 check_model.py --output-name okay_cal --wake-word "Okay Cal"
```

This validates the manifest has the fields `pymicro_wakeword` (the actual
runtime `linux-voice-assistant` uses) reads, then loads the `.tflite`
through that same library and streams a sample of this phrase's own
generated positives and confusable negatives through it, reporting peak
detection probability for each. Positives should score clearly above
`probability_cutoff`; confusables should score clearly below it. If they
don't, `probability_cutoff` in the `.json` is the first thing to hand-tune
(no retraining needed) — see the table in the notebook's closing cell,
reproduced in [homeassistant/README.md](../homeassistant/README.md).

## 4. Deploy

Follow [homeassistant/README.md, step 7](../homeassistant/README.md), from
"On the kiosk Pi, put all four files in a new custom wake-word folder"
onward — `scp` both `.tflite`/`.json` pairs to
`~/linux-voice-assistant/wakewords/custom/` on the kiosk Pi, uncomment
`WAKE_WORD_DIR` in `pi-setup/linux-voice-assistant.service`, and restart the
service.
