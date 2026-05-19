'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, BookOpen, GraduationCap, KeyRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AuthRole, clearStoredGoogleRole, verifyGoogleAccessCode } from '@/lib/googleAuth';

type AccessCodeCardProps = {
  role: AuthRole;
};

export default function AccessCodeCard({ role }: AccessCodeCardProps) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        router.replace(`/${role}/login`);
        return;
      }
      setEmail(data.session.user.email || '');
      setCheckingSession(false);
    });

    return () => {
      cancelled = true;
    };
  }, [role, router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await verifyGoogleAccessCode(role, code);
      clearStoredGoogleRole();
      router.replace(result.redirectTo || `/${role}/dashboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid access code.');
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    clearStoredGoogleRole();
    await supabase.auth.signOut();
    router.replace(`/${role}/login`);
  };

  const title = role === 'educator' ? 'Educator Access' : 'Student Access';

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-gray-700">Checking Google session...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-brand-maroon text-white p-6 relative">
            <button
              onClick={handleCancel}
              className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-white"
              aria-label="Cancel Google sign in"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              {role === 'educator' ? (
                <GraduationCap className="w-8 h-8" />
              ) : (
                <BookOpen className="w-8 h-8" />
              )}
              <div>
                <h2 className="text-2xl font-bold">{title}</h2>
                <p className="text-sm text-white/90">Enter your institution access code</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">Google account</p>
              <p className="mt-1 break-all">{email}</p>
              <p className="mt-3">This code is required only the first time this Google account joins Cogitatis AI.</p>
            </div>

            <div>
              <label htmlFor="access-code" className="block text-sm font-medium text-gray-700 mb-2">
                Access Code
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="access-code"
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Enter code"
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent outline-none transition-all bg-[#f3f3f5]"
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 rounded-lg transition-colors focus:outline-none focus:ring-4 focus:ring-[#FFCC00]/50 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying...' : 'Verify and Continue'}
            </button>

            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="w-full text-sm text-gray-600 hover:text-brand-maroon transition-colors"
            >
              Use a different account
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
