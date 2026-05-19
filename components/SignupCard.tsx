'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, BookOpen, Chrome, GraduationCap, X } from 'lucide-react';
import { startGoogleSignIn } from '@/lib/googleAuth';

interface SignupCardProps {
  role: 'educator' | 'student';
}

export default function SignupCard({ role }: SignupCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignup = async () => {
    setError('');
    setLoading(true);

    try {
      await startGoogleSignIn(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign up failed. Please try again.');
      setLoading(false);
    }
  };

  const title = role === 'educator' ? 'Educator Portal' : 'Student Portal';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-brand-maroon text-white p-6 relative">
            <button
              onClick={() => router.push('/')}
              className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-white"
              aria-label="Close"
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
                <p className="text-sm text-white/90">Create your account with Google</p>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">First-time access is code protected.</p>
              <p className="mt-2">
                Sign up with Google, enter the institution access code once, then use Google for future logins.
              </p>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignup}
              disabled={loading}
              className="w-full border border-gray-300 bg-white hover:bg-gray-50 text-gray-900 font-semibold py-3 rounded-lg transition-colors focus:outline-none focus:ring-4 focus:ring-gray-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Chrome className="w-5 h-5" />
              {loading ? 'Opening Google...' : 'Sign up with Google'}
            </button>

            <div className="text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{' '}
                <a
                  href={`/${role}/login`}
                  className="text-brand-maroon font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-brand-maroon rounded px-1"
                >
                  Sign in
                </a>
              </p>
            </div>

            <div className="pt-6 border-t border-gray-200">
              <p className="text-xs text-center text-gray-500">
                By continuing, you agree to GenAI&apos;s{' '}
                <a href="#" className="text-brand-maroon hover:underline">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="#" className="text-brand-maroon hover:underline">
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
