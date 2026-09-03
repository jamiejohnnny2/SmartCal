# Voice control via Home Assistant

Lets you say "what's today" / "what's this week" / "what's coming up" and
have the kiosk display switch to that view. This doc covers the **whole
path from a blank SD card** to a working pipeline: flashing Home Assistant
OS, onboarding, installing the two add-ons you actually need, dropping this
repo's config in, and pairing it with the kiosk Pi's satellite app.

## Architecture

```
HA Pi (fresh install, this doc)           Kiosk Pi (4GB, the calendar)
├── Whisper add-on (speech-to-text)        ├── Node server (already built)
├── Piper add-on (text-to-speech)          ├── React kiosk UI (already built)
├── Assist pipeline (wires the above       └── linux-voice-assistant
│   together + intents)                          — mic in / speaker out,
├── automations.yaml (this folder)               local wake word (on-device,
│   sentence triggers → rest_command              no HA-side add-on needed
                                                   for it — see step 3), streams
                                                   to HA after wake word
```

The heavy lifting (speech-to-text, text-to-speech) runs on the HA Pi. The
kiosk Pi only runs a lightweight satellite app that listens locally for the
wake word and streams audio to HA once triggered — no speech models run on
the kiosk Pi itself, and (this is a change from how a lot of older HA voice
writeups describe it) **HA doesn't need its own wake-word add-on either**,
since the satellite already does that on-device before HA ever hears
anything. That leaves exactly two add-ons to install: Whisper and Piper.

**Note on the satellite software:** the original plan here was built around
`wyoming-satellite`, but that project was archived (deprecated) on GitHub in
January 2026. This uses its maintained successor,
[`linux-voice-assistant`](https://github.com/OHF-Voice/linux-voice-assistant)
(from the Open Home Foundation, the same org behind Home Assistant), which
talks to HA over the ESPHome protocol instead of Wyoming. It's newer and
less battle-tested than Wyoming was — expect it to need more troubleshooting
than a mature project would.

## 1. Flash Home Assistant OS

Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) — Home
Assistant is one of the listed OS options, no separate download needed:

**Choose OS → Other specific-purpose OS → Home assistants and home
automation → Home Assistant → Home Assistant OS (RPi 4/5 — match your
board).** Pick your SD card and write.

**Skip the gear-icon "OS customisation" (WiFi/hostname preset) — it doesn't
apply to Home Assistant OS.** Unlike Raspberry Pi OS, HAOS is a locked-down
appliance image that doesn't use the customisation Imager writes; the
dialog may let you click through it, but it's silently ignored. This is the
one point in the whole setup most likely to eat an hour if you don't know
it going in.

**Plug in Ethernet for first boot.** This is the reliable path — HAOS comes
up, gets an IP via DHCP, and is reachable with zero monitor/keyboard/extra
steps. If your HA Pi genuinely can't reach Ethernet at all (not even
temporarily for this one boot), see
[Optional: WiFi without Ethernet](#optional-wifi-without-ethernet-skip-if-you-have-a-cable)
below — it works, but it's the fragile path, so use it only if you have to.

Boot the Pi. Give it 3-5 minutes for first-boot setup (it's installing
itself, not just starting), then from another device on the same network go
to **http://homeassistant.local:8123** (fall back to `http://<its-ip>:8123`
if `.local` doesn't resolve on your network).

## 2. Onboarding

A short wizard, about 5 screens:

1. Preparation screen — HA finishes downloading itself, just wait.
2. Create your account (name/username/password).
3. Set home location (also sets timezone/units — get this right, it's used
   later).
4. Analytics opt-in — off by default, leave it however you like.
5. Finish → you land on the dashboard.

Device auto-discovery prompts (if any) show up on the dashboard afterward,
not as part of onboarding — you can ignore/dismiss them, none of it matters
for what we're building here.

## 3. Install the voice add-ons + Assist pipeline

**Settings → Add-ons → Add-on Store**, install and start:
- **Whisper** (speech-to-text)
- **Piper** (text-to-speech)

That's the only two. (You may also see **Speech-to-Phrase** in the store —
it's a newer, much lower-latency local STT option built specifically for
matching a short fixed set of sentences, which is exactly what our
automations use below instead of open-ended dictation. Worth trying as a
swap-in for Whisper later if you want snappier responses, but it's not
required — treat it as a nice-to-have, not part of the critical path.)

