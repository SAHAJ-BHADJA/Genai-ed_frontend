'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Profile, Course, Lecture } from '@/lib/supabase';
import EducatorLayout from '@/components/EducatorLayout';
import CourseCard from '@/components/CourseCard';
import LectureCard from '@/components/LectureCard';
import { ClipboardCheck, FileText, GraduationCap, Plus, Bot, PencilLine, CircleHelp, X } from 'lucide-react';

type DashboardLecture = Lecture & {
  lecture_courses: Array<{
    course_id: string;
  }>;
};

type Tutorial = {
  title: string;
  description: string;
  url: string;
};

const tutorials = {
  courses: {
    title: 'My Courses Tutorial',
    description: 'Learn how to create your first course in Cogitatis AI.',
    url: 'https://scribehow.com/embed/Tutorial_Create_Your_First_Course__GHgpOyNqQm6pmwcDuLCutg',
  },
  multiModel: {
    title: 'Multi-Model Playground Tutorial',
    description: 'Learn how to compare and orchestrate model responses.',
    url: 'https://scribehow.com/embed/Tutorial_Mastering_the_Cogitatis_AI_Multi-Model_Playground__CTLgID8RRquUjC4WAQYjMQ',
  },
  socratic: {
    title: 'Socratic Writing Tutorial',
    description: 'Learn how to create Socratic Writing assignments.',
    url: 'https://scribehow.com/embed/Tutorial_How_to_Create_a_Socratic_Writing_Assignments_in_Cogitatis__XJtpmy-1RLeF0yNvTOmatA',
  },
  avatar: {
    title: 'Avatar Lecture Studio Tutorial',
    description: 'Learn how to create an AI lecture with Avatar Lecture Studio.',
    url: 'https://scribehow.com/embed/Tutorial_Create_an_AI_Lecture_with_Avatar_Lecture_Studio__MYiq-ymzRpSL3xvBI5WY5g',
  },
  quiz: {
    title: 'Personalized Quiz Generator Tutorial',
    description: 'Learn how to create and publish a personalized quiz.',
    url: 'https://scribehow.com/embed/Tutorial_Create_and_Publish_a_Personalized_Quiz__450_C3UkSO6qygOQVxuVtQ',
  },
} satisfies Record<string, Tutorial>;

export default function EducatorDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [activeTutorial, setActiveTutorial] = useState<Tutorial | null>(null);

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

  const openTutorial = (event: React.MouseEvent, tutorial: Tutorial) => {
    event.stopPropagation();
    setActiveTutorial(tutorial);
  };

  const featureCards = [
    {
      title: 'Multi-Model Playground',
      description: 'Compare model responses and orchestrate stronger AI outputs.',
      path: '/educator/llm-playground',
      icon: Bot,
      iconClassName: 'bg-purple-600',
      tutorial: tutorials.multiModel,
    },
    {
      title: 'Socratic Writing Studio',
      description: 'Create staged writing assignments with guided Claude support.',
      path: '/educator/socratic-writing',
      icon: PencilLine,
      iconClassName: 'bg-amber-500',
      tutorial: tutorials.socratic,
    },
    {
      title: 'Avatar Lecture Studio',
      description: 'Generate avatar lectures, voice narration, and course slides.',
      path: '/educator/lecture/new',
      icon: FileText,
      iconClassName: 'bg-brand-maroon',
      tutorial: tutorials.avatar,
    },
    {
      title: 'Personalized Quiz Generator',
      description: 'Create adaptive quizzes from materials or student writing.',
      path: '/educator/quiz/new',
      icon: GraduationCap,
      iconClassName: 'bg-green-600',
      tutorial: tutorials.quiz,
    },
    {
      title: 'AI Policy Builder',
      description: 'Design AI usage policies aligned with course objectives.',
      path: '/educator/policy-suggestor',
      icon: ClipboardCheck,
      iconClassName: 'bg-blue-500',
      comingSoon: true,
    },
  ];

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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
            {featureCards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.title}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(card.path)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      router.push(card.path);
                    }
                  }}
                  className="group cursor-pointer rounded-xl border border-gray-100 bg-white p-6 text-left shadow-md transition-all hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-maroon"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className={`${card.iconClassName} rounded-xl p-3`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex items-center gap-2">
                      {card.tutorial && (
                        <button
                          type="button"
                          onClick={(event) => openTutorial(event, card.tutorial)}
                          onKeyDown={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-full border border-brand-maroon/20 bg-red-50 px-2.5 py-1 text-xs font-semibold text-brand-maroon transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-brand-maroon"
                        >
                          <CircleHelp className="h-3.5 w-3.5" />
                          Tutorial
                        </button>
                      )}
                      <div className="flex items-center gap-2 text-sm text-gray-400 transition-colors group-hover:text-gray-600">
                        {card.comingSoon && <span>Coming Soon</span>}
                      </div>
                    </div>
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">{card.title}</h3>
                  <p className="text-sm text-gray-600">{card.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-gray-800">My Courses</h2>
              <button
                type="button"
                onClick={(event) => openTutorial(event, tutorials.courses)}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-maroon/20 bg-red-50 px-3 py-1.5 text-xs font-semibold text-brand-maroon transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-brand-maroon"
              >
                <CircleHelp className="h-3.5 w-3.5" />
                Tutorial
              </button>
            </div>
            <button
              onClick={() => router.push('/educator/courses')}
              className="text-brand-maroon hover:text-brand-maroon-hover font-medium text-sm flex items-center gap-2"
            >
              View All -&gt;
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
              View All -&gt;
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

      {activeTutorial && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/60 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="educator-tutorial-title"
        >
          <div className="relative flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h3 id="educator-tutorial-title" className="text-lg font-bold text-gray-900">
                  {activeTutorial.title}
                </h3>
                <p className="text-sm text-gray-600">{activeTutorial.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTutorial(null)}
                className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-maroon"
                aria-label="Close tutorial"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden bg-gray-50 p-3 sm:p-5">
              <iframe
                src={activeTutorial.url}
                title={activeTutorial.title}
                allow="fullscreen"
                className="h-full w-full rounded-xl border-0 bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </EducatorLayout>
  );
}
