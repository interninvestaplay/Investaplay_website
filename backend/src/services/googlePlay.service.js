const crypto = require('crypto');

// Default package name from app.json
const DEFAULT_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.quizzyfox.game';

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Loads service account credentials from environment variables or file
 */
function getServiceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      console.error('[GooglePlay] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err.message);
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    try {
      const fs = require('fs');
      const path = require('path');
      const resolved = path.resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH);
      if (fs.existsSync(resolved)) {
        return JSON.parse(fs.readFileSync(resolved, 'utf8'));
      }
    } catch (err) {
      console.error('[GooglePlay] Failed to load key from GOOGLE_SERVICE_ACCOUNT_KEY_PATH:', err.message);
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

/**
 * Obtains an OAuth2 access token for the Google Play Developer API using Service Account RS256 JWT
 */
async function getGooglePlayAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && tokenExpiresAt > now + 60) {
    return cachedAccessToken;
  }

  const credentials = getServiceAccountCredentials();
  if (!credentials || !credentials.client_email || !credentials.private_key) {
    return null;
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  const signature = signer
    .sign(credentials.private_key)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const signedJwt = `${unsignedToken}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    throw new Error(`Failed to obtain Google Play access token: ${tokenRes.status} ${errorText}`);
  }

  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = now + (Number(tokenData.expires_in) || 3600);

  return cachedAccessToken;
}

/**
 * Acknowledges a purchase with Google Play to prevent auto-refund after 3 days
 */
async function acknowledgePurchase({ packageName, productId, token, developerPayload }) {
  try {
    const accessToken = await getGooglePlayAccessToken();
    if (!accessToken) return false;

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      packageName || DEFAULT_PACKAGE_NAME
    )}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ developerPayload: developerPayload || '' }),
    });

    return res.ok;
  } catch (err) {
    console.error('[GooglePlay] Acknowledge error:', err.message);
    return false;
  }
}

/**
 * Consumes a consumable product purchase with Google Play Developer API.
 * Consuming allows the user to purchase the coin pack again without getting "You already own this item".
 */
async function consumePurchase({ packageName, productId, token }) {
  try {
    const accessToken = await getGooglePlayAccessToken();
    if (!accessToken) return false;

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      packageName || DEFAULT_PACKAGE_NAME
    )}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[GooglePlay] Consume response ${res.status}: ${errText}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[GooglePlay] Consume error:', err.message);
    return false;
  }
}

/**
 * Verifies in-app product purchase with Google Play Developer API
 *
 * @param {Object} params
 * @param {string} params.packageName
 * @param {string} params.productId (SKU)
 * @param {string} params.token (purchaseToken from Google Play)
 * @param {string} [params.orderId]
 * @returns {Promise<{ valid: boolean, status: 'COMPLETED'|'PENDING'|'FAILED'|'CANCELLED'|'INVALID_TOKEN'|'SERVER_MISCONFIGURED', isTestPurchase?: boolean, orderId?: string, raw?: any, message?: string }>}
 */
async function verifyProductPurchase({ packageName, productId, token, orderId }) {
  const pkg = packageName || DEFAULT_PACKAGE_NAME;

  if (!token || typeof token !== 'string' || token.trim().length < 5) {
    return {
      valid: false,
      status: 'INVALID_TOKEN',
      message: 'Missing or malformed Google Play purchase token.',
    };
  }

  // Prevent any fake or simulated tokens from passing through real verification
  const lowerToken = token.trim().toLowerCase();
  if (
    lowerToken.startsWith('mock_') ||
    lowerToken.startsWith('fake_') ||
    lowerToken.startsWith('gp_token_') ||
    lowerToken.includes('simulated')
  ) {
    return {
      valid: false,
      status: 'INVALID_TOKEN',
      message: 'Simulated or mock purchase tokens are not permitted. Real Google Play purchase token required.',
    };
  }

  const credentials = getServiceAccountCredentials();

  // If no Google service account credentials configured, do NOT fake a success.
  // Real Google Play verification requires valid service account credentials.
  if (!credentials) {
    console.error(
      `[GooglePlay] Service account credentials not configured. Cannot verify real Google Play purchase for SKU: ${productId}`
    );
    return {
      valid: false,
      status: 'SERVER_MISCONFIGURED',
      message:
        'Google Play Service Account credentials not configured on backend. Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON in .env to verify real purchases.',
    };
  }

  // Real Google Play API verification
  try {
    const accessToken = await getGooglePlayAccessToken();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      pkg
    )}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 404) {
      return {
        valid: false,
        status: 'INVALID_TOKEN',
        message: 'Purchase token not found or expired on Google Play.',
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return {
        valid: false,
        status: 'FAILED',
        message: `Google Play API error: ${response.status} ${errorText}`,
      };
    }

    const data = await response.json();

    // purchaseState: 0 = Purchased, 1 = Canceled, 2 = Pending
    if (data.purchaseState === 1) {
      return {
        valid: false,
        status: 'CANCELLED',
        orderId: data.orderId || orderId,
        raw: data,
        message: 'Google Play reported the purchase was cancelled.',
      };
    }

    if (data.purchaseState === 2) {
      return {
        valid: false,
        status: 'PENDING',
        orderId: data.orderId || orderId,
        raw: data,
        message: 'Purchase is currently pending in Google Play.',
      };
    }

    if (data.purchaseState === 0) {
      // purchaseType: 0 = Test purchase (License tester), 1 = Promo code, undefined = Normal purchase
      const isTestPurchase = data.purchaseType === 0;

      return {
        valid: true,
        status: 'COMPLETED',
        isTestPurchase,
        orderId: data.orderId || orderId || null,
        consumptionState: data.consumptionState,
        raw: data,
      };
    }

    return {
      valid: false,
      status: 'FAILED',
      orderId: data.orderId || orderId,
      raw: data,
      message: `Unknown purchase state from Google Play: ${data.purchaseState}`,
    };
  } catch (err) {
    console.error('[GooglePlay] Verification request exception:', err);
    return {
      valid: false,
      status: 'FAILED',
      message: `Failed to contact Google Play verification servers: ${err.message}`,
    };
  }
}

module.exports = {
  verifyProductPurchase,
  acknowledgePurchase,
  consumePurchase,
  getGooglePlayAccessToken,
};