**Settings → Voice assistants → Add assistant** — create a pipeline:
- Conversation agent: **Home Assistant** (not a cloud LLM)
- Speech-to-text: **Whisper**
- Text-to-speech: **Piper**
- Wake word: leave this **unset/None** — the kiosk satellite already
  handles wake-word detection on-device before HA ever sees audio, so this
  field doesn't do anything in this setup.

## 4. Get this repo's config onto the box

You need `rest_commands.yaml` and `automations.yaml` (both in this folder)
copied into your HA config, plus two lines added to `configuration.yaml`.
Easiest way in from Windows:

1. **Settings → Add-ons → Add-on Store**, install and start **Samba share**.
   Set a username/password in its configuration.
2. On your Windows PC, open File Explorer and go to
   `\\homeassistant\config` (or `\\<its-ip>\config`), sign in with the
   Samba credentials you just set. This is the same folder HA itself reads
   `configuration.yaml` from.
3. Copy `homeassistant/rest_commands.yaml` and `homeassistant/automations.yaml`
   from this repo into that share, unchanged in name/location (i.e. they
   end up as `config/rest_commands.yaml` and `config/automations.yaml`).
4. In `rest_commands.yaml`, replace `KIOSK_PI_IP` with the kiosk Pi's LAN
   IP or hostname.
   - **Tip:** give the kiosk Pi a DHCP reservation in your router (bind its
     MAC to a fixed IP) so this never goes stale after a router reboot —
     much less hassle than switching to mDNS discovery from inside HAOS,
     which isn't guaranteed to resolve reliably.
5. Open `config/configuration.yaml` (already there from onboarding) in a
   text editor over the same Samba share and add, if not already present:
   ```yaml
   rest_command: !include rest_commands.yaml
   automation: !include automations.yaml
   ```
   If `automation:` already exists with a different value (a plain list,
   for instance), you can't have two `automation:` keys — merge our three
   automations into whatever's already there instead of overwriting it.
6. **Settings → System → Restart** (or Developer Tools → YAML → each
   relevant "reload" button, faster if you don't want a full restart) to
   pick the new config up.

## 5. Kiosk Pi setup (the calendar Pi)

```bash
# On the kiosk Pi:
sudo apt update
sudo apt-get install -y \
  avahi-utils pulseaudio-utils alsa-utils \
  pipewire-bin pipewire-alsa pipewire-pulse \
  build-essential libmpv-dev libasound2-plugins \
  ca-certificates git python3-venv python3-dev

git clone https://github.com/OHF-Voice/linux-voice-assistant.git
cd linux-voice-assistant
chmod +x docker-entrypoint.sh

# On a Pi 4/5 this should be fine without the resource-constrained flags;
# if setup is slow or the board struggles, add:
#   --cxxflags="-O1 -g0" --makeflags="-j1"
script/setup
```

Check your user's numeric ID with `id -u` (usually `1000` for the default
`pi` user), then install the systemd service:

```bash
sudo cp pi-setup/linux-voice-assistant.service /etc/systemd/system/
sudo nano /etc/systemd/system/linux-voice-assistant.service
# update the two /run/user/1000/... lines if your UID isn't 1000,
# and the User=/WorkingDirectory= paths if you cloned somewhere other
# than /home/pi/linux-voice-assistant

sudo systemctl daemon-reload
sudo systemctl enable --now linux-voice-assistant
sudo systemctl status linux-voice-assistant   # confirm it's running
```

## 6. Pairing kiosk Pi ↔ Home Assistant

In Home Assistant: **Settings → Devices & services**. The satellite should
show up as a discovered device automatically (it advertises itself via
mDNS/Avahi) — if not, **Add Integration → ESPHome** and enter the kiosk
Pi's IP address.

Once paired, the satellite's wake word, microphone gain/noise-suppression,
and other tuning options are available as entities on that device page.

## 7. Train and install the "Hey Cal" / "Okay Cal" wake words

The satellite ships with generic bundled wake words (`okay_nabu`, `hey_jarvis`,
etc.) and starts up using `okay_nabu` out of the box (see the `WAKE_MODEL` line
in `pi-setup/linux-voice-assistant.service`) — that works immediately and
needs nothing further if a stock wake word is fine. This step swaps in two
wake words that match the assistant's actual name in this app ("Cal", per the
wake overlay below), so either "Hey Cal" or "Okay Cal" triggers it.

