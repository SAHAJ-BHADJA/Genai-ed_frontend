'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Clock3, FileText, Lightbulb, Sparkles } from 'lucide-react';
import StudentLayout from '@/components/StudentLayout';
import { supabase, Profile } from '@/lib/supabase';
import { hasProfileRole } from '@/lib/profileRoles';

type CourseRow = {
  id: string;
  course_number: string;
  title: string;
};

type StudentAssignmentRow = {
  id: string;
  assignment_label: string;
  assignment_title: string;
  description: string | null;
  due_at: string | null;
  points_possible: number;
  course_id: string;
};

type AssignmentExperienceRow = {
  id: string;
  experience_type: string;
};

type SocraticResourceCountRow = {
  assignment_id: string;
  required: boolean;
};

export default function Brainstorming() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [assignments, setAssignments] = useState<StudentAssignmentRow[]>([]);
  const [resourceCountsByAssignment, setResourceCountsByAssignment] = useState<Record<string, { total: number; required: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void bootstrap();
  }, []);

  const assignmentCards = useMemo(() => {
    return assignments.map((assignment) => {
      const course = courses.find((courseRow) => courseRow.id === assignment.course_id);
      const resourceCounts = resourceCountsByAssignment[assignment.id] || { total: 0, required: 0 };

      return {
        assignmentId: assignment.id,
        courseId: assignment.course_id,
        courseCode: course?.course_number || 'COURSE',
        courseTitle: course?.title || 'Course',
        assignmentTitle: assignment.assignment_title || assignment.assignment_label,
        assignmentBrief:
          assignment.description
          || 'Use the four-stage studio to clarify the prompt, complete research, build the argument, and write the essay.',
        dueAt: assignment.due_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        requiredResources: resourceCounts.required,
        totalResources: resourceCounts.total,
        label: assignment.assignment_label,
      };
    });
  }, [assignments, courses, resourceCountsByAssignment]);

  const bootstrap = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/student/login');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || !hasProfileRole(profileData, 'student')) {
        await supabase.auth.signOut();
        router.push('/student/login');
        return;
      }

      setProfile(profileData);

      const { data: enrolledCourses } = await supabase
        .from('course_students')
        .select('course_id')
        .or(`student_id.eq.${user.id},email.eq.${profileData.email}`);

      const courseIds = Array.from(new Set((enrolledCourses || []).map((row) => row.course_id)));

      if (courseIds.length === 0) {
        setCourses([]);
        setAssignments([]);
        setResourceCountsByAssignment({});
        return;
      }

      const { data: courseRows } = await supabase
        .from('courses')
        .select('id, course_number, title')
        .in('id', courseIds)
        .order('course_number');

      setCourses((courseRows || []) as CourseRow[]);

      const assignmentResults = await Promise.all(
        courseIds.map(async (courseId) => {
          const { data } = await supabase.rpc('get_student_course_assignments', {
            p_course_id: courseId,
          });
          return (data || []).map((assignment: any) => ({
            ...assignment,
            course_id: courseId,
          })) as StudentAssignmentRow[];
        }),
      );

      const allAssignments = assignmentResults.flat();
      const assignmentIds = allAssignments.map((assignment) => assignment.id);

      if (assignmentIds.length === 0) {
        setAssignments([]);
        setResourceCountsByAssignment({});
        return;
      }

      const { data: assignmentTypeRows, error: assignmentTypeError } = await supabase
        .from('assignments')
        .select('id, experience_type')
        .in('id', assignmentIds);

      if (assignmentTypeError) {
        throw assignmentTypeError;
      }

      const socraticAssignmentIds = new Set(
        ((assignmentTypeRows || []) as AssignmentExperienceRow[])
          .filter((assignment) => assignment.experience_type === 'socratic_writing')
          .map((assignment) => assignment.id),
      );

      const socraticAssignments = allAssignments.filter((assignment) => socraticAssignmentIds.has(assignment.id));
      setAssignments(socraticAssignments);

      if (socraticAssignments.length === 0) {
        setResourceCountsByAssignment({});
        return;
      }

      const { data: resourceRows, error: resourceError } = await supabase
        .from('assignment_socratic_resources')
        .select('assignment_id, required')
        .in('assignment_id', socraticAssignments.map((assignment) => assignment.id));

      if (resourceError) {
        throw resourceError;
      }

      const nextResourceCounts = socraticAssignments.reduce<Record<string, { total: number; required: number }>>(
        (acc, assignment) => {
          acc[assignment.id] = { total: 0, required: 0 };
          return acc;
        },
        {},
      );

      ((resourceRows || []) as SocraticResourceCountRow[]).forEach((resource) => {
        if (!nextResourceCounts[resource.assignment_id]) {
          nextResourceCounts[resource.assignment_id] = { total: 0, required: 0 };
        }
        nextResourceCounts[resource.assignment_id].total += 1;
        if (resource.required) {
          nextResourceCounts[resource.assignment_id].required += 1;
        }
      });

      setResourceCountsByAssignment(nextResourceCounts);
    } catch (error) {
      console.error('Error loading Socratic Writing Studio assignments:', error);
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

  return (
    <StudentLayout profile={profile}>
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="rounded-3xl border border-gray-200 bg-white px-8 py-7 shadow-sm">
          <button
            onClick={() => router.push('/student/dashboard')}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h1 className="text-4xl font-bold text-gray-950">Socratic Writing Studio</h1>
              <p className="text-gray-600 mt-3 max-w-3xl">
                Choose a course assignment and work through Clarify, Research, Build, and Write.
                The studio keeps a notebook and an append-only ledger of your decisions as you go.
              </p>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4">
              <div className="text-sm font-medium text-blue-700">V1 scope</div>
              <div className="text-lg font-semibold text-blue-900">Course assignments only</div>
              <div className="text-sm text-blue-700 mt-1">Other topics come in V2.</div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-brand-maroon/10 p-3 rounded-xl">
                <BookOpen className="w-6 h-6 text-brand-maroon" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-950">Course Assignment</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Work on an assignment from your enrolled courses with attached resources, notes, and stage-by-stage coaching.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {assignmentCards.length > 0 ? (
                assignmentCards.map((assignment) => (
                  <button
                    key={assignment.assignmentId}
                    type="button"
                    onClick={() => router.push(
                      `/student/course/${assignment.courseId}/assignment/${assignment.assignmentId}/studio`
                      + `?courseCode=${encodeURIComponent(assignment.courseCode)}`
                      + `&courseTitle=${encodeURIComponent(assignment.courseTitle)}`
                      + `&assignmentTitle=${encodeURIComponent(assignment.assignmentTitle)}`
                      + `&assignmentBrief=${encodeURIComponent(assignment.assignmentBrief)}`
                      + `&dueAt=${encodeURIComponent(assignment.dueAt)}`,
                    )}
                    className="w-full rounded-2xl border border-gray-200 p-5 text-left hover:border-brand-maroon hover:bg-brand-maroon/5 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-brand-maroon">{assignment.courseCode}</p>
                        <h3 className="text-xl font-semibold text-gray-950 mt-1">{assignment.assignmentTitle}</h3>
                        <p className="text-sm text-gray-600 mt-2">{assignment.assignmentBrief}</p>
                      </div>
                      <div className="text-right text-sm text-gray-600">
                        <div className="inline-flex items-center gap-2">
                          <Clock3 className="w-4 h-4" />
                          Due {new Date(assignment.dueAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600">
                      <span className="inline-flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {assignment.totalResources} resources
                      </span>
                      <span>{assignment.requiredResources} required before Build/Write</span>
                      <span>{assignment.label}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-gray-500">
                  No course assignments available yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-brand-yellow/20 p-3 rounded-xl">
                <Lightbulb className="w-6 h-6 text-yellow-700" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-950">Other Topics</h2>
                <p className="text-sm text-gray-600 mt-1">Planned for V2.</p>
              </div>
            </div>
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
              <Sparkles className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-sm text-gray-600">
                The first release focuses on course-aligned writing assignments. Topic-mode is intentionally deferred.
              </p>
            </div>
          </div>
        </div>
      </div>
    </StudentLayout>
  );
}
