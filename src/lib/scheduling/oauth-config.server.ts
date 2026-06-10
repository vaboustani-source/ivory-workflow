// Server-only: provider OAuth config, state signing, token exchange/refresh.
// Never import this from client-reachable modules.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Provider = "google" | "zoom";

export type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  // Extra auth-url params (Google needs access_type=offline + prompt=consent for refresh tokens)
  authorizeParams: Record<string, string>;
  // 'basic' = HTTP Basic auth with client_id:client_secret on the token endpoint
  // 'body'  = client_id + client_secret in the form body
  tokenAuthStyle: "basic" | "body";
};

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required secret: ${name}`);
  return v;
}

export function getProviderConfig(provider: Provider): ProviderConfig {
  if (provider === "google") {
    return {
      clientId: getEnv("GOOGLE_OAUTH_CLIENT_ID"),
      clientSecret: getEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
      authorizeParams: {
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
      tokenAuthStyle: "body",
    };
  }
  return {
    clientId: getEnv("ZOOM_OAUTH_CLIENT_ID"),
    clientSecret: getEnv("ZOOM_OAUTH_CLIENT_SECRET"),
    authorizeUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    userinfoUrl: "https://api.zoom.us/v2/users/me",
    scopes: [
      "meeting:write:meeting",
      "meeting:read:meeting",
      "user:read:user",
    ],
    authorizeParams: {},
    tokenAuthStyle: "basic",
  };
}

export function callbackPath(provider: Provider): string {
  return provider === "google"
    ? "/api/public/google-oauth-callback"
    : "/api/public/zoom-oauth-callback";
}

// ---------- Signed state ----------
// state = base64url(JSON({ u, n, t })) + "." + base64url(HMAC)
// u = user id, n = nonce (also stored in HttpOnly cookie), t = issued-at ms

const STATE_TTL_MS = 10 * 60 * 1000;

function hmacKey(): Buffer {
  // SUPABASE_SERVICE_ROLE_KEY is server-only and always present; use it as the
  // HMAC secret so we don't need to introduce a new secret for slice 1.
  return Buffer.from(getEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

function b64u(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64uDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function makeNonce(): string {
  return b64u(randomBytes(16));
}

export function signState(payload: { u: string; n: string }): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...payload, t: Date.now() })));
  const sig = b64u(createHmac("sha256", hmacKey()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(state: string, cookieNonce: string): { u: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64u(createHmac("sha256", hmacKey()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: { u: string; n: string; t: number };
  try {
    parsed = JSON.parse(b64uDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed.u || !parsed.n || typeof parsed.t !== "number") return null;
  if (Date.now() - parsed.t > STATE_TTL_MS) return null;
  if (parsed.n !== cookieNonce) return null;
  return { u: parsed.u };
}

// ---------- Token exchange / refresh ----------

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeCode(
  provider: Provider,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const cfg = getProviderConfig(provider);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cfg.tokenAuthStyle === "basic") {
    headers.Authorization =
      "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  } else {
    body.set("client_id", cfg.clientId);
    body.set("client_secret", cfg.clientSecret);
  }
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider} token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(
  provider: Provider,
  refreshToken: string,
): Promise<TokenResponse> {
  const cfg = getProviderConfig(provider);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cfg.tokenAuthStyle === "basic") {
    headers.Authorization =
      "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  } else {
    body.set("client_id", cfg.clientId);
    body.set("client_secret", cfg.clientSecret);
  }
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider} token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function fetchAccountEmail(
  provider: Provider,
  accessToken: string,
): Promise<string | null> {
  const cfg = getProviderConfig(provider);
  const res = await fetch(cfg.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  const email = data.email;
  return typeof email === "string" ? email : null;
}
