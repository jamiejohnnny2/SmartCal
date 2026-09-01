import { Router } from 'express';
import { broadcast } from '../services/wsHub.js';
import { LVA_EVENT_NAMES, mapLvaEvent } from '../services/voiceEvents.js';

const router = Router();

// Lets the wake overlay be tested end-to-end without linux-voice-assistant
// actually running — POSTs the same event shape its peripheral API sends.
// For a closer-to-real test (exercising the actual voiceBridge.js WebSocket
// connection rather than bypassing it), use dev-tools/mock-lva-server.mjs
// instead, which linux-voice-assistant would be if it were installed.
router.post('/simulate', (req, res) => {
  const { event, text } = req.body ?? {};
  const mapped = mapLvaEvent(event, { text });
  if (!mapped) return res.status(400).json({ error: `event must be one of: ${LVA_EVENT_NAMES.join(', ')}` });
  broadcast(mapped);
  res.status(204).end();
});

export default router;