**This step is manual and needs a human in the loop** — training involves
listening to synthesized pronunciations and judging by ear whether they'd
trigger reliably on your own voice/accent, which isn't something to automate
away. Budget roughly an hour per phrase (two phrases here), most of it
unattended training time.

**Don't use Home Assistant's own training notebook** — as of 2026 its pinned
dependencies have drifted out of sync with what Colab's default environment
provides, so cells fail calling functions that no longer exist upstream. This
is a known, currently-open problem with that specific notebook
([openWakeWord issue #317](https://github.com/dscripka/openWakeWord/issues/317)),
not anything you did wrong. Use
[alfiedennen/microwakeword-trainer](https://github.com/alfiedennen/microwakeword-trainer)
instead — a community-maintained, self-driving Colab notebook that trains
**microWakeWord** models rather than openWakeWord ones. That's actually a
better fit here regardless of the breakage: microWakeWord is the *same*
engine the bundled `okay_nabu` etc. already use, so the result is lighter on
the Pi's CPU and drops in without the custom-JSON workaround an openWakeWord
model would need.

**Trained locally instead of on Colab** — the free-tier T4 GPU OOMs on
*system* RAM during validation, not GPU compute, per that repo's README, so
this instead ran on CPU inside WSL2 Ubuntu with a plain adaptation of the
notebook's own cells. See [`wakeword-training/`](../wakeword-training/) in
this repo for the script, setup instructions, and a model sanity-checker —
skip straight to step 4 below if you use that path instead of Colab.

1. Open the notebook:
   [microWakeWord_train_any_wakeword.ipynb](https://colab.research.google.com/github/alfiedennen/microwakeword-trainer/blob/main/notebooks/microWakeWord_train_any_wakeword.ipynb)
   (Google account required). **Runtime → Change runtime type → A100 GPU,
   High-RAM** before running anything — the README is explicit that the
   free-tier T4 GPU runs out of memory partway through. An A100 runtime
   isn't included in Colab's free tier; expect to spend a few dollars of
   Colab's pay-as-you-go compute units (or a Colab Pro subscription) to get
   one, across both phrases.
2. In the configuration cell, run it **twice** — once per phrase:
   - Phrase 1: wake word `Hey Cal`, output name `hey_cal`, rough IPA
     `heɪ kæl`
   - Phrase 2: wake word `Okay Cal`, output name `okay_cal`, rough IPA
     `oʊkeɪ kæl`

   Use **generate** mode (Piper-synthesized samples) for a first pass — it's
   the direct equivalent of what Home Assistant's own notebook would have
   done. There's also a **bundle** mode that trains from your own real
   recordings instead, for noticeably better accuracy; worth revisiting later
   if the generated version under- or over-triggers, but not necessary to get
   started. If the notebook has a "confusable phrases" field, list each
   phrase as the other's confusable ("Okay Cal" for the Hey Cal run and vice
   versa) — they're similar-sounding, and this specifically trains the model
   to tell them apart instead of tripping on either.
3. Run the full notebook (~45 minutes per phrase). Each run produces two
   files — a `.tflite` model and a `.json` manifest with detection
   thresholds already filled in. Download both, for both phrases: you should
   end up with `hey_cal.tflite` + `hey_cal.json` and `okay_cal.tflite` +
   `okay_cal.json`. **Don't hand-write the JSON** like an earlier draft of
   this doc said to — the notebook's own output already matches the manifest
   format this stack expects. This was verified directly against the
   `pymicro_wakeword` pip package (what `linux-voice-assistant` actually
   loads) — its bundled `okay_nabu.json` is shaped like this, and
   `MicroWakeWord.from_config()` reads exactly these fields (an earlier draft
   of this doc had the version number and one key name wrong):
   ```json
   {
     "type": "micro",
     "wake_word": "Hey Cal",
     "author": "your_name",
     "website": "",
     "model": "hey_cal.tflite",
     "trained_languages": ["en"],
     "version": 2,
     "micro": {
       "probability_cutoff": 0.85,
       "feature_step_size": 10,
       "sliding_window_size": 5,
       "tensor_arena_size": 50000,
       "minimum_esphome_version": "2024.7.0"
     }
   }
   ```
   If a wake word ends up too trigger-happy or too reluctant once it's
   running for real, `probability_cutoff` (0–1, higher = stricter) is the one
   number worth hand-tuning before retraining from scratch.
4. On the kiosk Pi, put all four files in a new custom wake-word folder:
   ```bash
   ssh pi@<kiosk-ip> "mkdir -p ~/linux-voice-assistant/wakewords/custom"
   scp hey_cal.tflite hey_cal.json okay_cal.tflite okay_cal.json \
     pi@<kiosk-ip>:~/linux-voice-assistant/wakewords/custom/
   ```
5. Point the satellite at that folder and restart it — `WAKE_WORD_DIR` is
   already set up (commented out) in `pi-setup/linux-voice-assistant.service`
   for this; uncomment it, then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart linux-voice-assistant
   sudo systemctl status linux-voice-assistant   # confirm it didn't crash-loop
   ```
   If it fails to start, `journalctl -u linux-voice-assistant -f` will show
   why — the most likely cause at this point is a typo in one of the two
   manifests.
6. Back in Home Assistant, open the satellite's device page (Settings →
   Devices & services → the kiosk Pi device from step 6). It exposes **Wake
   Word 1** and **Wake Word 2** selects — pick "Hey Cal" for one and "Okay
   Cal" for the other, so both phrases work at once, rather than picking a
   single default via `WAKE_MODEL`.

**Caveats**: I can't run this notebook or the satellite from here, so I
can't independently confirm the manifest fields above still match exactly —
if a file fails to load, cross-check it against a bundled model's own
`.json` (same folder as the stock `.tflite` files this app ships with) rather
than against this doc. And since neither phrase is a common word, false
triggers should be rare either way, but if one still fires too easily (or not
easily enough) once you're testing for real, `probability_cutoff` above is
the first knob to try before retraining.

## 8. Wake overlay on the display

`linux-voice-assistant` exposes a local WebSocket ("peripheral API", port
6055 by default) with a full conversation lifecycle: `wake_word_detected`,
`listening`, `stt_text` (what you said), `thinking`, `tts_text` (what Cal's
about to say), `tts_speaking`, `tts_finished`, `idle`. The calendar server
connects to it automatically (no config needed, since both run on the same
kiosk Pi) and re-broadcasts these to the kiosk UI over its own WebSocket.
The overlay: a single ping when the wake word fires (not a repeating one —
that read as harsh/frantic in practice), a gentle breathing pulse while
listening/thinking, and a livelier pulse while Cal is actually speaking.
`idle` is the real dismiss signal; a timeout is only a safety net in case
`idle` never arrives (a dropped connection, LVA restarting mid-conversation).

The "speaking" pulse is **not** driven by real audio amplitude — LVA's
peripheral API doesn't expose waveform/level data, only the `tts_speaking`
boundary event. It's a simulated, organic-feeling wobble instead (layered
sine waves + a little randomness), which is enough to feel alive without
needing to separately capture the Pi's actual audio output.

**Testing this without the hardware**: visit `http://<kiosk-ip>:3001/voice-test`
(served by the calendar server itself, no extra process to run) — one click
per row plays out a full realistic conversation (wake → listening →
transcript → thinking → response → speaking → idle) on the kiosk display,
with individual-step buttons below for finer control. This is what I used
to verify the overlay end-to-end while building it, since there's no real
LVA installation reachable from here.

That page works by POSTing straight to `/api/voice/simulate`, which
bypasses the WebSocket connection to LVA and goes directly to the broadcast
— good enough to verify the overlay itself, but it doesn't exercise
voiceBridge.js's actual connection code. For that (closer to how it'll
really run, at the cost of a second process), `dev-tools/mock-lva-server.mjs`
(`npm run dev:mock-lva`) stands in for a real LVA instance on the real
port — the calendar server discovers and connects to it exactly like it
would the real thing. Its own control panel at `http://localhost:6056` has
the same buttons.

The only genuinely untested part, either way, is LVA actually emitting
these events for real, which depends on it being installed and paired
first (see above).

## Testing, in order

Test from the bottom up — each layer here can be checked independently of
the one above it, which makes it much faster to find where something's
actually broken:

1. **The calendar's own API** (no HA involved at all): from any machine on
   your LAN, `curl -X POST http://<kiosk-ip>:3001/api/focus -d '{"view":"week"}' -H "Content-Type: application/json"`
   and confirm the kiosk display switches to Week. If this doesn't work,
   the problem is in the calendar app, not voice — see the main README.
2. **The rest_command from HA**: Developer Tools → Actions → run
   `rest_command.calendar_focus` with `view: today` and confirm the display
   switches. If this fails but step 1 worked, the problem is HA's network
   path to the kiosk Pi (wrong IP, firewall) or the `rest_commands.yaml`
   config, not the calendar or the voice pipeline.
3. **The sentence trigger, typed**: Settings → Voice assistants → your
   pipeline → type (don't speak) "what's today" into the chat box. If this
   works but speaking doesn't, the problem is audio/STT, not the automation.
4. **The satellite itself**: say "Hey Cal" (or "Okay Cal", or whatever's
   currently set as `WAKE_MODEL` if you haven't done step 7 yet) near the
   kiosk Pi's mic. The wake overlay popping up on the display confirms LVA
   detected the wake word and the server's connection to it is working,
   *before* worrying about whether the rest of the pipeline (STT → HA → back to the display)
   completes — a useful checkpoint in the middle of this step. If the
   overlay never appears, check the server's logs for
   `[voice] Could not reach linux-voice-assistant` (means the connection
   itself isn't up) versus no such message but still no overlay (means LVA
   isn't emitting the event, or isn't detecting the wake word at all). This
   whole layer is the one most likely to need real troubleshooting given
   how new `linux-voice-assistant` is — if you get stuck here, the
   project's [debugging guide](https://github.com/OHF-Voice/linux-voice-assistant/blob/main/docs/debugging.md)
   is the right next stop, not this README.

## Not built here

- **A spoken readout of your actual events** ("you have a dentist
  appointment at 3") — deliberately left out. The responses above are short
  confirmations only; the screen is what shows the calendar data. Building
  a reliable spoken summary needs live HA templating against the
  `rest_command.calendar_events` response, which is a fair bit more fragile
  and worth its own pass once the basic loop above is confirmed working.
- **Voice-driven event creation** ("add a dentist appointment Tuesday at
  3") — needs slot-filling a fixed sentence trigger can't really do; a
  local LLM (Ollama) as an Assist fallback is the natural way to add this
  later.
- **Camera-based presence/wake** — see `pi-setup/gesture-swipe.py` for the
  gesture side; presence detection is a separate, not-yet-started piece.
- **Scripting the add-on installs themselves** — Supervisor's install/start
  API exists but authenticates with a token that's only available to
  processes already running inside HAOS, not from an external script on
  your Windows machine, so Whisper/Piper/Samba installs stay a manual
  Install-then-Start click in the UI (steps 3-4 above). Everything *after*
  that — the actual config content — is what steps 4-7 automate/streamline.

## Optional: WiFi without Ethernet (skip if you have a cable)

If you truly can't connect the HA Pi to Ethernet even for the first boot,
HAOS can join WiFi headlessly, but it's pickier than the equivalent
Raspberry Pi OS feature — the most common failure is Windows saving the
config file with the wrong line endings. A ready-to-edit template is at
[`ha-wifi-headless/my-network.example`](ha-wifi-headless/my-network.example)
in this folder:

1. Open it in VS Code (not Notepad — Notepad can silently reintroduce
   Windows line endings on save). Fill in your real SSID and password.
   Confirm the line-ending indicator in VS Code's status bar says **LF**,
   not CRLF, before saving.
2. Save the file as exactly `my-network` — **no extension** (VS Code's
   "save as" will try to keep `.example`; delete it from the filename box).
3. Format a spare USB stick as FAT32, label it `CONFIG` (all caps), and
   put the file at `CONFIG/network/my-network` on it (create the `network`
   folder). Plug the USB stick into the Pi before powering it on.
4. Boot the Pi. HAOS reads the file from the USB stick on first boot and
   applies it, then it's safe to unplug the stick on subsequent boots.

If it doesn't come up on WiFi within a few minutes, the fastest recovery is
just plugging in Ethernet for that one boot rather than debugging the
keyfile — everything past step 1 of this whole doc works identically over
either connection type.
