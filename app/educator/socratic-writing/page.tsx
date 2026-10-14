'use client';

import { Suspense } from 'react';
import SocraticAssignmentWizard from '@/components/socratic-writing/SocraticAssignmentWizard';

export default function SocraticWritingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-600">Loading assignment creator…</div>}>
      <SocraticAssignmentWizard />
    </Suspense>
  );
}
