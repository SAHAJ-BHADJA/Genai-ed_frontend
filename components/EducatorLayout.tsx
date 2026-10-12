'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Chrome as Home, ClipboardCheck, FileText, GraduationCap, Library, BookOpen, Bot, PenLine, ArrowLeftRight } from 'lucide-react';
import { supabase, Profile, Course } from '@/lib/supabase';
import CollapsibleSidebar, { NavItem, NavSection, AddButtonItem } from './CollapsibleSidebar';
import ProfileAccountMenu from './ProfileAccountMenu';

interface EducatorLayoutProps {
  children: ReactNode;
  profile?: Profile;
}

export default function EducatorLayout({ children, profile }: EducatorLayoutProps) {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    if (profile?.id) {
      loadCourses();
    }
  }, [profile?.id]);

  const loadCourses = async () => {
    if (!profile?.id) return;

    const { data } = await supabase
      .from('courses')
      .select('*')
      .eq('educator_id', profile.id)
      .order('created_at', { ascending: false });

    if (data) {
      setCourses(data);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const mainNavItems: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/educator/dashboard' },
    { icon: Bot, label: 'Multi-Model Playground', path: '/educator/llm-playground' },
    { icon: PenLine, label: 'Socratic Writing Studio', path: '/educator/socratic-writing' },
    { icon: FileText, label: 'Avatar Lecture Studio', path: '/educator/lecture/new' },
    { icon: GraduationCap, label: 'Personalized Quiz Generator', path: '/educator/quiz/new' },
    { icon: ClipboardCheck, label: 'AI Policy Builder', path: '/educator/policy-suggestor', comingSoon: true },
  ];

  const courseNavItems: NavItem[] = courses.map(course => ({
    icon: BookOpen,
    label: course.title,
    path: `/educator/course/${course.id}`,
  }));

  const addCourseButton: AddButtonItem = {
    type: 'add-button',
    label: 'Add Course',
    onClick: () => router.push('/educator/course/new'),
  };

  const sections: NavSection[] = [
    {
      items: mainNavItems,
    },
    {
      title: 'My Courses',
      items: [
        ...courseNavItems,
        addCourseButton,
      ],
    },
    {
      title: 'Resources',
      items: [
        { icon: Library, label: 'Library', path: '/educator/library' },
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
            <button
              type="button"
              onClick={() => router.push('/student/dashboard')}
              aria-label="Switch to student workspace"
              title="Switch to student workspace"
              className="flex items-center gap-3 rounded-lg bg-brand-yellow px-5 py-2 text-black transition-colors hover:bg-brand-yellow-hover"
            >
              <GraduationCap className="h-5 w-5" />
              <span className="flex flex-col items-start leading-tight">
                <span className="font-semibold">Educator Portal</span>
                <span className="text-xs font-medium text-black/65">Switch portal</span>
              </span>
              <ArrowLeftRight className="h-4 w-4 text-black/65" aria-hidden="true" />
            </button>
            <ProfileAccountMenu
              profile={profile}
              fallbackName="Educator"
              fallbackInitials="ED"
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full min-w-0 max-w-screen-2xl overflow-x-hidden">
        <CollapsibleSidebar
          sections={sections}
          variant="educator"
        />

        <main className="min-w-0 max-w-full flex-1 overflow-x-hidden p-8 transition-all duration-300">{children}</main>
      </div>
    </div>
  );
}
