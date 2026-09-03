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
swipe direction. A camera gesture detector can drive the exact same
up/down/left/right actions as a touch swipe — see [Gestures](#5-camera-swipe-gestures-optional)
below.

- `server/` — Node.js/Express backend: Google OAuth, calendar sync, REST API
- `client/` — React (Vite) kiosk UI
- `pi-setup/` — systemd services + kiosk launch script + camera gesture detector for the Pi
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
panel the same way as in local dev.

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

## 5. Camera swipe gestures (optional)

A camera pointed at the room can drive the same up/down/left/right actions a
touch swipe does — `pi-setup/gesture-swipe.py` watches for a hand/arm
sweeping across the frame (plain motion tracking, no GPU/NPU needed) and
posts the direction to the server's `/api/gesture` endpoint.

**This hasn't been tested against a real camera** — it's built and the HTTP
side is verified, but the motion-detection thresholds will need tuning once
you can see real detections. Start here:

```bash
# On the Pi:
cd "Smart Calender/pi-setup"
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Test the server integration without a camera:
python3 gesture-swipe.py --simulate up

# Then try it against the real camera, watching what it detects:
python3 gesture-swipe.py --debug
```

If swipes aren't triggering, or trigger too easily, adjust the constants at
the top of `gesture-swipe.py` (`MOTION_AREA_MIN`, `SWIPE_MIN_DISPLACEMENT_PX`,
etc.) — `--debug` prints the displacement it measured for every candidate
gesture, accepted or not, which is the fastest way to see what to change.

Once it's behaving, install it as a service so it starts on boot:

```bash
sudo cp pi-setup/gesture-swipe.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gesture-swipe
```

(Edit the `WorkingDirectory=`/`User=` lines first if your setup differs from
`pi` / `/home/pi/Smart Calender`, same as the other service files.)

## 6. Voice control via Home Assistant (optional)

Voice commands like "what's today" / "what's this week" can drive the
kiosk display the same way a touch swipe does, via a Home Assistant server.
See [homeassistant/README.md](homeassistant/README.md) for the full setup —
it now covers the whole path from a blank SD card (flashing Home Assistant
OS, onboarding, the two add-ons you need, and pairing) through to the
config that wires it to this app, and reuses the same `/api/focus` endpoint
the touch UI already drives.

**Bigger caveat than the gallery/gesture features above**: the voice
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
