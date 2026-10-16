/**
 * QUANT0 — Hosted-Redirect Authentication Client
 * 
 * Implements OAuth 2.1 Authorization Code Flow + PKCE (S256)
 * using standard browser APIs: fetch, Web Crypto, Web Storage.
 */

const GATEWAY = (
  import.meta.env.VITE_QUANT0_GATEWAY_URL ||
  'https://dev-api.quant0.io'
).replace(/\/+$/, '');

const CLIENT_ID = import.meta.env.VITE_QUANT0_CLIENT_ID || 'app_7f9970c770560b72';
const REDIRECT_URI =
  import.meta.env.VITE_QUANT0_REDIRECT_URI || `${window.location.origin}/callback`;
const POST_LOGOUT_URI =
  import.meta.env.VITE_QUANT0_POST_LOGOUT_REDIRECT_URI || `${window.location.origin}/login`;
const ACCOUNT_PORTAL = (
  import.meta.env.VITE_QUANT0_ACCOUNT_PORTAL_URL || ''
).replace(/\/+$/, '');

const AUTHORIZE_URL = `${GATEWAY}/v1/oauth/authorize`;
const TOKEN_URL = `${GATEWAY}/v1/oauth/token`;
const LOGOUT_URL = `${GATEWAY}/v1/oauth/logout`;
const SCOPE = 'openid profile email offline_access';

// Storage keys
const K_ACCESS = 'quant0.access_token';
const K_REFRESH = 'quant0.refresh_token';
const K_EXPIRES = 'quant0.expires_at';
const K_ID = 'quant0.id_token';
const K_USER = 'quant0.user';
const K_VERIFIER = 'quant0.pkce_verifier';
const K_STATE = 'quant0.pkce_state';
const K_RETURN = 'quant0.return_to';

export const QUANT0_ENABLED = Boolean(GATEWAY && CLIENT_ID);

/* ---------------------------------------------------------------- PKCE ---- */

function base64Url(bytes) {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return window.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlSafe(byteLength = 32) {
  const buf = new Uint8Array(byteLength);
  window.crypto.getRandomValues(buf);
  return base64Url(buf);
}

async function challengeFromVerifier(verifier) {
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

/* -------------------------------------------------------------- storage ---- */

export function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(payload));
  } catch {
    return {};
  }
}

function decodeJwtExpMs(token) {
  try {
    const claims = decodeJwtPayload(token);
    return typeof claims.exp === 'number' ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function storeTokens(data) {
  if (!data?.access_token) {
    throw new Error('Token response contained no access_token.');
  }
  localStorage.setItem(K_ACCESS, data.access_token);
  if (data.refresh_token) localStorage.setItem(K_REFRESH, data.refresh_token);
  if (data.id_token) localStorage.setItem(K_ID, data.id_token);

  const tokenToInspect = data.id_token || data.access_token;
  const claims = decodeJwtPayload(tokenToInspect);
  const profile = {
    sub: claims.sub,
    email: claims.email || claims.sub,
    name: claims.name || claims.email?.split('@')[0] || claims.sub,
    ...claims,
  };
  localStorage.setItem(K_USER, JSON.stringify(profile));

  const fromJwt = decodeJwtExpMs(data.access_token);
  const fromResponse = data.expires_in ? Date.now() + data.expires_in * 1000 : 0;
  const expiry =
    fromJwt && fromResponse
      ? Math.min(fromJwt, fromResponse)
      : fromJwt || fromResponse || Date.now() + 900_000;
  localStorage.setItem(K_EXPIRES, String(expiry));

  return { access_token: data.access_token, id_token: data.id_token, profile };
}

export function hasQuant0Session() {
  return Boolean(localStorage.getItem(K_ACCESS));
}

export function getQuant0AccessToken() {
  return localStorage.getItem(K_ACCESS);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(K_USER) || '{}');
  } catch {
    return {};
  }
}

