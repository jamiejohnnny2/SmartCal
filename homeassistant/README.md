# Voice control via Home Assistant

Lets you say "what's today" / "what's this week" / "what's coming up" and
have the kiosk display switch to that view, using the Home Assistant server
you already have running (the 8GB Pi) plus a small always-listening
satellite app on the kiosk Pi itself.

## Architecture

```
HA Pi (8GB, already running)              Kiosk Pi (4GB, the calendar)
├── Whisper add-on (speech-to-text)        ├── Node server (already built)
├── Piper add-on (text-to-speech)          ├── React kiosk UI (already built)
├── Assist pipeline (wires the above       └── linux-voice-assistant
│   together + wake word + intents)             — mic in / speaker out,
├── automations.yaml (this folder)               local wake word, streams
│   sentence triggers → rest_command             to HA after wake word
```

The heavy lifting (speech-to-text, text-to-speech) stays on the HA Pi, which
already has the RAM for it. The kiosk Pi only runs a lightweight satellite
app that listens locally for the wake word and streams audio to HA once
triggered — no speech models run on the kiosk Pi itself.

**Note on the software choice:** the original plan here was built around
`wyoming-satellite`, but that project was archived (deprecated) on GitHub in
January 2026. This uses its maintained successor,
[`linux-voice-assistant`](https://github.com/OHF-Voice/linux-voice-assistant)
(from the Open Home Foundation, the same org behind Home Assistant), which
talks to HA over the ESPHome protocol instead of Wyoming. It's newer and
less battle-tested than Wyoming was — expect it to need more troubleshooting
than a mature project would, since it's genuinely still under active
development. Whisper and Piper (the actual speech models) are unaffected by
this either way.

## 1. Home Assistant setup (on the existing HA Pi)

1. **Settings → Add-ons → Add-on Store**, install:
   - **Whisper** (speech-to-text)
   - **Piper** (text-to-speech)
   Start both after installing.
2. **Settings → Voice assistants → Add assistant**, create a pipeline using
   Whisper for STT and Piper for TTS. Pick whichever wake word / language
   options you want here — the sentence triggers below don't depend on which
   wake word you choose.
3. Copy `rest_commands.yaml` and `automations.yaml` from this folder into
   your Home Assistant config. Either:
   - Add `rest_command: !include homeassistant/rest_commands.yaml` and
     `automation: !include homeassistant/automations.yaml` to
     `configuration.yaml` (adjust the path to wherever you place these
     files relative to the HA config directory), or
   - Paste their contents directly into your existing `configuration.yaml`
     / `automations.yaml` under the `rest_command:` key and into your
     automations list, respectively.
4. In `rest_commands.yaml`, replace `KIOSK_PI_IP` with the kiosk Pi's actual
   LAN IP or hostname.
5. **Settings → System → Restart** (or reload automations/rest_commands
   from Developer Tools → YAML) to pick up the new config.

## 2. Kiosk Pi setup (the calendar Pi)

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

## 3. Pairing kiosk Pi ↔ Home Assistant

In Home Assistant: **Settings → Devices & services**. The satellite should
show up as a discovered device automatically (it advertises itself via
mDNS/Avahi) — if not, **Add Integration → ESPHome** and enter the kiosk
Pi's IP address.

Once paired, the satellite's wake word, microphone gain/noise-suppression,
and other tuning options are available as entities on that device page.

## 4. Wake overlay on the display

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
needing to separately capture the Pi's actual audio output. True
waveform-reactivity is possible later but needs its own audio-capture
plumbing, not just this event stream.

This needed a genuine push channel rather than the polling `/api/focus` and
`/api/gesture` use — a few seconds of lag is invisible for "switch to Week
view", but very visible for "show something happened the instant I spoke".

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
   path to the kiosk Pi (wrong IP, firewall) or the `rest_command.yaml`
   config, not the calendar or the voice pipeline.
3. **The sentence trigger, typed**: Settings → Voice assistants → your
   pipeline → type (don't speak) "what's today" into the chat box. If this
   works but speaking doesn't, the problem is audio/STT, not the automation.
4. **The satellite itself**: say the wake word near the kiosk Pi's mic. The
   wake overlay popping up on the display confirms LVA detected the wake
   word and the server's connection to it is working, *before* worrying
   about whether the rest of the pipeline (STT → HA → back to the display)
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
