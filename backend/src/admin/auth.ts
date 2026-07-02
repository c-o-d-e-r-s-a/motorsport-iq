import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import supabase from '../db/supabaseClient';

const ADMIN_CREDENTIAL_ID = 'primary';
const ADMIN_SESSION_COOKIE = 'msp_admin_session';
const ADMIN_SESSION_DURATION_MS = 1000 * 60 * 60 * 12;
const MIN_ADMIN_SESSION_SECRET_LENGTH = 32;

type AdminSessionPayload = {
  exp: number;
};

type AdminCredentialRecord = {
  id: string;
  password_hash: string;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is required');
  }

  if (secret.length < MIN_ADMIN_SESSION_SECRET_LENGTH) {
    throw new Error(`ADMIN_SESSION_SECRET must be at least ${MIN_ADMIN_SESSION_SECRET_LENGTH} characters`);
  }

  return secret;
}

function getInitialPasswordHash(): string {
  const passwordHash = process.env.ADMIN_INITIAL_PASSWORD_HASH?.trim();
  if (!passwordHash) {
    throw new Error('ADMIN_INITIAL_PASSWORD_HASH is required before admin credentials exist in Supabase');
  }

  return passwordHash;
}

function isMissingAdminCredentialsTable(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? '';
  return message.includes("Could not find the table 'public.admin_credentials' in the schema cache");
}

function signValue(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createAdminSessionToken(expiresAt: number, secret = getSessionSecret()): string {
  const payload = base64UrlEncode(JSON.stringify({ exp: expiresAt } satisfies AdminSessionPayload));
  const signature = signValue(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyAdminSessionToken(token: string, secret = getSessionSecret()): boolean {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expectedSignature = signValue(payload, secret);
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return false;
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as AdminSessionPayload;
    return Number.isFinite(decoded.exp) && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};

  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey || rawValue.length === 0) return cookies;
    cookies[rawKey] = decodeURIComponent(rawValue.join('='));
    return cookies;
  }, {});
}

function getCookieSettings() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    secure: isProduction, // Required when sameSite is 'none'
    path: '/',
    maxAge: ADMIN_SESSION_DURATION_MS,
  };
}

async function ensureAdminCredential(): Promise<AdminCredentialRecord> {
  const { data: existing, error } = await supabase
    .from('admin_credentials')
    .select('id, password_hash')
    .eq('id', ADMIN_CREDENTIAL_ID)
    .maybeSingle();

  if (isMissingAdminCredentialsTable(error)) {
    return {
      id: ADMIN_CREDENTIAL_ID,
      password_hash: getInitialPasswordHash(),
    };
  }

  if (error) {
    throw new Error(`Failed to read admin credential: ${error.message}`);
  }

  if (existing) {
    return existing;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('admin_credentials')
    .insert({
      id: ADMIN_CREDENTIAL_ID,
      password_hash: getInitialPasswordHash(),
    })
    .select('id, password_hash')
    .single();

  if (insertError || !inserted) {
    if (isMissingAdminCredentialsTable(insertError)) {
      return {
        id: ADMIN_CREDENTIAL_ID,
        password_hash: getInitialPasswordHash(),
      };
    }

    throw new Error(`Failed to initialize admin credential: ${insertError?.message ?? 'unknown error'}`);
  }

  return inserted;
}

export async function validateAdminPassword(password: string): Promise<boolean> {
  const credential = await ensureAdminCredential();
  return bcrypt.compare(password, credential.password_hash);
}

export async function updateAdminPassword(currentPassword: string, nextPassword: string): Promise<void> {
  const credential = await ensureAdminCredential();
  const { error: tableCheckError } = await supabase
    .from('admin_credentials')
    .select('id')
    .eq('id', ADMIN_CREDENTIAL_ID)
    .maybeSingle();

  if (isMissingAdminCredentialsTable(tableCheckError)) {
    throw new Error('Apply the latest Supabase schema before changing the admin password');
  }

  const isValid = await bcrypt.compare(currentPassword, credential.password_hash);
  if (!isValid) {
    throw new Error('Current password is incorrect');
  }

  const password_hash = await bcrypt.hash(nextPassword, 10);
  const { error } = await supabase
    .from('admin_credentials')
    .update({
      password_hash,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ADMIN_CREDENTIAL_ID);

  if (error) {
    throw new Error(`Failed to update admin password: ${error.message}`);
  }
}

export function setAdminSessionCookie(res: Response): void {
  const token = createAdminSessionToken(Date.now() + ADMIN_SESSION_DURATION_MS);
  res.cookie(ADMIN_SESSION_COOKIE, token, getCookieSettings());
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE, {
    ...getCookieSettings(),
    maxAge: 0,
  });
}

export function hasValidAdminSession(req: Request): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_SESSION_COOKIE];
  return token ? verifyAdminSessionToken(token) : false;
}

export function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
  if (!hasValidAdminSession(req)) {
    res.status(401).json({ message: 'Admin authentication required' });
    return;
  }

  next();
}
