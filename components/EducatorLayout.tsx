'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Chrome as Home, ClipboardCheck, FileText, GraduationCap, Library, BookOpen, LogOut, User, Bot, PenLine } from 'lucide-react';
import { supabase, Profile, Course } from '@/lib/supabase';
import CollapsibleSidebar, { NavItem, NavSection, AddButtonItem } from './CollapsibleSidebar';

interface EducatorLayoutProps {
  children: ReactNode;
  profile?: Profile;
}

export default function EducatorLayout({ children, profile }: EducatorLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  const getInitials = () => {
    if (!profile?.first_name || !profile?.last_name) return 'ED';
    return `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase();
  };

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
              <LogOut className="w-4 h-4" />
              Educator Workspace
            </button>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm font-medium">Signed in as</div>
                <div className="text-sm text-white/90">
                  {profile?.first_name || 'Educator'} {profile?.last_name || ''}
                </div>
              </div>
              <div className="w-10 h-10 bg-brand-yellow rounded-full flex items-center justify-center">
                <span className="text-black font-bold text-sm">{getInitials()}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex max-w-screen-2xl mx-auto">
        <CollapsibleSidebar
          sections={sections}
          onSignOut={handleSignOut}
          variant="educator"
        />

        <main className="flex-1 p-8 transition-all duration-300">{children}</main>
      </div>
    </div>
  );
}
