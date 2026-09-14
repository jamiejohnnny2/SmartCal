import { useState } from 'react';
import { api } from '../api.js';

// Reached via an invisible tap target in the screen's top-left corner (see
// App.jsx) — deliberately not a visible button, since this is a maintenance
// panel (refresh/restart/close), not something meant to be part of the
// everyday kiosk UI a household member taps through.
export default function SystemMenu({ onClose }) {
  // Which action is awaiting a second confirming tap — 'restart' | 'close' | null.
  const [confirming, setConfirming] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function handleRestart() {
    if (confirming !== 'restart') {
      setConfirming('restart');
      return;
    }
    setError('');
    setStatus('Restarting the Pi…');
    try {
      await api.restartPi();
    } catch (err) {
      setError(err.message);
      setStatus('');
    }
  }

  async function handleClose() {
    if (confirming !== 'close') {
      setConfirming('close');
      return;
    }
    setError('');
    try {
      await api.closeApp();
      setStatus('App closed — it comes back on the next reboot, or run kiosk.sh again.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-2xl text-ink">System</h3>
          <button
            className="rounded-xl bg-surface-2 px-4 py-2 text-base text-muted active:bg-line"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="space-y-3">
          <button
            className="w-full rounded-xl bg-surface-2 px-4 py-3 text-left text-lg text-ink active:bg-line"
            onClick={() => window.location.reload()}
          >
            Refresh app
          </button>

          <button
            className={`w-full rounded-xl px-4 py-3 text-left text-lg active:opacity-80 ${
              confirming === 'restart' ? 'bg-red-500/20 text-red-300' : 'bg-surface-2 text-ink'
            }`}
            onClick={handleRestart}
          >
            {confirming === 'restart' ? 'Tap again to restart the Pi' : 'Restart Pi'}
          </button>

          <button
            className={`w-full rounded-xl px-4 py-3 text-left text-lg active:opacity-80 ${
              confirming === 'close' ? 'bg-red-500/20 text-red-300' : 'bg-surface-2 text-ink'
            }`}
            onClick={handleClose}
          >
            {confirming === 'close' ? 'Tap again to close the app' : 'Close app'}
          </button>
        </div>

        {status && <p className="mt-4 text-sm text-muted">{status}</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
