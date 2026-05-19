'use client';

import { supabase } from '@/lib/supabase';
import { getBackendBase } from '@/lib/backend';

export type AuthRole = 'educator' | 'student';

type GoogleAuthResponse = {
  requiresAccessCode: boolean;
  redirectTo?: string;
  email?: string;
  role?: AuthRole;
  profile?: unknown;
};

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error(error?.message || 'Google session was not found. Please sign in again.');
  }
  return data.session.access_token;
}

async function googleAuthRequest(path: string, body: Record<string, unknown>): Promise<GoogleAuthResponse> {
  const token = await getAccessToken();
  const response = await fetch(`${getBackendBase()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail;
    throw new Error(typeof detail === 'string' ? detail : 'Google authentication failed.');
  }

  return payload;
}

export async function startGoogleSignIn(role: AuthRole) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem('google_auth_role', role);
  const redirectTo = `${window.location.origin}/auth/callback?role=${role}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}

export function getStoredGoogleRole(): AuthRole | null {
  if (typeof window === 'undefined') return null;
  const role = window.localStorage.getItem('google_auth_role');
  return role === 'educator' || role === 'student' ? role : null;
}

export function clearStoredGoogleRole() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('google_auth_role');
  }
}

export function finalizeGoogleLogin(role: AuthRole) {
  return googleAuthRequest('/api/auth/google/finalize', { role });
}

export function verifyGoogleAccessCode(role: AuthRole, code: string) {
  return googleAuthRequest('/api/auth/google/verify-code', { role, code });
}
