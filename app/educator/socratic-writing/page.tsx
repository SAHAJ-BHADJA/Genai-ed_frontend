'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, PencilLine, Plus } from 'lucide-react';
import EducatorLayout from '@/components/EducatorLayout';
import CourseCard from '@/components/CourseCard';
import { supabase, Course, Profile } from '@/lib/supabase';

export default function SocraticWritingCoursePickerPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadContext();
  }, []);

  const loadContext = async () => {
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

      setProfile(profileData);

      const { data: courseRows, error: courseError } = await supabase
        .from('courses')
        .select('*')
        .eq('educator_id', user.id)
        .order('created_at', { ascending: false });

      if (courseError) {
        throw courseError;
      }

      setCourses(courseRows || []);
    } catch (error) {
      console.error('Error loading Socratic Writing course picker:', error);
    } finally {
      setLoading(false);
    }
  };

  const startSocraticAssignment = (courseId: string) => {
    router.push(`/educator/assignment/new?courseId=${courseId}&mode=socratic`);
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <EducatorLayout profile={profile}>
      <div className="max-w-7xl mx-auto space-y-8">
        <button
          onClick={() => router.push('/educator/dashboard')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Dashboard
        </button>

        <section className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-8 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-amber-500 p-4 shadow-sm">
                <PencilLine className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Create Socratic Writing Assignment</h1>
                <p className="mt-2 max-w-3xl text-gray-600">
                  Choose the course where this Socratic Writing assignment belongs. The next page will
                  open the assignment creator with Socratic mode already selected.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Select a course</h2>
              <p className="text-sm text-gray-600">Students in the selected course will receive the assignment after publish.</p>
            </div>
            <button
              onClick={() => router.push('/educator/course/new')}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-maroon-hover"
            >
              <Plus className="h-4 w-4" />
              Create Course
            </button>
          </div>

          {courses.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center">
              <div className="mx-auto max-w-sm">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <Plus className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">No courses yet</h3>
                <p className="mb-6 text-gray-600">Create a course first, then come back to create Socratic Writing assignments.</p>
                <button
                  onClick={() => router.push('/educator/course/new')}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-yellow px-6 py-3 font-bold text-black transition-colors hover:bg-brand-yellow-hover"
                >
                  <Plus className="h-5 w-5" />
                  Create Course
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => (
                <CourseCard
                  key={course.id}
                  code={course.course_number}
                  title={course.title}
                  instructorName={course.instructor_name}
                  semester={course.semester}
                  onClick={() => startSocraticAssignment(course.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </EducatorLayout>
  );
}

