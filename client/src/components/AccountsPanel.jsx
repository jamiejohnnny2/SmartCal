import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api.js';

export default function AccountsPanel({ accounts, onClose, onChanged }) {
  const [label, setLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState('');

  async function handleGenerateLink() {
    setError('');
    try {
      const { url } = await api.getAuthUrl(label.trim());
      setLinkUrl(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemove(id) {
    await api.deleteAccount(id);
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-2xl font-semibold text-slate-900">Linked accounts</h3>
          <button
            className="rounded-xl bg-slate-100 px-4 py-2 text-lg text-slate-700 active:bg-slate-200"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <ul className="mb-6 divide-y divide-slate-200">
          {accounts.length === 0 && <li className="py-3 text-slate-500">No accounts linked yet.</li>}
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: a.color }} />
                <div>
                  <div className="font-medium text-slate-900">{a.label}</div>
                  <div className="text-sm text-slate-500">{a.email}</div>
                </div>
              </div>
              <button
                className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 active:bg-red-100"
                onClick={() => handleRemove(a.id)}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-3 text-sm text-slate-600">
            Link a new Google account. Google's sign-in page works best on a phone or laptop — scan the QR code
            below with that device, or copy the link.
          </p>
          <input
            className="mb-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg"
            placeholder="Whose calendar is this? (e.g. Mom)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-lg font-medium text-white active:bg-blue-700"
            onClick={handleGenerateLink}
          >
            Generate link
          </button>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          {linkUrl && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <QRCodeSVG value={linkUrl} size={180} />
              <a href={linkUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-600 underline">
                {linkUrl}
              </a>
              <p className="text-xs text-slate-500">
                After completing sign-in on your phone, come back here and close this dialog — the account will
                appear in the list above within a few seconds.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
