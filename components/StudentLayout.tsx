'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Chrome as Home, Lightbulb, Video, ClipboardCheck, BookOpen, Library, Bot, GraduationCap, ArrowLeftRight } from 'lucide-react';
import { supabase, Profile } from '@/lib/supabase';
import CollapsibleSidebar, { NavItem, NavSection } from './CollapsibleSidebar';
import ProfileAccountMenu from './ProfileAccountMenu';
import { hasProfileRole } from '@/lib/profileRoles';

interface Course {
  id: string;
  course_number: string;
  title: string;
  semester: string;
  newLecturesCount?: number;
}

interface StudentLayoutProps {
  children: React.ReactNode;
  profile: Profile;
}

export default function StudentLayout({ children, profile }: StudentLayoutProps) {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const canSwitchToEducator = hasProfileRole(profile, 'educator');

  useEffect(() => {
    loadCourses();
  }, [profile.id]);

  const loadCourses = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: enrolledCourses } = await supabase
      .from('course_students')
      .select('course_id')
      .eq('email', user.email);

    if (enrolledCourses && enrolledCourses.length > 0) {
      const courseIds = enrolledCourses.map(ec => ec.course_id);
      const { data: coursesData } = await supabase
        .from('courses')
        .select('id, course_number, title, semester')
        .in('id', courseIds)
        .order('course_number');

      if (coursesData) {
        setCourses(coursesData);
      }
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const mainNavItems: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/student/dashboard' },
    { icon: Bot, label: 'Multi-Model Playground', path: '/student/llm-playground' },
    { icon: Video, label: 'Socratic Writing Studio', path: '/student/brainstorming' },
    { icon: Lightbulb, label: 'Avatar Lecture Studio', path: '/student/create-lecture' },
    { icon: ClipboardCheck, label: 'Knowledge Check', path: '/student/test-knowledge' },
  ];

  const courseNavItems: NavItem[] = courses.map(course => ({
    icon: BookOpen,
    label: course.title || course.course_number,
    path: `/student/course/${course.id}`,
    badge: course.newLecturesCount,
  }));

  const sections: NavSection[] = [
    {
      items: mainNavItems,
    },
    {
      title: 'My Courses',
      items: courseNavItems.length > 0 ? courseNavItems : [
        <div key="no-courses" className="px-4 py-2 text-xs text-gray-500">
          No courses enrolled
        </div>
      ],
    },
    {
      title: 'Resources',
      items: [
        { icon: Library, label: 'USC Library', path: '/student/usc-library' },
      ],
    },
  ];

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-gray-50">
      <header className="max-w-full overflow-x-hidden bg-brand-maroon px-6 py-4 text-white shadow-lg">
        <div className="mx-auto flex w-full min-w-0 max-w-screen-2xl items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center">
              <span className="text-brand-maroon font-bold text-sm">USC</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">Cogitatis AI</h1>
              <p className="text-sm text-white/80">USC GenAI Learning Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {canSwitchToEducator ? (
              <button
                type="button"
                onClick={() => router.push('/educator/dashboard')}
                aria-label="Switch to educator workspace"
                title="Switch to educator workspace"
                className="flex items-center gap-3 rounded-lg bg-brand-yellow px-5 py-2 text-black transition-colors hover:bg-brand-yellow-hover"
              >
                <BookOpen className="h-5 w-5" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-semibold">Student Portal</span>
                  <span className="text-xs font-medium text-black/65">Switch portal</span>
                </span>
                <ArrowLeftRight className="h-4 w-4 text-black/65" aria-hidden="true" />
              </button>
            ) : (
              <div
                className="flex items-center gap-3 rounded-lg bg-brand-yellow px-5 py-2 text-black"
                aria-label="Current workspace: student"
                title="Current workspace"
              >
                <BookOpen className="h-5 w-5" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-semibold">Student Portal</span>
                  <span className="text-xs font-medium text-black/65">Current portal</span>
                </span>
              </div>
            )}
            <ProfileAccountMenu
              profile={profile}
              fallbackName="Student"
              fallbackInitials="ST"
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full min-w-0 max-w-screen-2xl overflow-x-hidden">
        <CollapsibleSidebar
          sections={sections}
          variant="student"
        />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-8 transition-all duration-300">{children}</main>
      </div>
    </div>
  );
}