export function clearQuant0Token() {
  [K_ACCESS, K_REFRESH, K_EXPIRES, K_ID, K_USER].forEach((k) =>
    localStorage.removeItem(k)
  );
  sessionStorage.removeItem(K_VERIFIER);
  sessionStorage.removeItem(K_STATE);
  sessionStorage.removeItem(K_RETURN);
}

/* ------------------------------------------------------------ redirect in -- */

/**
 * Initiates the full-page redirect to Quant0 Login Portal with PKCE parameters.
 */
export async function redirectToQuant0Login({ screenHint, returnTo, prompt } = {}) {
  if (!CLIENT_ID || CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    alert('Quant0 Client ID is not configured yet!\nPlease open frontend/.env and set VITE_QUANT0_CLIENT_ID to your application Client ID from your Quant0 dashboard.');
    return;
  }

  const verifier = randomUrlSafe(32);
  const state = randomUrlSafe(16);
  const challenge = await challengeFromVerifier(verifier);

  sessionStorage.setItem(K_VERIFIER, verifier);
  sessionStorage.setItem(K_STATE, state);
  if (returnTo) sessionStorage.setItem(K_RETURN, returnTo);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: SCOPE,
    state,
  });
  if (screenHint) params.set('screen_hint', screenHint);
  if (prompt) params.set('prompt', prompt);

  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

/* ----------------------------------------------------------- redirect out -- */

export function consumeQuant0ReturnTo() {
  const to = sessionStorage.getItem(K_RETURN);
  sessionStorage.removeItem(K_RETURN);
  return to || null;
}

/**
 * Completes authorization exchange at /callback.
 */
export async function exchangeQuant0Code() {
  const qs = new URLSearchParams(window.location.search);

  const err = qs.get('error');
  if (err) throw new Error(qs.get('error_description') || err);

  const code = qs.get('code');
  const state = qs.get('state');
  if (!code) throw new Error('Sign-in did not return an authorization code.');

  const verifier = sessionStorage.getItem(K_VERIFIER);
  const expectedState = sessionStorage.getItem(K_STATE);
  if (!verifier) {
    throw new Error('Your sign-in session expired or was already completed. Please sign in again.');
  }
  if (expectedState && state && expectedState !== state) {
    throw new Error('Sign-in could not be verified (state mismatch).');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${detail}`.trim());
  }

  const data = await res.json();
  const stored = storeTokens(data);

  sessionStorage.removeItem(K_VERIFIER);
  sessionStorage.removeItem(K_STATE);

  return stored;
}

/* ---------------------------------------------------------------- refresh -- */

const REFRESH_SKEW_MS = 60_000;
let pendingRefresh = null;

async function refreshQuant0Token() {
  const refresh = localStorage.getItem(K_REFRESH);
  if (!refresh) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: CLIENT_ID,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    clearQuant0Token();
    return null;
  }

  const data = await res.json();
  const stored = storeTokens(data);
  return stored.access_token;
}

/**
 * Returns a valid access token, silently refreshing it if close to expiry.
 */
export async function getFreshQuant0Token() {
  const token = localStorage.getItem(K_ACCESS);
  if (!token) return null;

  const expiresAt = Number(localStorage.getItem(K_EXPIRES) || 0);
  if (expiresAt && Date.now() < expiresAt - REFRESH_SKEW_MS) return token;

  if (!pendingRefresh) {
    pendingRefresh = refreshQuant0Token().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

/* ---------------------------------------------------------------- sign out -- */

export async function quant0SignOut({ returnTo = POST_LOGOUT_URI } = {}) {
  const token = localStorage.getItem(K_ACCESS);
  clearQuant0Token();

  if (token) {
    const params = new URLSearchParams({ client_id: CLIENT_ID });
    if (returnTo) params.set('post_logout_redirect_uri', returnTo);
    try {
      await fetch(`${LOGOUT_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        mode: 'cors',
      });
    } catch {
      // Best-effort logout; credentials already removed locally
    }
  }

  window.location.assign(returnTo || '/login');
}
