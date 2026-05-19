'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { X, Mail, Lock, GraduationCap, BookOpen, AlertCircle, Chrome } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { warmAllModels } from '@/lib/modelWarmup';
import { startGoogleSignIn } from '@/lib/googleAuth';

interface AuthCardProps {
  role: 'educator' | 'student';
}

export default function AuthCard({ role }: AuthCardProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('Signing in...');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setLoadingMessage('Signing in...');

    console.log('Starting login process...');

    try {
      console.log('Calling Supabase signInWithPassword...');
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      console.log('SignIn response:', { data, signInError });

      if (signInError) {
        console.error('SignIn error:', signInError);
        setError(signInError.message);
        setLoading(false);
        return;
      }

      if (!data.user) {
        console.error('No user returned from login');
        setError('Login failed. Please try again.');
        setLoading(false);
        return;
      }

      console.log('User authenticated, checking profile...');

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();

      console.log('Profile check result:', { profile, profileError });

      if (profileError || !profile) {
        console.error('Profile error or not found:', profileError);
        setError('Profile not found. Please contact support.');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      if (profile.role !== role) {
        console.error('Role mismatch:', { expected: role, actual: profile.role });
        setError(`This account is registered as ${profile.role}. Please use the correct portal.`);
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      console.log('Login successful, redirecting to dashboard...');
      setLoadingMessage('Preparing AI models...');
      try {
        await warmAllModels(true);
      } catch (warmupError) {
        console.warn('Model warmup failed during login; continuing anyway.', warmupError);
      }
      router.push(`/${role}/dashboard`);
    } catch (err) {
      console.error('Unexpected error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    setLoadingMessage('Opening Google...');

    try {
      await startGoogleSignIn(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed. Please try again.');
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
                <p className="text-sm text-white/90">Sign in to continue</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-8">
            <div className="space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full border border-gray-300 bg-white hover:bg-gray-50 text-gray-900 font-semibold py-3 rounded-lg transition-colors focus:outline-none focus:ring-4 focus:ring-gray-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Chrome className="w-5 h-5" />
                Continue with Google
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-3 text-gray-500">Existing password account</span>
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent outline-none transition-all bg-[#f3f3f5]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent outline-none transition-all bg-[#f3f3f5]"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="text-right">
                <a
                  href="#"
                  className="text-sm text-brand-maroon hover:underline focus:outline-none focus:ring-2 focus:ring-brand-maroon rounded px-1"
                >
                  Forgot password?
                </a>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 rounded-lg transition-colors focus:outline-none focus:ring-4 focus:ring-[#FFCC00]/50 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? loadingMessage : 'Sign In'}
              </button>
            </div>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Don&apos;t have an account?{' '}
                <a
                  href={`/${role}/signup`}
                  className="text-brand-maroon font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-brand-maroon rounded px-1"
                >
                  Sign up
                </a>
              </p>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-200">
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
          </form>
        </div>
      </div>
    </div>
  );
}
