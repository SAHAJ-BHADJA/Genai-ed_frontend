'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import {
  AuthRole,
  clearStoredGoogleRole,
  finalizeGoogleLogin,
  getStoredGoogleRole,
} from '@/lib/googleAuth';
import { supabase } from '@/lib/supabase';

function resolveRole(value: string | null): AuthRole | null {
  return value === 'educator' || value === 'student' ? value : null;
}

export default function GoogleAuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function finalize() {
      const role = resolveRole(searchParams.get('role')) || getStoredGoogleRole();
      if (!role) {
        setError('Missing portal role. Please start Google sign in again.');
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          throw new Error('Google session was not created. Please try again.');
        }

        const result = await finalizeGoogleLogin(role);
        if (cancelled) return;

        if (result.requiresAccessCode) {
          router.replace(result.redirectTo || `/${role}/access-code`);
          return;
        }

        clearStoredGoogleRole();
        router.replace(result.redirectTo || `/${role}/dashboard`);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Google sign in failed.');
      }
    }

    finalize();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const fallbackRole = resolveRole(searchParams.get('role')) || getStoredGoogleRole() || 'student';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        {error ? (
          <div className="space-y-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => router.replace(`/${fallbackRole}/login`)}
              className="w-full bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 rounded-lg transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <div className="mx-auto h-10 w-10 rounded-full border-4 border-gray-200 border-t-brand-maroon animate-spin" />
            <h1 className="text-xl font-bold text-gray-900">Finishing Google sign in</h1>
            <p className="text-sm text-gray-600">Checking whether this account is already approved.</p>
          </div>
        )}
      </div>
    </div>
  );
}
