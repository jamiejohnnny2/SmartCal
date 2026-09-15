import { WebSocketServer } from 'ws';

let wss = null;

// Mounts a WebSocket server on the same HTTP server Express already listens
// on (no separate port) for pushing low-latency events to the kiosk UI —
// polling (as /api/focus uses) is fine for voice commands where a second or
// two of delay is imperceptible, but the wake overlay needs to feel instant,
// which polling can't give us.
export function attachWsHub(httpServer, path) {
  wss = new WebSocketServer({ server: httpServer, path });
  wss.on('connection', (ws) => {
    ws.on('error', () => ws.terminate());
  });
  return wss;
}

export function broadcast(message) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
