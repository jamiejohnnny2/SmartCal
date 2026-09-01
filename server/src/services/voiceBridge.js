import WebSocket from 'ws';
import { broadcast } from './wsHub.js';
import { mapLvaEvent } from './voiceEvents.js';

// linux-voice-assistant runs on this same kiosk Pi and exposes a "peripheral"
// WebSocket API (see homeassistant/README.md) with events including
// wake_word_detected — documented as the cue to "start your wake animation".
// We connect to it as a client and re-broadcast the events that matter to
// our own kiosk UI clients over wsHub, since the UI can't reach LVA's
// WebSocket directly (different origin/port, and simpler to have one place
// that knows how to interpret LVA's event shape).
const LVA_URL = process.env.LVA_PERIPHERAL_URL || 'ws://localhost:6055';
const RECONNECT_DELAY_MS = 5000;

let hasLoggedFailure = false;

function handleEvent(msg) {
  const mapped = mapLvaEvent(msg.event, msg.data);
  if (mapped) broadcast(mapped);
}

function connect() {
  const ws = new WebSocket(LVA_URL);

  ws.on('open', () => {
    hasLoggedFailure = false;
    console.log(`[voice] Connected to linux-voice-assistant at ${LVA_URL}`);
  });

  ws.on('message', (data) => {
    try {
      handleEvent(JSON.parse(data.toString()));
    } catch {
      // ignore malformed frames
    }
  });

  ws.on('close', () => {
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on('error', () => {
    // Expected whenever linux-voice-assistant isn't running yet (dev, or
    // before it's set up on the Pi) — log once rather than every retry, and
    // let 'close' schedule the reconnect. Must not crash the server.
    if (!hasLoggedFailure) {
      hasLoggedFailure = true;
      console.warn(
        `[voice] Could not reach linux-voice-assistant at ${LVA_URL} — retrying every ${RECONNECT_DELAY_MS / 1000}s. This is expected until it's installed and running (see homeassistant/README.md).`,
      );
    }
  });
}

export function startVoiceBridge() {
  connect();
}
