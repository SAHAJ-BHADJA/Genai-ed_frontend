'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EducatorLayout from '@/components/EducatorLayout';
import SocraticStudioWorkspace from '@/components/socratic-writing/SocraticStudioWorkspace';
import {
  loadSocraticPreviewPayload,
  saveSocraticPreviewPayload,
  SocraticPreviewPayload,
  SocraticStudioSession,
} from '@/lib/socraticWriting';
import { supabase, Profile } from '@/lib/supabase';

export default function EducatorSocraticPreviewPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [previewPayload, setPreviewPayload] = useState<SocraticPreviewPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/educator/login');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || profileData.role !== 'educator') {
        await supabase.auth.signOut();
        router.push('/educator/login');
        return;
      }

      const payload = loadSocraticPreviewPayload();
      setProfile(profileData);
      setPreviewPayload(payload);
    } catch (error) {
      console.error('Error loading Socratic preview:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    router.push(previewPayload?.returnUrl || '/educator/socratic-writing');
  };

  const handleSavePreviewSession = useCallback((session: SocraticStudioSession) => {
    setPreviewPayload((current) => {
      if (!current) return current;
      const nextPayload = {
        ...current,
        session,
      };
      saveSocraticPreviewPayload(nextPayload);
      return nextPayload;
    });
  }, []);

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading Socratic preview...</div>
      </div>
    );
  }

  if (!previewPayload) {
    return (
      <EducatorLayout profile={profile}>
        <div className="max-w-3xl mx-auto rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-950">No preview setup found</h1>
          <p className="mt-2 text-gray-600">
            Return to Socratic assignment setup and click Preview as Student again.
          </p>
          <button
            type="button"
            onClick={handleBack}
            className="mt-6 rounded-lg bg-brand-maroon px-5 py-3 font-semibold text-white hover:bg-brand-maroon-hover"
          >
            Back to Assignment Setup
          </button>
        </div>
      </EducatorLayout>
    );
  }

  return (
    <EducatorLayout profile={profile}>
      <SocraticStudioWorkspace
        assignmentId={previewPayload.blueprint.assignmentId || 'educator-preview'}
        onBack={handleBack}
        previewMode
        previewPayload={previewPayload}
        onSavePreviewSession={handleSavePreviewSession}
      />
    </EducatorLayout>
  );
}
