import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  typ: 'access';
}

export function signAccessToken(
  config: ApiConfig,
  claims: Omit<AccessTokenPayload, 'typ'>,
): string {
  return jwt.sign(
    { ...claims, typ: 'access' satisfies AccessTokenPayload['typ'] },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL } as jwt.SignOptions,
  );
}

export function verifyAccessToken(
  config: ApiConfig,
  token: string,
): AccessTokenPayload {
  const payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
  if (payload.typ !== 'access') {
    throw new Error('Invalid token type');
  }
  return payload;
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Parse durations like 15m / 7d into Date. */
export function refreshExpiryFromNow(ttl: string): Date {
  const match = /^(\d+)([smhd])$/i.exec(ttl.trim());
  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms =
    unit === 's'
      ? amount * 1000
      : unit === 'm'
        ? amount * 60 * 1000
        : unit === 'h'
          ? amount * 60 * 60 * 1000
          : amount * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}
