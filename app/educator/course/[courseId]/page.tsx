'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { supabase, Profile, Course } from '@/lib/supabase';
import { AssignmentRecord } from '@/lib/assignments';
import {
  getAssignmentSystemMissingMessage,
  isAssignmentSystemMissingError,
} from '@/lib/assignmentSystemErrors';
import EducatorLayout from '@/components/EducatorLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EducatorCourseOverview from '@/components/EducatorCourseOverview';
import EducatorLectureCard from '@/components/EducatorLectureCard';
import EducatorAssignmentCard from '@/components/EducatorAssignmentCard';
import EducatorQuizCard from '@/components/EducatorQuizCard';
import StudentManagementTable, { StudentPerformanceRow } from '@/components/StudentManagementTable';
import { ArrowLeft, Video, Plus, Users, BookOpen, FileText, ListChecks, X } from 'lucide-react';
import { toast } from 'sonner';

type Lecture = {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  video_length: number;
  content_style: string[];
};

type LectureArtifact = {
  id: string;
  artifact_type: string;
  file_url: string;
};

type LectureWithArtifacts = Lecture & {
  artifacts: LectureArtifact[];
};

type AssignmentSummary = AssignmentRecord & {
  analytics: {
    totalStudents: number;
    submitted: number;
    graded: number;
    pending: number;
    avgScore: number | null;
  };
};

type Quiz = {
  id: string;
  quiz_name: string;
  created_at: string;
  status: 'draft' | 'generated' | 'saved' | 'published';
  mode: 'in_class' | 'online' | null;
  due_at: string | null;
  mcq_count: number;
  short_answer_count: number;
};

type LectureAnalytics = {
  views: number;
  completionRate: number;
  avgWatchTimeSeconds: number;
};

type QuizAnalytics = {
  totalStudents: number;
  completed: number;
  pending: number;
  avgScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  scoreDistribution: {
    excellent: number;
    good: number;
    fair: number;
    needsImprovement: number;
  };
};

