import { google } from 'googleapis';
import { db } from '../store/db.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl(state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  return { client, tokens };
}

// Returns an OAuth2 client bound to a stored account, persisting refreshed
// access tokens back to that same account record as they're issued.
export function clientForAccount(account) {
  const client = createOAuthClient();
  client.setCredentials(account.tokens);
  client.on('tokens', (tokens) => {
    account.tokens = { ...account.tokens, ...tokens };
    db.write();
  });
  return client;
}
