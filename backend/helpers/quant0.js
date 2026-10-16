import {
  Quant0Client,
  AgentStrategy,
  InvalidTokenError,
  decodeClaims,
} from '@quant0/sdk-core';

const GATEWAY_URL = (
  process.env.QUANT0_GATEWAY_URL ||
  process.env.QUANT0_LOGIN_URL ||
  'https://auth.quant0.io'
).replace(/\/+$/, '');

const AGENT_URL = (
  process.env.QUANT0_AGENT_URL || 'http://127.0.0.1:9595'
).replace(/\/+$/, '');

/**
 * Remote Gateway Strategy conforming to @quant0/sdk-core's Strategy interface.
 * Fallback when strict agent verification is not enforced.
 */
export class GatewayStrategy {
  name = 'gateway';
  gatewayUrl;

  constructor(opts = {}) {
    this.gatewayUrl = (opts.gatewayUrl || GATEWAY_URL).replace(/\/+$/, '');
  }

  async available() {
    try {
      const res = await fetch(`${this.gatewayUrl}/.well-known/openid-configuration`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async verify(token) {
    if (!token) return false;
    try {
      const res = await fetch(`${this.gatewayUrl}/v1/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async mint() {
    throw new Error('GatewayStrategy does not support token minting; use q0-agent');
  }
}

/**
 * Strict Token Verification.
 * 
 * - When QUANT0_STRICT_AGENT=true (case-insensitive):
 *   The token MUST be cryptographically verified by the local q0-agent service.
 *   If the agent is stopped, unreachable, or rejects the token, access is DENIED immediately.
 * - Otherwise:
 *   Tries offline agent first; falls back to online gateway verification.
 */
export async function verifyToken(token) {
  if (!token) {
    throw new InvalidTokenError('Missing authentication token');
  }

  const isStrictAgent = String(process.env.QUANT0_STRICT_AGENT || 'true').trim().toLowerCase() === 'true';

  // 1. Probe local q0-agent sidecar
  let isAgentOnline = false;
  try {
    const health = await fetch(`${AGENT_URL}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    isAgentOnline = health.ok;
  } catch {
    isAgentOnline = false;
  }

  if (isAgentOnline) {
    try {
      const agentVerifier = new AgentStrategy({ agentUrl: AGENT_URL });
      const isValid = await agentVerifier.verify(token);
      if (isValid) {
        const claims = decodeClaims(token);
        return { ...claims, verificationMode: 'offline-agent' };
      } else {
        throw new InvalidTokenError('Token verification rejected by q0-agent (invalid signature or expired)');
      }
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        throw err;
      }
      console.warn('[quant0] Agent verification failed:', err.message);
      if (isStrictAgent) {
        throw new InvalidTokenError(`Strict verification failed: q0-agent error (${err.message})`);
      }
    }
  } else if (isStrictAgent) {
    throw new InvalidTokenError(
      `Strict verification failed: q0-agent sidecar is offline or unreachable at ${AGENT_URL}. Access denied.`
    );
  }

  // 2. Gateway Online Verification (Fallback only when strict agent mode is disabled)
  const gatewayVerifier = new GatewayStrategy({ gatewayUrl: GATEWAY_URL });
  const isValid = await gatewayVerifier.verify(token);
  if (!isValid) {
    throw new InvalidTokenError('Token is invalid, expired, or signature was rejected by Quant0');
  }

  const claims = decodeClaims(token);
  return { ...claims, verificationMode: 'gateway' };
}

/**
 * Fetch full profile dynamically from Quant0 (/v1/me or /v1/oauth/userinfo).
 */
export async function fetchMe(token) {
  if (!token) return null;

  try {
    const meRes = await fetch(`${GATEWAY_URL}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (meRes.ok) {
      return await meRes.json();
    }

    const uRes = await fetch(`${GATEWAY_URL}/v1/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (uRes.ok) {
      return await uRes.json();
    }
  } catch (err) {
    console.warn('[quant0] Profile lookup warning:', err.message);
  }

  return null;
}
