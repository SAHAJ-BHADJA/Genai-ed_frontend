'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { resetWarmupMarker, warmAllModels } from '@/lib/modelWarmup';

export default function ModelWarmupBootstrap() {
  useEffect(() => {
    void supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error || !session) return;
        void warmAllModels().catch(() => {
          // Best effort only; the user should never be blocked by warmup.
        });
      })
      .catch(() => {
        // A stale local refresh token must not create an unhandled page error.
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        resetWarmupMarker();
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void warmAllModels(event === 'SIGNED_IN').catch(() => {
          // Best effort only; keep auth flow fast and resilient.
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
