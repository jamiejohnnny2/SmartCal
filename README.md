# Smart Calendar

A household calendar hub for a Raspberry Pi touchscreen. It links multiple
Google accounts, merges their calendars into one view, and lets you add
events from the touchscreen that get written back to the right person's
Google Calendar.

The screen is three pages: a month grid (bottom half, always visible), and
sharing the top half — a Detail page (Today/Week/Agenda, switched by tapping
a tab or swiping left/right) and a Gallery page (a photo slideshow, synced
from your phone). Swiping up or down toggles between the Detail and Gallery
pages, with the incoming page sliding in from whichever edge matches the
swipe direction. Voice commands can drive the exact same up/down/left/right
actions as a touch swipe — see
[Voice control](#6-voice-control-via-home-assistant-optional) below. A camera
handles presence detection only (waking/sleeping the physical screen), not
navigation — see [Screen sleep/wake](#5-screen-sleepwake-on-motion-optional).

- `server/` — Node.js/Express backend: Google OAuth, calendar sync, REST API
- `client/` — React (Vite) kiosk UI
- `pi-setup/` — systemd services + kiosk launch script + camera motion sensor/display power control for the Pi
- `homeassistant/` — voice control, including a from-scratch Home Assistant OS setup guide — see [Voice control](#6-voice-control-via-home-assistant-optional)

## 1. Google Cloud setup (one-time, do this yourself)

The app needs its own OAuth client so it can ask Google for permission to
read/write each household member's calendar.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (or reuse one you already have).
2. **APIs & Services → Library** — search for "Google Calendar API" and
   enable it.
3. **APIs & Services → OAuth consent screen** — choose **External**, fill in
   an app name and your email, and add your household's Google accounts as
   **test users** (while the app is unverified, only test users can sign in —
   that's fine for a private household app).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: add the value that will match
     `GOOGLE_REDIRECT_URI` below — for local dev that's
     `http://localhost:3001/api/accounts/oauth2callback`; once deployed on
     the Pi, also add `http://<pi-hostname-or-ip>:3001/api/accounts/oauth2callback`.
5. Copy the generated **Client ID** and **Client secret**.

## 2. Local development

```bash
cp server/.env.example server/.env
# then edit server/.env and paste in your Client ID / Client secret
npm install
npm run dev
```

This runs the API on `http://localhost:3001` and the UI (with hot reload) on
`http://localhost:5173`. Open the UI, click **Accounts**, and link each
household Google account — the OAuth consent screen is easiest to complete
on a phone or laptop, so the panel gives you a QR code/link for that.

## 3. Deploying to the Raspberry Pi

Assumes a Raspberry Pi 4/5 running Raspberry Pi OS (Bookworm, with desktop)
and an attached touchscreen. Adjust paths/package manager commands if your
setup differs.

```bash
# On the Pi:
sudo apt update
sudo apt install -y nodejs npm chromium-browser unclutter

git clone <your-repo-url> "Smart Calender"
cd "Smart Calender"
npm install
npm run build:client

cp server/.env.example server/.env
nano server/.env   # fill in GOOGLE_CLIENT_ID/SECRET, and update
                    # GOOGLE_REDIRECT_URI to http://<pi-ip>:3001/api/accounts/oauth2callback
```

Install the systemd service so the server starts on boot:

```bash
sudo cp pi-setup/smart-calendar.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smart-calendar
sudo systemctl status smart-calendar   # confirm it's running
```

Allow the server to reboot the Pi (needed for the on-screen system menu's
"Restart Pi" — see below; skip this and that one button just won't work,
everything else is unaffected):

```bash
sudo cp pi-setup/sudoers-smart-calendar /etc/sudoers.d/smart-calendar
sudo chmod 440 /etc/sudoers.d/smart-calendar
sudo visudo -cf /etc/sudoers.d/smart-calendar   # validates syntax before it's live
```

Set up the kiosk browser to launch on desktop login:

```bash
chmod +x pi-setup/kiosk.sh
mkdir -p ~/.config/autostart
cp pi-setup/smart-calendar-kiosk.desktop ~/.config/autostart/
```

Edit both `pi-setup/smart-calendar.service` and
`pi-setup/smart-calendar-kiosk.desktop` first if your username or clone path
isn't `pi` / `/home/pi/Smart Calender` — update the `User=`,
`WorkingDirectory=`, and `Exec=` lines to match, then re-copy them.

Reboot the Pi — it should come up with the systemd service running and
Chromium in full-screen kiosk mode pointed at the calendar.

To link accounts once deployed, open `http://<pi-ip>:3001` from any other
device on your network (not the kiosk touchscreen) and use the Accounts
panel the same way as in local dev. That same panel — tap **Accounts** on
the kiosk itself, or from another device — lists each linked account's
individual calendars with a toggle per calendar, so a work account's own
meetings can be hidden from the kiosk display without unlinking the whole
account (it still shows up when adding a new event, and nothing changes in
Google Calendar itself).

There's also an intentionally invisible tap target in the screen's top-left
corner (roughly a 64x64px square) that opens a small maintenance menu —
refresh the app, restart the Pi, or close the app entirely (it won't
relaunch itself; reboot or re-run `kiosk.sh` to bring it back). It's
invisible deliberately, since it's not meant to be part of the everyday UI —
remember where it is, since there's nothing on screen pointing to it.

## 4. Gallery photos

The Gallery page shows whatever images are in `server/data/gallery/` as a
slideshow. Sync photos into it from your phone:

1. Visit `http://<pi-ip>:3001/upload` from your phone (same network as the
   Pi). It's a plain page, no login — pick photos, upload, and they show up
   in the Gallery within a few seconds. The same page lists and lets you
   delete what's already there.
2. Alternatively, anything that drops image files (`.jpg`, `.png`, `.webp`,
   `.gif`) into `server/data/gallery/` works too — a Samba share, Syncthing,
   `scp`, whatever you'd rather use. The server just scans that folder; the
   upload page is one convenient way in, not the only one.

## 5. Screen sleep/wake on motion (optional)

Page navigation is touch or voice only (see
[Voice control](#6-voice-control-via-home-assistant-optional) below) — the
camera isn't used for that. Its one job is presence detection: notice
whether anyone's in the room at all, and use that to turn the physical
screen off after a while and back on the moment someone shows up —
`pi-setup/screen-wake.py`. It needs OpenCV, same as the rest of `pi-setup/`:

```bash
# On the Pi:
cd "Smart Calender/pi-setup"
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

This controls the **monitor's own power state** over its video cable (DDC/CI
or HDMI-CEC), not the Pi's — the Pi and kiosk app keep running the whole
time either way, so the display comes back instantly with the kiosk still
in exactly the state it was in.

**Figure out which backend your screen actually speaks, first** — this is
an Elo 2495, and Elo's own spec sheet documents VESA DDC/CI support for
power control but says nothing about HDMI-CEC, which is mainly a
consumer-TV feature a lot of commercial/open-frame monitors like this one
don't implement at all. `pi-setup/display-power.sh` defaults to DDC/CI for
that reason, but confirm it against your actual unit before relying on it:

```bash
# On the Pi:
sudo apt install ddcutil v4l-utils
sudo usermod -aG i2c pi   # lets ddcutil run without sudo; re-login or just
                          # restart the service below to pick it up

ddcutil detect            # confirms DDC/CI communication works at all
ddcutil capabilities | grep -A5 'Feature: D6'   # shows what power values it accepts

# One-shot test — the screen should visibly turn off, then on:
bash pi-setup/display-power.sh off
bash pi-setup/display-power.sh on
```

If `ddcutil detect` doesn't find the display, or `off` does nothing, try CEC
instead (needs actual CEC wiring/support on both ends, unconfirmed for this
model):
```bash
cec-ctl --adapter=/dev/cec0 --show-topology   # confirms a CEC sink is even detected
DISPLAY_POWER_BACKEND=cec bash pi-setup/display-power.sh off
DISPLAY_POWER_BACKEND=cec bash pi-setup/display-power.sh on
```

Once one of those actually works, set it up to run continuously:

```bash
sudo cp pi-setup/screen-wake.service /etc/systemd/system/
sudo nano /etc/systemd/system/screen-wake.service   # set DISPLAY_POWER_BACKEND
                                                     # if you needed cec above
sudo systemctl daemon-reload
sudo systemctl enable --now screen-wake
```

Default idle timeout is 10 minutes (`--idle-timeout 600` in the service
file's `ExecStart=`) — the screen turns off after that long with no motion,
and back on instantly when it sees any. **This hasn't been tested against
real hardware** (no camera or Elo display available while building it) —
`--debug` (add it to `ExecStart=`, or run the script directly first) prints
every frame's motion reading, which is the fastest way to tell if
`MOTION_AREA_MIN` at the top of `screen-wake.py` needs adjusting for your
camera's actual placement/lighting.

One more thing worth doing while you're in `~/.config/wayfire.ini` for the
portrait rotation: Wayfire has its own idle-based screen blanking (the
`[idle]` section's `dpms_timeout`), which would otherwise be a second,
independent system trying to manage the same screen's power alongside this
one. Turn it off so they don't fight each other:
```ini
[idle]
dpms_timeout = -1
```

**Caveat inherent to any motion-only sensor** (this isn't specific to the
implementation above — a dedicated PIR sensor would have the same
limitation): it can only see movement, not presence, so someone sitting
nearly still (reading, on a call) can still time out. If that turns out to
matter in practice, the fix is a lower motion threshold or a longer timeout,
not a different architecture.

## 6. Voice control via Home Assistant (optional)

Voice commands like "what's today" / "what's this week" can drive the
kiosk display the same way a touch swipe does, via a Home Assistant server.
See [homeassistant/README.md](homeassistant/README.md) for the full setup —
it now covers the whole path from a blank SD card (flashing Home Assistant
OS, onboarding, the two add-ons you need, and pairing) through to the
config that wires it to this app, and reuses the same `/api/focus` endpoint
the touch UI already drives.

**Bigger caveat than the gallery/screen-wake features above**: the voice
satellite project this depends on (`linux-voice-assistant`) is new and
still under active development — expect more real troubleshooting here
than with the rest of this app.

## Updating the deployed app

```bash
cd "Smart Calender"
git pull
npm install
npm run build:client
sudo systemctl restart smart-calendar
```
