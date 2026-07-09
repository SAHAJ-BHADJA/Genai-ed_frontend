'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import StudentLayout from '@/components/StudentLayout';
import CourseCard from '@/components/CourseCard';
import LectureCard from '@/components/LectureCard';
import { supabase, Profile } from '@/lib/supabase';
import {
  Video,
  Lightbulb,
  ClipboardCheck,
  Clock,
  MessageSquare
} from 'lucide-react';

interface Course {
  id: string;
  course_number: string;
  title: string;
  description: string;
  instructor_name: string;
  semester: string;
  student_count: number;
  newLecturesCount?: number;
}

interface Lecture {
  id: string;
  title: string;
  course_code: string;
  course_id: string;
  instructor_name: string;
  duration: number;
  created_at: string;
  isNew?: boolean;
}

interface LibraryResource {
  id: string;
  title: string;
  source: string;
  duration: number;
  thumbnail: string;
  created_at: string;
}

export default function StudentDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userName, setUserName] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [recentLectures, setRecentLectures] = useState<Lecture[]>([]);
  const [myLectures, setMyLectures] = useState<Lecture[]>([]);
  const [trainingCourses] = useState([
    {
      id: '1',
      title: 'Prompt Engineering 101',
      description: 'Learn the fundamentals of crafting effective AI prompts',
      icon: '🤖',
      lessonsCount: 8,
      duration: 45,
      bgColor: 'bg-gradient-to-br from-red-900 to-red-800'
    },
    {
      id: '2',
      title: 'AI Ethics for Students',
      description: 'Understanding ethical considerations in AI usage',
      icon: '⚖️',
      lessonsCount: 6,
      duration: 38,
      bgColor: 'bg-gradient-to-br from-red-900 to-red-800'
    },
    {
      id: '3',
      title: 'Effective AI-Assisted Learning',
      description: 'Maximize your learning with AI tools',
      icon: '🎓',
      lessonsCount: 10,
      duration: 52,
      bgColor: 'bg-gradient-to-br from-red-900 to-red-800'
    }
  ]);
  const [libraryResources] = useState<LibraryResource[]>([
    {
      id: '1',
      title: 'Research Methods in Social Sciences',
      source: 'USC Library • USC Academic Resources',
      duration: 13,
      thumbnail: '📚',
      created_at: '1 week ago'
    },
    {
      id: '2',
      title: 'Effective Study Strategies for College Success',
      source: 'USC Library • USC Academic Resources',
      duration: 11,
      thumbnail: '✏️',
      created_at: '2 weeks ago'
    },
    {
      id: '3',
      title: 'Time Management for Students',
      source: 'USC Library • USC Academic Resources',
      duration: 9,
      thumbnail: '⏰',
      created_at: '3 weeks ago'
    }
  ]);

  useEffect(() => {
    checkAuthAndLoadData();
  }, []);

  const checkAuthAndLoadData = async () => {
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
      router.push('/');
      return;
    }

    setProfile(profileData);
    setUserName(profileData.first_name || 'Student');
    await loadDashboardData(user.email!);
    setLoading(false);
  };

  const loadDashboardData = async (email: string) => {
    const { data: enrolledCourses } = await supabase
      .from('course_students')
      .select('course_id')
      .eq('email', email);

    if (enrolledCourses && enrolledCourses.length > 0) {
      const courseIds = enrolledCourses.map(ec => ec.course_id);

      const { data: coursesData } = await supabase
        .from('courses')
        .select('*')
        .in('id', courseIds)
        .order('course_number');

      if (coursesData) {
        setCourses(coursesData);
      }

      const { data: lectureCourses } = await supabase
        .from('lecture_courses')
        .select(`
          lecture_id,
          course_id,
          lectures!inner(
            id,
            title,
            video_length,
            created_at,
            status,
            creator_role
          ),
          courses!inner(
            course_number,
            instructor_name
          )
        `)
        .in('course_id', courseIds)
        .order('lectures(created_at)', { ascending: false });

      let formattedLectures: Lecture[] = [];

      if (lectureCourses) {
        const educatorLectures = lectureCourses
          .filter((lc: any) => {
            const lecture = lc.lectures;
            return lecture &&
                   lecture.creator_role === 'educator' &&
                   (lecture.status === 'completed' || lecture.status === 'published');
          })
          .slice(0, 3)
          .map((lc: any) => {
            const lecture = lc.lectures;
            const course = lc.courses;
            return {
              id: lecture.id,
              title: lecture.title,
              course_code: course.course_number || '',
              course_id: lc.course_id,
              instructor_name: course.instructor_name || '',
              duration: lecture.video_length || 0,
              created_at: formatTimeAgo(lecture.created_at),
              isNew: isWithinDays(lecture.created_at, 2)
            };
          });

        formattedLectures = educatorLectures;
        setRecentLectures(formattedLectures);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: studentLecturesData } = await supabase
          .from('lectures')
          .select(`
            id,
            title,
            video_length,
            created_at,
            status,
            lecture_courses!inner(
              course_id,
              courses(
                course_number,
                instructor_name
              )
            )
          `)
          .eq('creator_user_id', user.id)
          .eq('creator_role', 'student')
          .order('created_at', { ascending: false })
          .limit(6);

        if (studentLecturesData) {
          const formattedMyLectures = studentLecturesData.map((lecture: any) => {
            const lectureCourse = lecture.lecture_courses[0];
            const course = lectureCourse?.courses;
            return {
              id: lecture.id,
              title: lecture.title,
              course_code: course?.course_number || '',
              course_id: lectureCourse?.course_id || '',
              instructor_name: course?.instructor_name || '',
              duration: lecture.video_length || 0,
              created_at: formatTimeAgo(lecture.created_at),
              isNew: isWithinDays(lecture.created_at, 2)
            };
          });
          setMyLectures(formattedMyLectures);
        }
      }
    }

    setLoading(false);
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return 'Today';
    if (diffInDays === 1) return 'Yesterday';
    if (diffInDays < 7) return `${diffInDays} days ago`;
    if (diffInDays < 14) return '1 week ago';
    if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
    return `${Math.floor(diffInDays / 30)} months ago`;
  };

  const isWithinDays = (dateString: string, days: number) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    return diffInDays <= days;
  };

  const quickActions = [
    {
      title: 'Multi-Model Playground',
      description: 'Compare, evaluate, and orchestrate responses across multiple AI models.',
      icon: MessageSquare,
      color: 'bg-yellow-50 dark:bg-yellow-950',
      iconColor: 'text-brand-yellow',
      href: '/student/llm-playground',
      comingSoon: false
    },
    {
      title: 'Socratic Writing Studio',
      description: 'Clarify ideas, explore research, and build arguments with guided AI support.',
      icon: Lightbulb,
      color: 'bg-purple-50 dark:bg-purple-950',
      iconColor: 'text-purple-600 dark:text-purple-400',
      href: '/student/brainstorming',
      comingSoon: false
    },
    {
      title: 'Avatar Lecture Studio',
      description: 'Generate voice or avatar-based mini-lectures and slides from course materials.',
      icon: Video,
      color: 'bg-red-50 dark:bg-red-950',
      iconColor: 'text-brand-maroon',
      href: '/student/create-lecture',
      comingSoon: true
    },
    {
      title: 'Knowledge Check',
      description: 'Test your understanding with quizzes generated from lectures, readings, or chosen topics.',
      icon: ClipboardCheck,
      color: 'bg-blue-50 dark:bg-blue-950',
      iconColor: 'text-blue-600 dark:text-blue-400',
      href: '/student/test-knowledge',
      comingSoon: true
    }
  ];

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-maroon border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <StudentLayout profile={profile}>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        <div className="bg-gradient-to-r from-brand-maroon to-brand-maroon-hover rounded-2xl p-8 text-white shadow-lg">
          <h1 className="text-3xl font-bold mb-2">Hi {userName}!</h1>
          <p className="text-xl text-white/90">Welcome to your Student Workspace</p>
        </div>

        <section>
          <h2 className="text-2xl font-bold text-foreground mb-4">What would you like to do today?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.title}
                  onClick={() => router.push(action.href)}
                  className="bg-card border border-border rounded-xl p-6 text-left hover:shadow-lg transition-all hover:scale-105 group relative"
                >
                  {action.comingSoon && (
                    <div className="absolute top-3 right-3">
                      <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-medium px-2 py-1 rounded-full">
                        Coming soon
                      </span>
                    </div>
                  )}
                  <div className={`${action.color} w-12 h-12 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-6 h-6 ${action.iconColor}`} />
                  </div>
                  <h3 className="font-bold text-foreground mb-1">{action.title}</h3>
                  <p className="text-sm text-muted-foreground">{action.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {courses.length > 0 && (
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">My Courses</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {courses.map((course) => (
                <CourseCard
                  key={course.id}
                  code={course.course_number}
                  title={course.title}
                  instructorName={course.instructor_name}
                  semester={course.semester}
                  newLecturesCount={course.newLecturesCount}
                  onClick={() => router.push(`/student/course/${course.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {myLectures.length > 0 && (
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">My Lectures</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myLectures.map((lecture) => (
                <LectureCard
                  key={lecture.id}
                  title={lecture.title}
                  courseCode={lecture.course_code}
                  instructorName={lecture.instructor_name}
                  isNew={lecture.isNew}
                  onClick={() => router.push(`/student/course/${lecture.course_id}/my/lecture/${lecture.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {recentLectures.length > 0 && (
          <section>
            <h2 className="text-2xl font-bold text-foreground mb-4">Recent Lectures</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {recentLectures.map((lecture) => (
                <LectureCard
                  key={lecture.id}
                  title={lecture.title}
                  courseCode={lecture.course_code}
                  instructorName={lecture.instructor_name}
                  isNew={lecture.isNew}
                  onClick={() => router.push(`/student/course/${lecture.course_id}/lecture/${lecture.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-2xl font-bold text-foreground">Training</h2>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              Coming soon
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {trainingCourses.map((course) => (
              <div
                key={course.id}
                className="relative bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`${course.bgColor} w-16 h-16 rounded-xl flex items-center justify-center text-3xl shadow-md`}>
                      {course.icon}
                    </div>
                    <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs font-medium px-3 py-1 rounded-full">
                      {course.lessonsCount} lessons
                    </span>
                  </div>
                  <h3 className="font-bold text-foreground mb-2 text-lg">{course.title}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{course.description}</p>
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 mr-1" />
                    {course.duration} min
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-2xl font-bold text-foreground">USC Library Resources</h2>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              Coming soon
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {libraryResources.map((resource) => (
              <div
                key={resource.id}
                className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
              >
                <div className="bg-gradient-to-br from-brand-maroon to-brand-maroon-hover h-40 flex items-center justify-center text-6xl">
                  {resource.thumbnail}
                </div>
                <div className="p-4">
                  <h3 className="font-bold text-foreground mb-2">{resource.title}</h3>
                  <p className="text-sm text-muted-foreground mb-2">{resource.source}</p>
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 mr-1" />
                    {resource.duration} min
                    <span className="mx-2">•</span>
                    {resource.created_at}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </StudentLayout>
  );
}
