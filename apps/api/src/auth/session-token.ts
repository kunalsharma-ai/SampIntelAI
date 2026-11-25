import { jwtVerify, SignJWT } from 'jose';

export interface SessionClaims {
  sid: string;
  tid: string;
}

/** The cookie holds only a signed session id; the session row decides whether it is still valid. */
export class SessionTokens {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }
  async sign(c: SessionClaims, ttlSeconds: number): Promise<string> {
    return new SignJWT({ tid: c.tid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.sid)
      .setIssuer('sampintel')
      .setAudience('sampintel-web')
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }
  async verify(token: string): Promise<SessionClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'sampintel',
        audience: 'sampintel-web',
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') return null;
      return { sid: payload.sub, tid: payload.tid };
    } catch {
      return null;
    }
  }
}

export const SESSION_COOKIE = 'si_session';
