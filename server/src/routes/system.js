import { Router } from 'express';
import { execFile } from 'node:child_process';

const router = Router();

// Reboots the whole Pi. The server runs as an unprivileged user (see
// smart-calendar.service), so this only works if a sudoers rule grants
// exactly this command passwordlessly — see pi-setup/sudoers-smart-calendar
// and the README for why it's scoped to this one command and nothing wider.
router.post('/restart', (req, res) => {
  execFile('sudo', ['/sbin/reboot'], (err) => {
    // The Pi is rebooting either way by the time this would matter — this is
    // just so a *failure to even start* the reboot (missing sudoers rule,
    // wrong path) shows up somewhere instead of silently doing nothing.
    if (err) console.error('[system] restart failed:', err.message);
  });
  res.json({ ok: true });
});

// Exits the kiosk browser (not the Pi, not this server) — chromium-browser
// runs as the same "pi" user this server does (see kiosk.sh), so unlike
// restart above, this needs no elevated privileges. Nothing relaunches it
// automatically; it comes back on the next reboot (autostart) or by manually
// re-running kiosk.sh.
router.post('/close', (req, res) => {
  execFile('pkill', ['-f', 'chromium-browser'], (err) => {
    // pkill exits with code 1 when nothing matched — not a real failure.
    if (err && err.code !== 1) console.error('[system] close failed:', err.message);
  });
  res.json({ ok: true });
});

export default router;
