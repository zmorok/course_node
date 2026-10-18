import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const newRefreshToken = () => randomBytes(32).toString('base64url');
export const hashRefreshToken = token => createHash('sha256').update(token).digest('hex');
export const isRefreshToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function createAccessTokens({ secret, accessTtlSeconds }) {
  const key = Buffer.from(secret, 'hex');
  return {
    async sign(userId, sessionId) {
      return new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId).setJti(randomUUID()).setIssuer('workify-api').setAudience('workify-web')
        .setIssuedAt().setExpirationTime(`${accessTtlSeconds}s`).sign(key);
    },
    async verify(token) {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], typ: 'JWT',
        issuer: 'workify-api', audience: 'workify-web', requiredClaims: ['sub', 'sid', 'exp', 'iat', 'jti'],
        maxTokenAge: `${accessTtlSeconds}s` });
      if (!uuid.test(payload.sub) || typeof payload.sid !== 'string' || !uuid.test(payload.sid)) throw new Error('Invalid identity');
      return { userId: payload.sub, sessionId: payload.sid };
    },
  };
}
