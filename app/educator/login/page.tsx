'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { X, Mail, Lock, GraduationCap, Chrome } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { warmAllModels } from '@/lib/modelWarmup';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { startGoogleSignIn } from '@/lib/googleAuth';

export default function EducatorLoginPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Please wait...');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setLoadingMessage('Signing in...');

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (authError) throw authError;

      if (authData.user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (profileError) throw profileError;

        if (profile?.role !== 'educator') {
          await supabase.auth.signOut();
          throw new Error('This account is not registered as an educator');
        }

        void warmAllModels(true).catch((warmupError) => {
          console.warn('Model warmup failed after educator login; continuing anyway.', warmupError);
        });
        router.push('/educator/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    setLoadingMessage('Opening Google...');

    try {
      await startGoogleSignIn('educator');
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Google sign in failed');
    }
  };

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
              <GraduationCap className="w-8 h-8" />
              <div>
                <h2 className="text-2xl font-bold">Educator Portal</h2>
                <p className="text-sm text-white/90">Access your teaching dashboard</p>
              </div>
            </div>
          </div>

          <div className="p-8">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'login' | 'signup')}>
              <TabsList className="grid w-full grid-cols-2 mb-8">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-6">
                  {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                      {error}
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
                    <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        id="login-email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="Enter your email"
                        className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent outline-none transition-all bg-[#f3f3f5]"
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-2">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="password"
                        id="login-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
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
                    {loading ? loadingMessage : 'Continue'}
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <div className="space-y-6">
                  {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                      {error}
                    </div>
                  )}

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                    <p className="font-semibold text-gray-900">Educator signup uses Google.</p>
                    <p className="mt-2">
                      New educators enter the institution access code once after Google sign in.
                      Existing approved emails keep their current educator data.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="w-full border border-gray-300 bg-white hover:bg-gray-50 text-gray-900 font-semibold py-3 rounded-lg transition-colors focus:outline-none focus:ring-4 focus:ring-gray-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Chrome className="w-5 h-5" />
                    {loading ? loadingMessage : 'Sign up with Google'}
                  </button>
                </div>
              </TabsContent>
            </Tabs>

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
          </div>
        </div>
      </div>
    </div>
  );
}
