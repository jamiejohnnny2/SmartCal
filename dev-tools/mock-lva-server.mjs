#!/usr/bin/env node
// Stands in for a real linux-voice-assistant instance during development.
// The calendar server's voiceBridge.js connects to this exactly like it
// would the real thing (same host/port, same event shape) — so clicking
// buttons here exercises the actual production integration path, not a
// bypass, and lets you watch the wake overlay live before any hardware
// exists. See homeassistant/README.md for what this stands in for.
//
// Usage: node dev-tools/mock-lva-server.mjs
// Then open http://localhost:6056 and make sure the calendar server
// (npm run dev:server) is also running — it reconnects to this every 5s.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_PORT = 6055; // matches linux-voice-assistant's real default
const HTTP_PORT = 6056;

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[mock-lva] Peripheral API listening on ws://localhost:${WS_PORT}`);

wss.on('connection', (ws) => {
  console.log('[mock-lva] calendar server connected');
  ws.send(
    JSON.stringify({
      event: 'snapshot',
      data: { muted: false, volume: 1, ha_connected: true, last_stt_text: null, last_tts_text: null },
    }),
  );
  ws.on('close', () => console.log('[mock-lva] calendar server disconnected'));
});

function emit(event, data = {}) {
  const payload = JSON.stringify({ event, data });
  console.log(`[mock-lva] -> ${event}`, data);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runConversation(transcript, response) {
  emit('wake_word_detected');
  await sleep(500);
  emit('listening');
  await sleep(1200);
  emit('stt_text', { text: transcript });
  emit('thinking');
  await sleep(700);
  emit('tts_text', { text: response });
  emit('tts_speaking');
  await sleep(2800);
  emit('tts_finished');
  await sleep(300);
  emit('idle');
}

const CONVERSATIONS = {
  today: ["what's today", "Here's today."],
  week: ["what's this week", 'Here you go.'],
  agenda: ["what's coming up", "Here's what's coming up."],
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/trigger')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let action;
      try {
        ({ action } = JSON.parse(body || '{}'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (action in CONVERSATIONS) {
        runConversation(...CONVERSATIONS[action]);
      } else {
        emit(action);
      }
      res.writeHead(204).end();
    });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'mock-lva-control.html')));
    return;
  }

  res.writeHead(404).end();
});

server.listen(HTTP_PORT, () => {
  console.log(`[mock-lva] Control panel: http://localhost:${HTTP_PORT}`);
});
