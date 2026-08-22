'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Profile } from '@/lib/supabase';
import StudentLayout from '@/components/StudentLayout';
import { ArrowLeft, ClipboardCheck, Sparkles } from 'lucide-react';

export default function TestKnowledge() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/student/login');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || profileData.role !== 'student') {
        await supabase.auth.signOut();
        router.push('/student/login');
        return;
      }

      setProfile(profileData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <StudentLayout profile={profile}>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/student/dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors px-4 py-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Back</span>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Test Your Knowledge</h1>
            <p className="text-gray-600 mt-1">Practice quizzes and assessments</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="mb-8">
            <div className="relative inline-block">
              <ClipboardCheck className="w-24 h-24 text-brand-maroon mx-auto" />
              <Sparkles className="w-8 h-8 text-brand-yellow absolute -top-2 -right-2" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-4">Coming Soon</h2>
          <p className="text-lg text-gray-600 mb-2">
            Practice quizzes and assessments are currently under development
          </p>
          <p className="text-gray-500 max-w-2xl mx-auto">
            Soon you&apos;ll be able to test your understanding with AI-generated quizzes, practice problems, and assessments tailored to your course materials.
          </p>

          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4">Planned Features:</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left max-w-2xl mx-auto">
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="w-2 h-2 bg-brand-maroon rounded-full mt-2"></div>
                <div>
                  <h4 className="font-medium text-gray-900">AI-Generated Quizzes</h4>
                  <p className="text-sm text-gray-600">Custom practice questions</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="w-2 h-2 bg-brand-maroon rounded-full mt-2"></div>
                <div>
                  <h4 className="font-medium text-gray-900">Instant Feedback</h4>
                  <p className="text-sm text-gray-600">Detailed explanations</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="w-2 h-2 bg-brand-maroon rounded-full mt-2"></div>
                <div>
                  <h4 className="font-medium text-gray-900">Progress Tracking</h4>
                  <p className="text-sm text-gray-600">Monitor your improvement</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="w-2 h-2 bg-brand-maroon rounded-full mt-2"></div>
                <div>
                  <h4 className="font-medium text-gray-900">Practice Exams</h4>
                  <p className="text-sm text-gray-600">Simulate real tests</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StudentLayout>
  );
}