export default function CourseLectures() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const courseId = params.courseId as string;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [lectures, setLectures] = useState<LectureWithArtifacts[]>([]);
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [assignmentSystemMissing, setAssignmentSystemMissing] = useState(false);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [lectureAnalytics, setLectureAnalytics] = useState<Record<string, LectureAnalytics>>({});
  const [quizAnalytics, setQuizAnalytics] = useState<Record<string, QuizAnalytics>>({});
  const [studentPerformance, setStudentPerformance] = useState<StudentPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteLectureModal, setShowDeleteLectureModal] = useState<string | null>(null);
  const [showDeleteArtifactModal, setShowDeleteArtifactModal] = useState<{ lectureId: string; artifactId: string; type: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [playingMedia, setPlayingMedia] = useState<{ lectureId: string; type: 'video' | 'audio'; url: string } | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['overview', 'lectures', 'assignments', 'quizzes', 'students'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

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

      const { data: courseData } = await supabase
        .from('courses')
        .select('*')
        .eq('id', courseId)
        .eq('educator_id', user.id)
        .maybeSingle();

      if (courseData) {
        setCourse(courseData);
        await Promise.all([
          loadCourseLectures(),
          loadCourseAssignments(user.id),
          loadCourseQuizzes(),
          loadCourseLectureAnalytics(),
          loadCourseQuizAnalytics(),
          loadCourseStudentPerformance(),
        ]);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCourseLectures = async () => {
    try {
      const { data: lectureCourses, error: lcError } = await supabase
        .from('lecture_courses')
        .select('lecture_id')
        .eq('course_id', courseId);

      if (lcError) throw lcError;

      if (!lectureCourses || lectureCourses.length === 0) {
        setLectures([]);
        return;
      }

      const lectureIds = lectureCourses.map(lc => lc.lecture_id);

      const { data: lecturesData, error: lecturesError } = await supabase
        .from('lectures')
        .select('*')
        .in('id', lectureIds)
        .eq('creator_role', 'educator')
        .order('created_at', { ascending: false });

      if (lecturesError) throw lecturesError;

      if (!lecturesData) {
        setLectures([]);
        return;
      }

      const lecturesWithArtifacts: LectureWithArtifacts[] = await Promise.all(
        lecturesData.map(async (lecture) => {
          const { data: artifacts } = await supabase
            .from('lecture_artifacts')
            .select('id, artifact_type, file_url')
            .eq('lecture_id', lecture.id);

          return {
            ...lecture,
            artifacts: artifacts || []
          };
        })
      );

      setLectures(lecturesWithArtifacts);
    } catch (error) {
      console.error('Error loading lectures:', error);
      toast.error('Failed to load lectures');
    }
  };

  const loadCourseQuizzes = async () => {
    try {
      const { data: quizRelations, error } = await supabase
        .from('quiz_batch_courses')
        .select(`
          quiz_batches!inner(
            id,
            quiz_name,
            created_at,
            status,
            mode,
            material_source_mode,
            due_at,
            mcq_count,
            short_answer_count
          )
        `)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false, foreignTable: 'quiz_batches' });

      if (error) throw error;

      const normalizedQuizzes: Quiz[] = (quizRelations || [])
        .map((relation: any) => relation.quiz_batches)
        .filter(Boolean)
        .filter((quiz: any) => quiz.material_source_mode !== 'socratic_final')
        .map((quiz: any) => ({
          id: quiz.id,
          quiz_name: quiz.quiz_name,
          created_at: quiz.created_at,
          status: quiz.status,
          mode: quiz.mode,
          due_at: quiz.due_at,
          mcq_count: quiz.mcq_count,
          short_answer_count: quiz.short_answer_count,
        }))
        .sort((left, right) => (
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        ));

      setQuizzes(normalizedQuizzes);
    } catch (error) {
      console.error('Error loading quizzes:', error);
      toast.error('Failed to load quizzes');
    }
  };

  const loadCourseAssignments = async (educatorId: string) => {
    try {
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('assignments')
        .select('*')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false });

      if (assignmentError) {
        if (isAssignmentSystemMissingError(assignmentError)) {
          setAssignmentSystemMissing(true);
          setAssignments([]);
          return;
        }
        throw assignmentError;
      }

      const normalizedAssignments = ((assignmentRows || []) as any[]).map((assignment) => ({
        ...assignment,
        allowed_mime_types: Array.isArray(assignment.allowed_mime_types)
          ? assignment.allowed_mime_types
          : [],
      })) as AssignmentRecord[];

      if (normalizedAssignments.length === 0) {
        setAssignments([]);
        return;
      }

      const assignmentIds = normalizedAssignments.map((assignment) => assignment.id);

      const [{ data: targetRows, error: targetError }, { data: submissionRows, error: submissionError }] = await Promise.all([
        supabase
          .from('assignment_students')
          .select('assignment_id, student_id')
          .in('assignment_id', assignmentIds),
        supabase
          .from('assignment_submissions')
          .select('assignment_id, student_id, submitted_at, grade_score')
          .in('assignment_id', assignmentIds),
      ]);

      if (targetError) throw targetError;
      if (submissionError) throw submissionError;

      const targetCounts = new Map<string, number>();
      (targetRows || []).forEach((row: { assignment_id: string; student_id: string | null }) => {
        if (row.student_id === educatorId) return;
        targetCounts.set(row.assignment_id, (targetCounts.get(row.assignment_id) || 0) + 1);
      });

      const submittedCounts = new Map<string, number>();
      const gradedCounts = new Map<string, number>();
      const gradeTotals = new Map<string, number>();

      (submissionRows || []).forEach((row: { assignment_id: string; student_id: string | null; submitted_at: string | null; grade_score: number | null }) => {
        if (row.student_id === educatorId) return;
        if (row.submitted_at) {
          submittedCounts.set(row.assignment_id, (submittedCounts.get(row.assignment_id) || 0) + 1);
        }

        if (row.grade_score !== null) {
          gradedCounts.set(row.assignment_id, (gradedCounts.get(row.assignment_id) || 0) + 1);
          gradeTotals.set(row.assignment_id, (gradeTotals.get(row.assignment_id) || 0) + Number(row.grade_score));
        }
      });

      const enrichedAssignments: AssignmentSummary[] = normalizedAssignments.map((assignment) => {
        const totalStudents = targetCounts.get(assignment.id) || 0;
        const submitted = submittedCounts.get(assignment.id) || 0;
        const graded = gradedCounts.get(assignment.id) || 0;
        const totalGrades = gradeTotals.get(assignment.id) || 0;

        return {
          ...assignment,
          analytics: {
            totalStudents,
            submitted,
            graded,
            pending: Math.max(totalStudents - submitted, 0),
            avgScore: graded > 0 ? Number((totalGrades / graded).toFixed(1)) : null,
          },
        };
      });

      setAssignments(enrichedAssignments);
    } catch (error) {
      console.error('Error loading assignments:', error);
      toast.error('Failed to load assignments');
    }
  };

  const loadCourseLectureAnalytics = async () => {
    try {
      const { data, error } = await supabase.rpc('get_course_lecture_analytics', {
        p_course_id: courseId,
      });

      if (error) throw error;

      const analyticsMap = Object.fromEntries(
        ((data || []) as any[]).map((row) => [
          row.lecture_id,
          {
            views: Number(row.total_views || 0),
            completionRate: Number(row.completion_rate || 0),
            avgWatchTimeSeconds: Number(row.avg_watch_seconds || 0),
          } satisfies LectureAnalytics,
        ]),
      );

      setLectureAnalytics(analyticsMap);
    } catch (error) {
      console.error('Error loading lecture analytics:', error);
      setLectureAnalytics({});
    }
  };

  const loadCourseQuizAnalytics = async () => {
    try {
      const { data, error } = await supabase.rpc('get_course_quiz_analytics', {
        p_course_id: courseId,
      });

      if (error) throw error;

      const analyticsMap = Object.fromEntries(
        ((data || []) as any[]).map((row) => [
          row.quiz_batch_id,
          {
            totalStudents: Number(row.total_students || 0),
            completed: Number(row.completed_count || 0),
            pending: Number(row.pending_count || 0),
            avgScore: row.avg_score !== null ? Number(row.avg_score) : null,
            highestScore: row.highest_score !== null ? Number(row.highest_score) : null,
            lowestScore: row.lowest_score !== null ? Number(row.lowest_score) : null,
            scoreDistribution: {
              excellent: Number(row.excellent_count || 0),
              good: Number(row.good_count || 0),
              fair: Number(row.fair_count || 0),
              needsImprovement: Number(row.needs_improvement_count || 0),
            },
          } satisfies QuizAnalytics,
        ]),
      );

      setQuizAnalytics(analyticsMap);
    } catch (error) {
      console.error('Error loading quiz analytics:', error);
      setQuizAnalytics({});
    }
  };

  const loadCourseStudentPerformance = async () => {
    try {
      const { data, error } = await supabase.rpc('get_course_student_performance', {
        p_course_id: courseId,
      });

      if (error) throw error;

      const normalizedStudents: StudentPerformanceRow[] = ((data || []) as any[]).map((row) => ({
        courseStudentId: row.course_student_id,
        studentId: row.student_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        assignmentsSubmitted: Number(row.assignments_submitted || 0),
        assignmentsTotal: Number(row.assignments_total || 0),
        assignmentsAvg: row.assignments_avg !== null ? Number(row.assignments_avg) : null,
        quizzesCompleted: Number(row.quizzes_completed || 0),
        quizzesTotal: Number(row.quizzes_total || 0),
        quizzesAvg: row.quizzes_avg !== null ? Number(row.quizzes_avg) : null,
        lecturesCompleted: Number(row.lectures_completed || 0),
        lecturesTotal: Number(row.lectures_total || 0),
      }));

      setStudentPerformance(normalizedStudents);
    } catch (error) {
      console.error('Error loading student performance:', error);
      setStudentPerformance([]);
    }
  };

  const extractStoragePathFromPublicUrl = (url: string | null, bucket: string) => {
    if (!url) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(url.slice(index + marker.length));
  };

  const handleDeleteQuiz = async (quiz: Quiz) => {
    const confirmed = window.confirm(`Delete "${quiz.quiz_name || 'Untitled Quiz'}"? This will remove the quiz batch, generated content, attempts, and grading records.`);
    if (!confirmed) return;

    try {
      const [
        { data: studentFiles },
        { data: generatedRows },
        { data: batchRow },
      ] = await Promise.all([
        supabase
          .from('quiz_batch_student_files')
          .select('storage_path')
          .eq('quiz_batch_id', quiz.id),
        supabase
          .from('quiz_generated')
          .select('quiz_pdf_url, answers_pdf_url')
          .eq('quiz_batch_id', quiz.id),
        supabase
          .from('quiz_batches')
          .select('general_storage_path')
          .eq('id', quiz.id)
          .maybeSingle(),
      ]);

      const storagePaths = new Set<string>();
      (studentFiles || []).forEach((row: { storage_path: string | null }) => {
        if (row.storage_path) storagePaths.add(row.storage_path);
      });
      if (batchRow?.general_storage_path) {
        storagePaths.add(batchRow.general_storage_path);
      }
      (generatedRows || []).forEach((row: { quiz_pdf_url: string | null; answers_pdf_url: string | null }) => {
        const quizPdfPath = extractStoragePathFromPublicUrl(row.quiz_pdf_url, 'quiz-student-materials');
        const answersPdfPath = extractStoragePathFromPublicUrl(row.answers_pdf_url, 'quiz-student-materials');
        if (quizPdfPath) storagePaths.add(quizPdfPath);
        if (answersPdfPath) storagePaths.add(answersPdfPath);
      });

      if (storagePaths.size > 0) {
        await supabase.storage.from('quiz-student-materials').remove(Array.from(storagePaths));
      }

      const { error } = await supabase
        .from('quiz_batches')
        .delete()
        .eq('id', quiz.id);

      if (error) throw error;

      toast.success('Quiz deleted successfully');
      await loadCourseQuizzes();
    } catch (error) {
      console.error('Error deleting quiz:', error);
      toast.error('Failed to delete quiz');
    }
  };

  const handleDeleteLecture = async (lectureId: string) => {
    setDeleting(true);
    try {
      const { error: artifactsError } = await supabase
        .from('lecture_artifacts')
        .delete()
        .eq('lecture_id', lectureId);

      if (artifactsError) throw artifactsError;

      const { error: lectureError } = await supabase
        .from('lectures')
        .delete()
        .eq('id', lectureId);

      if (lectureError) throw lectureError;

      toast.success('Lecture deleted successfully');
      await loadCourseLectures();
      setShowDeleteLectureModal(null);
    } catch (error) {
      console.error('Error deleting lecture:', error);
      toast.error('Failed to delete lecture');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteArtifact = async (artifactId: string) => {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('lecture_artifacts')
        .delete()
        .eq('id', artifactId);

      if (error) throw error;

      toast.success('Artifact deleted successfully');
      await loadCourseLectures();
      setShowDeleteArtifactModal(null);
    } catch (error) {
      console.error('Error deleting artifact:', error);
      toast.error('Failed to delete artifact');
    } finally {
      setDeleting(false);
    }
  };

  const overviewStats = useMemo(() => {
    const quizAverages = Object.values(quizAnalytics)
      .map((analytics) => analytics.avgScore)
      .filter((value): value is number => value !== null);
    const dueAssignments = assignments.filter((assignment) => {
      if (!assignment.due_at) return false;
      const dueTime = new Date(assignment.due_at).getTime();
      const now = Date.now();
      const sevenDaysFromNow = now + (7 * 24 * 60 * 60 * 1000);
      return dueTime >= now && dueTime <= sevenDaysFromNow;
    }).length;

    return {
      totalStudents: studentPerformance.length,
      lecturesCreated: lectures.length,
      assignmentsCreated: assignments.length,
      quizzesCreated: quizzes.length,
      publishedLectures: lectures.filter((lecture) => lecture.status === 'published' || lecture.status === 'completed').length,
      dueAssignments,
      publishedQuizzes: quizzes.filter((quiz) => quiz.status === 'published').length,
      averageQuizScore: quizAverages.length > 0
        ? Math.round(quizAverages.reduce((sum, value) => sum + value, 0) / quizAverages.length)
        : null,
    };
  }, [assignments, lectures, quizzes, quizAnalytics, studentPerformance.length]);

  const overviewInsights = useMemo(() => {
    const insights: Array<{ type: 'positive' | 'info' | 'warning'; text: string }> = [];
    const highestLecture = lectures
      .map((lecture) => ({
        lecture,
        analytics: lectureAnalytics[lecture.id],
      }))
      .filter((item) => item.analytics)
      .sort((a, b) => (b.analytics?.completionRate || 0) - (a.analytics?.completionRate || 0))[0];

    if (highestLecture?.analytics) {
      insights.push({
        type: 'info',
        text: `"${highestLecture.lecture.title}" has the highest lecture completion rate at ${Math.round(highestLecture.analytics.completionRate)}%.`,
      });
    }

    const pendingAssignments = assignments.reduce((sum, assignment) => sum + assignment.analytics.pending, 0);
    insights.push({
      type: pendingAssignments > 0 ? 'warning' : 'positive',
      text: pendingAssignments > 0
        ? `${pendingAssignments} assignment submission${pendingAssignments === 1 ? '' : 's'} are still pending across this course.`
        : 'All current assignments have been submitted by the enrolled roster.',
    });

    const lowestQuiz = quizzes
      .map((quiz) => ({
        quiz,
        analytics: quizAnalytics[quiz.id],
      }))
      .filter((item) => item.analytics && item.analytics.totalStudents > 0)
      .sort((a, b) => {
        const left = (a.analytics!.completed / Math.max(a.analytics!.totalStudents, 1));
        const right = (b.analytics!.completed / Math.max(b.analytics!.totalStudents, 1));
        return left - right;
      })[0];

    if (lowestQuiz?.analytics) {
      const completionRate = Math.round((lowestQuiz.analytics.completed / Math.max(lowestQuiz.analytics.totalStudents, 1)) * 100);
      insights.push({
        type: completionRate < 75 ? 'warning' : 'positive',
        text: `"${lowestQuiz.quiz.quiz_name || 'Untitled Quiz'}" is currently at ${completionRate}% completion.`,
      });
    }

    if (studentPerformance.length > 0) {
      const lowLectureCount = studentPerformance.filter((student) => {
        return student.lecturesTotal > 0 && (student.lecturesCompleted / student.lecturesTotal) < 0.5;
      }).length;
      insights.push({
        type: lowLectureCount > 0 ? 'warning' : 'positive',
        text: lowLectureCount > 0
          ? `${lowLectureCount} student${lowLectureCount === 1 ? '' : 's'} have completed fewer than half of the published lectures.`
          : 'Lecture engagement is strong across the current roster.',
      });
    }

    if (insights.length === 0) {
      insights.push({
        type: 'info',
        text: 'Create course content to unlock overview insights for this course.',
      });
    }

    return insights.slice(0, 4);
  }, [assignments, lectureAnalytics, lectures, quizAnalytics, quizzes, studentPerformance]);

  if (loading) {
    return (
      <EducatorLayout profile={profile ?? undefined}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-maroon mx-auto mb-4"></div>
            <p className="text-gray-600">Loading course...</p>
          </div>
        </div>
      </EducatorLayout>
    );
  }

  if (!course) {
    return (
      <EducatorLayout profile={profile ?? undefined}>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Course Not Found</h3>
            <p className="text-gray-600 mb-6">The course you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
            <button
              onClick={() => router.push('/educator/dashboard')}
              className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2 px-6 rounded-lg transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </EducatorLayout>
    );
  }

  return (
    <EducatorLayout profile={profile ?? undefined}>
      <div className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-6">
            <button
              onClick={() => router.push('/educator/dashboard')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Dashboard
            </button>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-1">{course.title}</h1>
                <p className="text-gray-600">{course.course_number} • {course.semester}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowCreateMenu(!showCreateMenu)}
                    onBlur={() => setTimeout(() => setShowCreateMenu(false), 200)}
                    className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    Create
                  </button>
                  {showCreateMenu && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-10">
                      <button
                        onClick={() => {
                          router.push('/educator/lecture/new');
                          setShowCreateMenu(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2"
                      >
                        <Video className="w-4 h-4" />
                        New Lecture
                      </button>
                      <button
                        onClick={() => {
                          router.push(`/educator/assignment/new?courseId=${courseId}`);
                          setShowCreateMenu(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4" />
                        New Assignment
                      </button>
                      <button
                        onClick={() => {
                          router.push(`/educator/socratic-writing?courseId=${courseId}`);
                          setShowCreateMenu(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2"
                      >
                        <BookOpen className="w-4 h-4" />
                        New Socratic Assignment
                      </button>
                      <button
                        onClick={() => {
                          router.push(`/educator/quiz/new?courseId=${courseId}`);
                          setShowCreateMenu(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2"
                      >
                        <ListChecks className="w-4 h-4" />
                        New Quiz
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => router.push(`/educator/course/${courseId}/edit`)}
                  className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2"
                >
                  Edit Course
                </button>
              </div>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="bg-white border-b border-gray-200 -mx-4 px-4 mb-6">
              <TabsList className="bg-transparent h-auto p-0 space-x-0">
                <TabsTrigger
                  value="overview"
                  className="bg-transparent shadow-none border-b-2 border-transparent data-[state=active]:border-brand-maroon data-[state=active]:text-brand-maroon data-[state=active]:bg-transparent rounded-none px-4 py-3 font-semibold text-gray-600 hover:text-gray-900 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 flex items-center gap-2"
                >
                  <BookOpen className="w-4 h-4" />
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="lectures"
                  className="bg-transparent shadow-none border-b-2 border-transparent data-[state=active]:border-brand-maroon data-[state=active]:text-brand-maroon data-[state=active]:bg-transparent rounded-none px-4 py-3 font-semibold text-gray-600 hover:text-gray-900 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 flex items-center gap-2"
                >
                  <Video className="w-4 h-4" />
                  Lectures
                </TabsTrigger>
                <TabsTrigger
                  value="assignments"
                  className="bg-transparent shadow-none border-b-2 border-transparent data-[state=active]:border-brand-maroon data-[state=active]:text-brand-maroon data-[state=active]:bg-transparent rounded-none px-4 py-3 font-semibold text-gray-600 hover:text-gray-900 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Assignments
                </TabsTrigger>
                <TabsTrigger
                  value="quizzes"
                  className="bg-transparent shadow-none border-b-2 border-transparent data-[state=active]:border-brand-maroon data-[state=active]:text-brand-maroon data-[state=active]:bg-transparent rounded-none px-4 py-3 font-semibold text-gray-600 hover:text-gray-900 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 flex items-center gap-2"
                >
                  <ListChecks className="w-4 h-4" />
                  Quizzes
                </TabsTrigger>
                <TabsTrigger
                  value="students"
                  className="bg-transparent shadow-none border-b-2 border-transparent data-[state=active]:border-brand-maroon data-[state=active]:text-brand-maroon data-[state=active]:bg-transparent rounded-none px-4 py-3 font-semibold text-gray-600 hover:text-gray-900 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 flex items-center gap-2"
                >
                  <Users className="w-4 h-4" />
                  Student Management
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="mt-0">
              <EducatorCourseOverview stats={overviewStats} insights={overviewInsights} />
            </TabsContent>

            <TabsContent value="lectures" className="mt-0">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Course Lectures</h2>
                  <p className="text-gray-600 text-sm mt-1">{lectures.length} lectures published</p>
                </div>
                <button
                  onClick={() => router.push('/educator/lecture/new')}
                  className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  View Analytics
                </button>
              </div>

              {lectures.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                  <div className="max-w-md mx-auto">
                    <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Video className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Lectures Yet</h3>
                    <p className="text-gray-600 text-sm mb-6">
                      This course doesn&apos;t have any lectures yet. Create a new lecture by selecting this course in the lecture creation flow.
                    </p>
                    <button
                      onClick={() => router.push('/educator/lecture/new')}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
                    >
                      Create Lecture
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {lectures.map((lecture) => (
                    <EducatorLectureCard
                      key={lecture.id}
                      lecture={lecture}
                      analytics={lectureAnalytics[lecture.id]}
                      onEdit={() => router.push(`/educator/lecture/new?id=${lecture.id}&mode=edit`)}
                      onDelete={() => setShowDeleteLectureModal(lecture.id)}
                      onPlayVideo={(url) => setPlayingMedia({ lectureId: lecture.id, type: 'video', url })}
                      onPlayAudio={(url) => setPlayingMedia({ lectureId: lecture.id, type: 'audio', url })}
                      onDeleteArtifact={(artifactId, type) => setShowDeleteArtifactModal({ lectureId: lecture.id, artifactId, type })}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="assignments" className="mt-0">
              {assignmentSystemMissing && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {getAssignmentSystemMissingMessage()}
                </div>
              )}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Course Assignments</h2>
                  <p className="text-gray-600 text-sm mt-1">{assignments.length} assignments created</p>
                </div>
                <button
                  onClick={() => router.push(`/educator/assignment/new?courseId=${courseId}`)}
                  disabled={assignmentSystemMissing}
                  className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Create New Assignment
                </button>
              </div>

              {assignments.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                  <div className="max-w-md mx-auto">
                    <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <FileText className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Assignments Yet</h3>
                    <p className="text-gray-600 text-sm mb-6">
                      Create your first assignment for this course, upload the question PDF, and publish it to the enrolled students.
                    </p>
                    <button
                      onClick={() => router.push(`/educator/assignment/new?courseId=${courseId}`)}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
                    >
                      Create Assignment
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {assignments.map((assignment) => (
                    <EducatorAssignmentCard
                      key={assignment.id}
                      assignment={assignment}
                      analytics={assignment.analytics}
                      isSocratic={assignment.experience_type === 'socratic_writing'}
                      onViewDetails={() => router.push(`/educator/assignment/${assignment.id}`)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="quizzes" className="mt-0">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Course Quizzes</h2>
                  <p className="text-gray-600 text-sm mt-1">{quizzes.length} quizzes created</p>
                </div>
                <button
                  onClick={() => router.push(`/educator/quiz/new?courseId=${courseId}`)}
                  className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Create New Quiz
                </button>
              </div>

              {quizzes.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                  <div className="max-w-md mx-auto">
                    <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <ListChecks className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Quizzes Yet</h3>
                    <p className="text-gray-600 text-sm mb-6">
                      Create your first quiz to assess student understanding.
                    </p>
                    <button
                      onClick={() => router.push('/educator/quiz/new')}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
                    >
                      Create Quiz
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {quizzes.map((quiz) => {
                    const totalMarks = quiz.mode === 'online'
                      ? (quiz.mcq_count + quiz.short_answer_count)
                      : ((quiz.mcq_count * 2) + (quiz.short_answer_count * 5));

                    return (
                      <EducatorQuizCard
                        key={quiz.id}
                        quiz={quiz}
                        totalMarks={totalMarks}
                        analytics={quizAnalytics[quiz.id]}
                        onEdit={() => router.push(`/educator/quiz/new?id=${quiz.id}`)}
                        onDelete={() => handleDeleteQuiz(quiz)}
                        onView={() => quiz.mode === 'online'
                          ? router.push(`/educator/quiz/${quiz.id}`)
                          : router.push(`/educator/quiz/new?id=${quiz.id}`)}
                        onClick={() => quiz.mode === 'online'
                          ? router.push(`/educator/quiz/${quiz.id}`)
                          : router.push(`/educator/quiz/new?id=${quiz.id}`)}
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="students" className="mt-0">
              <StudentManagementTable
                students={studentPerformance}
                onAddStudent={() => toast.info('Add student feature coming soon')}
                onBulkImport={() => toast.info('Bulk import feature coming soon')}
                onViewStudent={(student) => router.push(`/educator/course/${courseId}/student/${student.courseStudentId}`)}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {showDeleteLectureModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Lecture</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this lecture? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteLectureModal(null)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteLecture(showDeleteLectureModal)}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteArtifactModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete {showDeleteArtifactModal.type}</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this {showDeleteArtifactModal.type}? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteArtifactModal(null)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteArtifact(showDeleteArtifactModal.artifactId)}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {playingMedia && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {playingMedia.type === 'video' ? 'Video Player' : 'Audio Player'}
              </h3>
              <button
                onClick={() => setPlayingMedia(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            {playingMedia.type === 'video' ? (
              <video
                src={playingMedia.url}
                controls
                autoPlay
                className="w-full rounded-lg"
              />
            ) : (
              <audio
                src={playingMedia.url}
                controls
                autoPlay
                className="w-full"
              />
            )}
          </div>
        </div>
      )}
    </EducatorLayout>
  );
}
