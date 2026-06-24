'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Profile, Course, Lecture } from '@/lib/supabase';
import EducatorLayout from '@/components/EducatorLayout';
import CourseCard from '@/components/CourseCard';
import LectureCard from '@/components/LectureCard';
import { ClipboardCheck, FileText, GraduationCap, Plus, Bot } from 'lucide-react';

type DashboardLecture = Lecture & {
  lecture_courses: Array<{
    course_id: string;
  }>;
};

export default function EducatorDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

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

      const { data: coursesData, error: coursesError } = await supabase
        .from('courses')
        .select('*')
        .eq('educator_id', user.id)
        .order('created_at', { ascending: false });

      if (coursesError) {
        console.error('Error loading courses:', coursesError);
      } else if (coursesData) {
        console.log('Loaded courses:', coursesData);
        setCourses(coursesData);
      }

      const { data: lecturesData, error: lecturesError } = await supabase
        .from('lectures')
        .select(`
          *,
          lecture_courses!inner(
            course_id
          )
        `)
        .eq('educator_id', user.id)
        .eq('creator_role', 'educator')
        .order('created_at', { ascending: false });

      if (lecturesError) {
        console.error('Error loading lectures:', lecturesError);
      } else if (lecturesData) {
        const linkedLectures = (lecturesData as DashboardLecture[]).map((lecture) => ({
          ...lecture,
          course_id: lecture.lecture_courses[0]?.course_id || lecture.course_id,
        }));

        console.log('Loaded lectures:', linkedLectures);
        setLectures(linkedLectures);
      }

    } catch (error) {
      console.error('Error loading dashboard:', error);
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

  const handleRefreshData = async () => {
    setLoading(true);
    await checkAuth();
  };

  return (
    <EducatorLayout profile={profile}>
      <div className="space-y-8">
        <div className="bg-gradient-to-r from-brand-maroon to-brand-maroon-hover text-white p-8 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Hi, {profile.first_name}!</h1>
              <p className="text-white/90 text-lg">Welcome back to your USC Educator Workspace</p>
            </div>
            <button
              onClick={handleRefreshData}
              className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition-colors text-sm"
            >
              Refresh Data
            </button>
          </div>
          {showDebug && (
            <div className="mt-4 bg-white/10 p-4 rounded-lg text-sm">
              <p>User ID: {profile.id}</p>
              <p>Email: {profile.email}</p>
              <p>Courses loaded: {courses.length}</p>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">What would you like to do today?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <button
              onClick={() => router.push('/educator/llm-playground')}
              className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition-all border border-gray-100 text-left group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="bg-purple-600 p-3 rounded-xl">
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div className="text-gray-400 group-hover:text-gray-600 transition-colors">→</div>
              </div>
              <h3 className="font-semibold text-lg text-gray-900 mb-2">Multi-Model Playground</h3>
              <p className="text-gray-600 text-sm">Compare, evaluate, and orchestrate responses across multiple AI models.</p>
            </button>
            
            <button
              onClick={() => router.push('/educator/lecture/new')}
              className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition-all border border-gray-100 text-left group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="bg-brand-maroon p-3 rounded-xl">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div className="text-gray-400 group-hover:text-gray-600 transition-colors">→</div>
              </div>
              <h3 className="font-semibold text-lg text-gray-900 mb-2">Avatar Lecture Studio</h3>
              <p className="text-gray-600 text-sm">Generate voice or avatar-based mini-lectures and slides from course materials</p>
            </button>

            <button
              onClick={() => router.push('/educator/quiz/new')}
              className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition-all border border-gray-100 text-left group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="bg-green-600 p-3 rounded-xl">
                  <GraduationCap className="w-6 h-6 text-white" />
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-400 group-hover:text-gray-600 transition-colors">→</div>
              </div>
              <h3 className="font-semibold text-lg text-gray-900 mb-2">Personalized Quiz Generator</h3>
              <p className="text-gray-600 text-sm">Create adaptive quizzes and validation tools based on course materials or student writing</p>
            </button>
            
            <button
              onClick={() => router.push('/educator/policy-suggestor')}
              className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition-all border border-gray-100 text-left group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="bg-blue-500 p-3 rounded-xl">
                  <ClipboardCheck className="w-6 h-6 text-white" />
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-400 group-hover:text-gray-600 transition-colors">
                  <span>Coming Soon</span>
                  <span>→</span>
                </div>
              </div>
              <h3 className="font-semibold text-lg text-gray-900 mb-2">AI Policy Builder</h3>
              <p className="text-gray-600 text-sm">Design course-specific AI usage policies aligned with course learning objectives.</p>
            </button>

          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">My Courses</h2>
            <button
              onClick={() => router.push('/educator/courses')}
              className="text-brand-maroon hover:text-brand-maroon-hover font-medium text-sm flex items-center gap-2"
            >
              View All →
            </button>
          </div>

          {courses.length === 0 ? (
            <div className="bg-white p-12 rounded-xl border-2 border-dashed border-gray-300 text-center">
              <div className="max-w-sm mx-auto">
                <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Plus className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No courses yet</h3>
                <p className="text-gray-600 mb-6">Create your first course to get started</p>
                <button
                  onClick={() => router.push('/educator/course/new')}
                  className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 px-6 rounded-lg transition-colors inline-flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Create Course
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {courses.map((course) => (
                <CourseCard
                  key={course.id}
                  code={course.course_number}
                  title={course.title}
                  instructorName={course.instructor_name}
                  semester={course.semester}
                  onClick={() => router.push(`/educator/course/${course.id}`)}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">My Lectures</h2>
            <button
              onClick={() => router.push('/educator/lecture/new')}
              className="text-brand-maroon hover:text-brand-maroon-hover font-medium text-sm flex items-center gap-2"
            >
              View All →
            </button>
          </div>

          {lectures.length === 0 ? (
            <div className="bg-white p-12 rounded-xl border-2 border-dashed border-gray-300 text-center">
              <div className="max-w-sm mx-auto">
                <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Plus className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No lectures yet</h3>
                <p className="text-gray-600 mb-6">Create your first lecture to get started</p>
                <button
                  onClick={() => router.push('/educator/lecture/new')}
                  className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 px-6 rounded-lg transition-colors inline-flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Create Lecture
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {lectures.slice(0, 4).map((lecture) => (
                <LectureCard
                  key={lecture.id}
                  title={lecture.title}
                  onClick={() => router.push(`/educator/lecture/new?id=${lecture.id}&mode=edit`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </EducatorLayout>
  );
}
