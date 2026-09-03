'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Chrome as Home, MessageSquare, Lightbulb, Video, ClipboardCheck, BookOpen, Library, Bot } from 'lucide-react';
import { supabase, Profile } from '@/lib/supabase';
import CollapsibleSidebar, { NavItem, NavSection } from './CollapsibleSidebar';
import ProfileAccountMenu from './ProfileAccountMenu';

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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-maroon text-white px-6 py-4 shadow-lg">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
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
            <button className="bg-brand-yellow text-black px-6 py-2 rounded-lg font-semibold hover:bg-brand-yellow-hover transition-colors flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Student Workspace
            </button>
            <ProfileAccountMenu
              profile={profile}
              fallbackName="Student"
              fallbackInitials="ST"
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </header>

      <div className="flex max-w-screen-2xl mx-auto">
        <CollapsibleSidebar
          sections={sections}
          variant="student"
        />

        <main className="flex-1 p-8 transition-all duration-300">{children}</main>
      </div>
    </div>
  );
}
