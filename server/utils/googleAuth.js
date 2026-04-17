/**
 * Google Service Account auth helper.
 * Generates a short-lived OAuth2 Bearer token for the Sheets API
 * using the service account JSON stored in GOOGLE_SERVICE_ACCOUNT_JSON.
 *
 * No extra npm packages — uses Node.js built-in crypto + fetch.
 *
 * Usage:
 *   const { getSheetsAuthHeader } = require('../utils/googleAuth');
 *   const headers = await getSheetsAuthHeader();
 *   fetch(url, { headers })
 */

const crypto = require('crypto');

// Cache the token until 5 minutes before it expires
let _cachedToken = null;
let _tokenExpiry = 0;

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
}

async function fetchAccessToken(serviceAccount) {
  const now    = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;

  // The private key in the JSON has literal \n — convert to real newlines
  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Google token error: ${JSON.stringify(tokenData)}`);
  }

  return { token: tokenData.access_token, expiresIn: tokenData.expires_in || 3600 };
}

/**
 * Returns { Authorization: 'Bearer <token>' } ready to spread into fetch headers.
 * Reuses a cached token if still valid.
 */
async function getSheetsAuthHeader() {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && now < _tokenExpiry) {
    return { Authorization: `Bearer ${_cachedToken}` };
  }

  const sa = getServiceAccount();
  const { token, expiresIn } = await fetchAccessToken(sa);

  _cachedToken = token;
  _tokenExpiry = now + expiresIn - 300; // refresh 5min early

  return { Authorization: `Bearer ${_cachedToken}` };
}

/**
 * Returns the service account's client_email so you can tell users
 * which email to share their sheet with.
 */
function getServiceAccountEmail() {
  try {
    return getServiceAccount().client_email;
  } catch {
    return null;
  }
}

module.exports = { getSheetsAuthHeader, getServiceAccountEmail };
