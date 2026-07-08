'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

export default function RoleCTA() {
  const router = useRouter();
  const [showTutorial, setShowTutorial] = useState(false);

  const handleEducatorClick = () => {
    localStorage.setItem('selectedRole', 'educator');
    router.push('/educator/login');
  };

  const handleStudentClick = () => {
    localStorage.setItem('selectedRole', 'student');
    router.push('/student/login');
  };

  return (
    <section className="py-16 md:py-20 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-2">
            Choose Your Workspace
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-6">
          <button
            onClick={handleEducatorClick}
            className="bg-brand-yellow text-black px-12 py-4 rounded-lg text-xl hover:bg-brand-yellow-hover transition-all transform hover:scale-105 shadow-lg"
          >
            I&apos;m an Educator
          </button>

          <button
            onClick={handleStudentClick}
            className="bg-brand-maroon text-white px-12 py-4 rounded-lg text-xl hover:bg-brand-maroon-hover transition-all transform hover:scale-105 shadow-lg"
          >
            I&apos;m a Student
          </button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowTutorial(true)}
            className="text-sm text-gray-700 hover:text-brand-maroon underline transition-colors focus:outline-none focus:ring-2 focus:ring-brand-maroon rounded px-2 py-1"
          >
            Sign Up Tutorial
          </button>
        </div>
      </div>

      {showTutorial && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/60 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signup-tutorial-title"
        >
          <div className="relative flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h3 id="signup-tutorial-title" className="text-lg font-bold text-gray-900">
                  Sign Up Tutorial
                </h3>
                <p className="text-sm text-gray-600">
                  Follow this guide to create your Cogitatis AI educator account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTutorial(false)}
                className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-maroon"
                aria-label="Close tutorial"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden bg-gray-50 p-3 sm:p-5">
              <iframe
                src="https://scribehow.com/embed/Create_Your_Cogitatis_AI_Educator_Account__Sp46MHbkTRGKe64w3uzRIg"
                title="Create Your Cogitatis AI Educator Account"
                allow="fullscreen"
                className="h-full w-full rounded-xl border-0 bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
