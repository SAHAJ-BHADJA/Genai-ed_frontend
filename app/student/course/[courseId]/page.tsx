'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import StudentLayout from '@/components/StudentLayout';
import LectureCard from '@/components/LectureCard';
import StudentQuizCard from '@/components/StudentQuizCard';
import StudentAssignmentCard from '@/components/StudentAssignmentCard';
import StudentPerformanceSummary from '@/components/StudentPerformanceSummary';
import { getBackendBase } from '@/lib/backend';
import { supabase, Profile } from '@/lib/supabase';
import { hasProfileRole } from '@/lib/profileRoles';
import {
  getAssignmentSystemMissingMessage,
  isAssignmentSystemMissingError,
} from '@/lib/assignmentSystemErrors';
import {
  getStudentAssignmentCardStatus,
  StudentCourseAssignment,
} from '@/lib/assignments';
import { BookOpen, MessageSquare, Upload, FileText, Trash2, Send, Video, SquareCheck as CheckSquare, FileCheck, ClipboardList, ChartBar as BarChart3, Clock, Calendar, Eye } from 'lucide-react';

const backendBase = getBackendBase();

interface Course {
  id: string;
  course_number: string;
  title: string;
  instructor_name: string;
  semester: string;
  syllabus_url: string | null;
}

interface Lecture {
  id: string;
  title: string;
  duration: number;
  created_at: string;
  status: string;
}

interface StudentLecture {
  id: string;
  title: string;
  duration: number;
  created_at: string;
  status: string;
}

interface Upload {
  id: string;
  file_name: string;
  file_size: number;
  created_at: string;
}

interface InClassQuizQuestion {
  question: string;
  options?: string[] | Record<string, string>;
  correct?: string;
  correct_answer?: string;
  explanation?: string;
}

interface InClassQuizAnswer {
  question?: string;
  options?: string[] | Record<string, string>;
  correct?: string;
  correct_answer: string;
  explanation?: string;
}

interface InClassQuiz {
  id: string;
  quiz_batch_id: string;
  title: string;
  status: string;
  student_file_name: string | null;
  mcq_count: number;
  short_answer_count: number;
  created_at: string;
  quiz_content_json: {
    questions?: InClassQuizQuestion[];
    mcq?: InClassQuizQuestion[];
    short_answer?: InClassQuizQuestion[];
  } | null;
  answers_content_json: {
    answers?: InClassQuizAnswer[];
    mcq?: InClassQuizAnswer[];
    short_answer?: InClassQuizAnswer[];
  } | null;
  quiz_pdf_url: string | null;
  answers_pdf_url: string | null;
}

interface OnlineQuizSummary {
  quiz_batch_id: string;
  quiz_name: string;
  status: 'upcoming' | 'available' | 'in_progress' | 'submitted' | 'grades_released' | 'closed';
  question_count: number;
  total_marks: number;
  duration_minutes: number;
  due_at: string | null;
  available_at: string | null;
  score: number | null;
}

type LectureProgress = {
  completedLectures: number;
  totalLectures: number;
};

export default function StudentCourse() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.courseId as string;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'lectures' | 'assignments' | 'quiz' | 'chat' | 'uploads'>('overview');
  const [course, setCourse] = useState<Course | null>(null);
  const [courseLectures, setCourseLectures] = useState<Lecture[]>([]);
  const [myLectures, setMyLectures] = useState<StudentLecture[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [inClassQuizzes, setInClassQuizzes] = useState<InClassQuiz[]>([]);
  const [onlineQuizzes, setOnlineQuizzes] = useState<OnlineQuizSummary[]>([]);
  const [onlineQuizError, setOnlineQuizError] = useState<string | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentCourseAssignment[]>([]);
  const [assignmentSystemMissing, setAssignmentSystemMissing] = useState(false);
  const [quizView, setQuizView] = useState<'in-class' | 'online'>('in-class');
  const [lectureProgress, setLectureProgress] = useState<LectureProgress>({
    completedLectures: 0,
    totalLectures: 0,
  });
  const [contextSources, setContextSources] = useState({
    syllabus: true,
    courseMaterials: true,
    studentUploads: true
  });
  const [prompt, setPrompt] = useState('');
  const [videoLength, setVideoLength] = useState(5);
  const [generating, setGenerating] = useState(false);

  const assignmentSummaryData = useMemo(() => {
    return {
      totalQuizzes: inClassQuizzes.length + onlineQuizzes.length,
      totalAssignments: studentAssignments.length,
      totalLectures: courseLectures.length,
      performanceItems: [
        ...onlineQuizzes.map((quiz) => ({
          name: quiz.quiz_name,
          type: 'quiz' as const,
          marksScored: quiz.status === 'grades_released' ? quiz.score : null,
          totalMarks: quiz.total_marks,
          status: quiz.status === 'grades_released'
            ? 'completed' as const
            : quiz.status === 'submitted'
            ? 'submitted' as const
            : 'pending' as const,
        })),
        ...studentAssignments.map((assignment) => ({
          name: assignment.assignment_label,
          type: 'assignment' as const,
          marksScored: assignment.grade_score,
          totalMarks: assignment.points_possible,
          status: assignment.grade_score !== null
            ? 'completed' as const
            : assignment.submitted_at
            ? 'submitted' as const
            : 'pending' as const,
        })),
      ],
    };
  }, [courseLectures.length, inClassQuizzes.length, onlineQuizzes, studentAssignments]);

  useEffect(() => {
    checkAuthAndLoadData();
  }, [courseId]);

  useEffect(() => {
    if (!loading && onlineQuizzes.length > 0) {
      setQuizView((currentView) => currentView === 'in-class' ? 'online' : currentView);
    }
  }, [loading, onlineQuizzes.length]);

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

    if (!profileData || !hasProfileRole(profileData, 'student')) {
      router.push('/');
      return;
    }

    setProfile(profileData);
    await loadCourseData(user.email!, user.id);
  };

  const loadCourseData = async (email: string, userId: string) => {
    const { data: enrollment } = await supabase
      .from('course_students')
      .select('course_id')
      .eq('email', email)
      .eq('course_id', courseId)
      .maybeSingle();

    if (!enrollment) {
      router.push('/student/dashboard');
      return;
    }

    const { data: courseData } = await supabase
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .maybeSingle();

    if (courseData) {
      setCourse(courseData);
    }

    const { data: lectureCourses } = await supabase
      .from('lecture_courses')
      .select(`
        lecture_id,
        lectures!inner(id, title, video_length, created_at, status, creator_role, creator_user_id)
      `)
      .eq('course_id', courseId);

    if (lectureCourses) {
      const educatorLectures: Lecture[] = [];
      const studentLectures: StudentLecture[] = [];

      lectureCourses.forEach((lc: any) => {
        const lecture = lc.lectures;
        if (!lecture) return;

        const formattedLecture = {
          id: lecture.id,
          title: lecture.title,
          duration: lecture.video_length || 0,
          created_at: lecture.created_at,
          status: lecture.status
        };

        if (lecture.creator_role === 'educator' && (lecture.status === 'completed' || lecture.status === 'published')) {
          educatorLectures.push(formattedLecture);
        } else if (lecture.creator_role === 'student' && lecture.creator_user_id === userId) {
          studentLectures.push(formattedLecture);
        }
      });

      educatorLectures.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      studentLectures.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setCourseLectures(educatorLectures);
      setMyLectures(studentLectures);

      const educatorLectureIds = educatorLectures.map((lecture) => lecture.id);
      if (educatorLectureIds.length > 0) {
        const { data: lectureViews } = await supabase
          .from('student_lecture_views')
          .select('lecture_id, completed')
          .eq('student_id', userId)
          .in('lecture_id', educatorLectureIds);

        const completedLectureIds = new Set(
          (lectureViews || [])
            .filter((view: { lecture_id: string; completed: boolean }) => view.completed)
            .map((view: { lecture_id: string }) => view.lecture_id),
        );

        setLectureProgress({
          completedLectures: completedLectureIds.size,
          totalLectures: educatorLectures.length,
        });
      } else {
        setLectureProgress({
          completedLectures: 0,
          totalLectures: 0,
        });
      }
    } else {
      setCourseLectures([]);
      setMyLectures([]);
      setLectureProgress({
        completedLectures: 0,
        totalLectures: 0,
      });
    }

    const { data: uploadsData } = await supabase
      .from('student_uploads')
      .select('*')
      .eq('student_id', userId)
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (uploadsData) {
      setUploads(uploadsData);
    }

    await Promise.all([
      loadInClassQuizzes(userId),
      loadOnlineQuizzes(userId),
      loadStudentAssignments(),
    ]);

    setLoading(false);
  };

  const loadStudentAssignments = async () => {
    const { data, error } = await supabase.rpc('get_student_course_assignments', {
      p_course_id: courseId,
    });

    if (error) {
      console.error('Error loading assignments:', error);
      if (isAssignmentSystemMissingError(error)) {
        setAssignmentSystemMissing(true);
        setStudentAssignments([]);
        return;
      }
      setStudentAssignments([]);
      return;
    }

    const normalizedAssignments = ((data || []) as any[]).map((assignment) => ({
      ...assignment,
      allowed_mime_types: Array.isArray(assignment.allowed_mime_types)
        ? assignment.allowed_mime_types
        : [],
    })) as StudentCourseAssignment[];

    if (normalizedAssignments.length === 0) {
      setStudentAssignments([]);
      return;
    }

    const { data: assignmentRows, error: assignmentRowsError } = await supabase
      .from('assignments')
      .select('id, experience_type, assignment_number')
      .in('id', normalizedAssignments.map((assignment) => assignment.id));

    if (assignmentRowsError) {
      console.error('Error loading assignment experience types:', assignmentRowsError);
      setStudentAssignments(normalizedAssignments);
      return;
    }

    const assignmentMetadataById = new Map(
      ((assignmentRows || []) as Array<{
        id: string;
        experience_type: StudentCourseAssignment['experience_type'];
        assignment_number: number;
      }>).map((row) => [row.id, row]),
    );

    setStudentAssignments(
      normalizedAssignments
        .map((assignment) => {
          const metadata = assignmentMetadataById.get(assignment.id);

          return {
            ...assignment,
            assignment_number: metadata?.assignment_number,
            experience_type: metadata?.experience_type || 'standard',
          };
        })
        .sort((firstAssignment, secondAssignment) => {
          const firstNumber = firstAssignment.assignment_number ?? Number.MAX_SAFE_INTEGER;
          const secondNumber = secondAssignment.assignment_number ?? Number.MAX_SAFE_INTEGER;

          if (firstNumber !== secondNumber) {
            return firstNumber - secondNumber;
          }

          return firstAssignment.created_at.localeCompare(secondAssignment.created_at);
        }),
    );
  };

  const loadInClassQuizzes = async (userId: string) => {
    const normalizeRpcRows = (rows: Array<{
      id: string;
      quiz_batch_id: string;
      quiz_name: string | null;
      status: string | null;
      student_file_name: string | null;
      mcq_count: number;
      short_answer_count: number;
      created_at: string;
      quiz_content_json: InClassQuiz['quiz_content_json'];
      answers_content_json: InClassQuiz['answers_content_json'];
      quiz_pdf_url: string | null;
      answers_pdf_url: string | null;
    }>) => rows.map((quiz) => ({
      ...quiz,
      title: quiz.quiz_name || 'Untitled In-Class Quiz',
      status: quiz.status || 'generated',
    }));

    const { data, error } = await supabase
      .rpc('get_student_course_generated_quizzes', { p_course_id: courseId });

    if (!error) {
      setInClassQuizzes(normalizeRpcRows((data || []) as Array<{
        id: string;
        quiz_batch_id: string;
        quiz_name: string | null;
        status: string | null;
        student_file_name: string | null;
        mcq_count: number;
        short_answer_count: number;
        created_at: string;
        quiz_content_json: InClassQuiz['quiz_content_json'];
        answers_content_json: InClassQuiz['answers_content_json'];
        quiz_pdf_url: string | null;
        answers_pdf_url: string | null;
      }>));
      return;
    }

    if (error.code !== 'PGRST202') {
      console.error('Error loading generated quizzes:', error);
      setInClassQuizzes([]);
      return;
    }

    const { data: courseQuizLinks, error: linksError } = await supabase
      .from('quiz_batch_courses')
      .select('quiz_batch_id')
      .eq('course_id', courseId);

    if (linksError) {
      console.error('Error loading course quiz links:', linksError);
      setInClassQuizzes([]);
      return;
    }

    const quizBatchIds = Array.from(
      new Set((courseQuizLinks || []).map((row) => row.quiz_batch_id).filter(Boolean))
    );

    if (quizBatchIds.length === 0) {
      setInClassQuizzes([]);
      return;
    }

    const [
      { data: generatedQuizzes, error: generatedError },
      { data: batchRows, error: batchError }
    ] = await Promise.all([
      supabase
        .from('quiz_generated')
        .select(`
          id,
          quiz_batch_id,
          student_file_name,
          mcq_count,
          short_answer_count,
          created_at,
          quiz_content_json,
          answers_content_json,
          quiz_pdf_url,
          answers_pdf_url
        `)
        .eq('student_id', userId)
        .in('quiz_batch_id', quizBatchIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('quiz_batches')
        .select('id, quiz_name, status')
        .in('id', quizBatchIds)
        .in('status', ['generated', 'saved'])
    ]);

    if (generatedError) {
      console.error('Error loading generated quizzes:', generatedError);
      setInClassQuizzes([]);
      return;
    }

    if (batchError) {
      console.error('Error loading quiz batch names:', batchError);
      setInClassQuizzes([]);
      return;
    }

    const batchMap = new Map(
      (batchRows || []).map((batch) => [batch.id, batch])
    );

    const normalizedQuizzes: InClassQuiz[] = ((generatedQuizzes || []) as Array<{
      id: string;
      quiz_batch_id: string;
      student_file_name: string | null;
      mcq_count: number;
      short_answer_count: number;
      created_at: string;
      quiz_content_json: InClassQuiz['quiz_content_json'];
      answers_content_json: InClassQuiz['answers_content_json'];
      quiz_pdf_url: string | null;
      answers_pdf_url: string | null;
    }>).map((quiz) => ({
      id: quiz.id,
      quiz_batch_id: quiz.quiz_batch_id,
      title: batchMap.get(quiz.quiz_batch_id)?.quiz_name || 'Untitled In-Class Quiz',
      status: batchMap.get(quiz.quiz_batch_id)?.status || 'generated',
      student_file_name: quiz.student_file_name,
      mcq_count: quiz.mcq_count,
      short_answer_count: quiz.short_answer_count,
      created_at: quiz.created_at,
      quiz_content_json: quiz.quiz_content_json,
      answers_content_json: quiz.answers_content_json,
      quiz_pdf_url: quiz.quiz_pdf_url,
      answers_pdf_url: quiz.answers_pdf_url,
    })).filter((quiz) => quiz.status === 'generated' || quiz.status === 'saved');

    setInClassQuizzes(normalizedQuizzes);
  };

  const loadOnlineQuizzes = async (userId: string) => {
    if (!backendBase) {
      setOnlineQuizError('Online quiz service is not configured.');
      setOnlineQuizzes([]);
      return;
    }

    try {
      setOnlineQuizError(null);
      const response = await fetch(
        `${backendBase}/api/student/quiz/online?courseId=${courseId}&studentId=${userId}`,
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = await response.json();
      setOnlineQuizzes((payload.quizzes || []) as OnlineQuizSummary[]);
    } catch (error) {
      console.error('Error loading online quizzes:', error);
      setOnlineQuizError(error instanceof Error ? error.message : 'Unable to load online quizzes.');
      setOnlineQuizzes([]);
    }
  };

  const createDocumentWindow = (html: string) => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const getQuizQuestions = (quiz: InClassQuiz) => {
    return quiz.quiz_content_json?.questions
      || quiz.quiz_content_json?.mcq
      || [];
  };

  const getQuizAnswers = (quiz: InClassQuiz) => {
    return quiz.answers_content_json?.answers
      || quiz.answers_content_json?.mcq
      || [];
  };

  const normalizeOptions = (options?: string[] | Record<string, string>) => {
    if (!options) return [];
    if (Array.isArray(options)) return options;
    return Object.entries(options).map(([key, value]) => `${key}. ${value}`);
  };

  const openInClassQuestions = (quiz: InClassQuiz) => {
    if (quiz.quiz_pdf_url) {
      window.open(quiz.quiz_pdf_url, '_blank', 'noopener,noreferrer');
      return;
    }

    const questions = getQuizQuestions(quiz);
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${quiz.title} - Questions</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 24px; color: #111827; }
    h1 { color: #7c0000; margin-bottom: 8px; }
    .meta { color: #6b7280; margin-bottom: 28px; }
    .question { border-top: 1px solid #e5e7eb; padding: 20px 0; }
    .question:first-of-type { border-top: 0; }
    .prompt { font-weight: 600; margin-bottom: 10px; }
    ul { margin: 0; padding-left: 20px; }
    li { margin-bottom: 6px; }
  </style>
</head>
<body>
  <h1>${quiz.title}</h1>
  <div class="meta">Material: ${quiz.student_file_name || 'Student material'} | Questions: ${questions.length}</div>
  ${questions.map((item, index) => `
    <section class="question">
      <div class="prompt">${index + 1}. ${item.question}</div>
      ${(normalizeOptions(item.options).length > 0)
        ? `<ul>${normalizeOptions(item.options).map((option) => `<li>${option}</li>`).join('')}</ul>`
        : '<p>No options provided.</p>'}
    </section>
  `).join('')}
</body>
</html>`;

    createDocumentWindow(html);
  };

  const openInClassAnswers = (quiz: InClassQuiz) => {
    if (quiz.answers_pdf_url) {
      window.open(quiz.answers_pdf_url, '_blank', 'noopener,noreferrer');
      return;
    }

    const answers = getQuizAnswers(quiz);
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${quiz.title} - Answers</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 24px; color: #111827; }
    h1 { color: #7c0000; margin-bottom: 8px; }
    .meta { color: #6b7280; margin-bottom: 28px; }
    .answer { border-top: 1px solid #e5e7eb; padding: 20px 0; }
    .answer:first-of-type { border-top: 0; }
    .value { font-weight: 600; margin-bottom: 8px; }
    .explanation { color: #4b5563; }
  </style>
</head>
<body>
  <h1>${quiz.title}</h1>
  <div class="meta">Answer Key | Material: ${quiz.student_file_name || 'Student material'}</div>
  ${answers.map((item, index) => `
    <section class="answer">
      <div class="value">${index + 1}. Correct Answer: ${item.correct_answer || item.correct || 'N/A'}</div>
      <div class="explanation">${item.explanation || 'No explanation provided.'}</div>
    </section>
  `).join('')}
</body>
</html>`;

    createDocumentWindow(html);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: uploadData, error } = await supabase
      .from('student_uploads')
      .insert({
        student_id: user.id,
        course_id: courseId,
        file_name: file.name,
        file_url: 'placeholder_url',
        file_size: file.size
      })
      .select()
      .single();

    if (!error && uploadData) {
      setUploads([uploadData, ...uploads]);
    }
  };

  const handleDeleteUpload = async (uploadId: string) => {
    await supabase
      .from('student_uploads')
      .delete()
      .eq('id', uploadId);

    setUploads(uploads.filter(u => u.id !== uploadId));
  };

  const handleGenerateLecture = async () => {
    if (!prompt.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setGenerating(true);

    const { data: newLecture, error } = await supabase
      .from('lectures')
      .insert({
        creator_role: 'student',
        creator_user_id: user.id,
        educator_id: user.id,
        course_id: courseId,
        title: prompt.slice(0, 100),
        script_prompt: prompt,
        video_length: videoLength,
        status: 'generating'
      })
      .select()
      .single();

    setGenerating(false);

    if (!error && newLecture) {
      router.push(`/student/course/${courseId}/my/lecture/${newLecture.id}`);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return 'Today';
    if (diffInDays === 1) return 'Yesterday';
    if (diffInDays < 7) return `${diffInDays} days ago`;
    return `${Math.floor(diffInDays / 7)} weeks ago`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-maroon border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading course...</p>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <StudentLayout profile={profile}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-gray-600">Course not found</p>
          </div>
        </div>
      </StudentLayout>
    );
  }

  return (
    <StudentLayout profile={profile}>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {course.course_number}: {course.title}
              </h1>
              <p className="text-muted-foreground">
                {course.instructor_name} • {course.semester}
              </p>
            </div>
          </div>
        </div>

        <div className="border-b border-border">
          <div className="flex gap-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-3 px-2 font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'text-brand-maroon after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-maroon'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BarChart3 className="w-5 h-5 inline mr-2" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('lectures')}
              className={`pb-3 px-2 font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'lectures'
                  ? 'text-brand-maroon after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-maroon'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="w-5 h-5 inline mr-2" />
              Lectures
            </button>
            <button
              onClick={() => setActiveTab('assignments')}
              className={`pb-3 px-2 font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'assignments'
                  ? 'text-brand-maroon after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-maroon'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ClipboardList className="w-5 h-5 inline mr-2" />
              Assignments
            </button>
            <button
              onClick={() => setActiveTab('quiz')}
              className={`pb-3 px-2 font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'quiz'
                  ? 'text-brand-maroon after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-maroon'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileCheck className="w-5 h-5 inline mr-2" />
              Quizzes
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`pb-3 px-2 font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'chat'
                  ? 'text-brand-maroon after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-maroon'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MessageSquare className="w-5 h-5 inline mr-2" />
              Course Chat
            </button>
            <button
              onClick={() => setActiveTab('uploads')}
              className={`pb-3 px-2 font-medium transition-colors relative whitespace-nowrap ${
                activeTab === 'uploads'
                  ? 'text-brand-maroon after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-maroon'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Upload className="w-5 h-5 inline mr-2" />
              My Uploads
            </button>
          </div>
        </div>

        {activeTab === 'lectures' && (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-bold text-foreground mb-4">Course Lectures</h2>
              {courseLectures.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {courseLectures.map((lecture) => (
                    <LectureCard
                      key={lecture.id}
                      title={lecture.title}
                      courseCode={course.course_number}
                      instructorName={course.instructor_name}
                      isEducatorLecture={true}
                      onClick={() => router.push(`/student/course/${courseId}/lecture/${lecture.id}`)}
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No lectures available yet</p>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-4">My Generated Lectures</h2>
              {myLectures.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {myLectures.map((lecture) => (
                    <LectureCard
                      key={lecture.id}
                      title={lecture.title}
                      courseCode={course.course_number}
                      instructorName="You"
                      status={lecture.status}
                      onClick={() => router.push(`/student/course/${courseId}/my/lecture/${lecture.id}`)}
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <Video className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">You haven&apos;t generated any lectures yet</p>
                  <button
                    onClick={() => setActiveTab('chat')}
                    className="bg-brand-maroon hover:bg-brand-maroon-hover text-white px-6 py-2 rounded-lg transition-colors"
                  >
                    Generate Your First Lecture
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'quiz' && (
          <div>
            <div className="flex items-center justify-between gap-4 mb-6">
              <h2 className="text-xl font-bold text-foreground">Available Quizzes</h2>
              <div className="inline-flex rounded-lg border border-border p-1 bg-card">
                <button
                  onClick={() => setQuizView('in-class')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    quizView === 'in-class'
                      ? 'bg-brand-maroon text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  In Class ({inClassQuizzes.length})
                </button>
                <button
                  onClick={() => setQuizView('online')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    quizView === 'online'
                      ? 'bg-brand-maroon text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Online ({onlineQuizzes.length})
                </button>
              </div>
            </div>

            {quizView === 'in-class' && (
              <>
                {inClassQuizzes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {inClassQuizzes.map((quiz) => {
                      const questionCount = getQuizQuestions(quiz).length;

                      return (
                        <div key={quiz.id} className="bg-card border border-border rounded-xl p-6">
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <FileCheck className="w-5 h-5 text-brand-maroon" />
                                <h3 className="text-lg font-semibold text-foreground">{quiz.title}</h3>
                              </div>
                              <p className="text-sm text-muted-foreground">{course.title}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Material: {quiz.student_file_name || 'Student material'}
                              </p>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                              In Class
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <FileCheck className="w-4 h-4" />
                              <span>{questionCount} Questions</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Clock className="w-4 h-4" />
                              <span>{quiz.mcq_count} MCQ, {quiz.short_answer_count} Short</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Calendar className="w-4 h-4" />
                              <span>{formatTimeAgo(quiz.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Eye className="w-4 h-4" />
                              <span>{quiz.status}</span>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-4 border-t border-border">
                            <button
                              onClick={() => openInClassQuestions(quiz)}
                              className="flex-1 border border-gray-300 hover:bg-gray-50 text-foreground font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                              <FileText className="w-4 h-4" />
                              Questions Doc
                            </button>
                            <button
                              onClick={() => openInClassAnswers(quiz)}
                              className="flex-1 bg-brand-maroon hover:bg-brand-maroon-hover text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                              <FileCheck className="w-4 h-4" />
                              Answers Doc
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-card border border-border rounded-xl p-12 text-center">
                    <FileCheck className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No in-class quizzes available yet</p>
                  </div>
                )}
              </>
            )}

            {quizView === 'online' && (
              <>
                {onlineQuizError && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {onlineQuizError}
                  </div>
                )}
                {onlineQuizzes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {onlineQuizzes.map((quiz) => (
                      <StudentQuizCard
                        key={quiz.quiz_batch_id}
                        title={quiz.quiz_name}
                        courseName={`${course.course_number}: ${course.title}`}
                        instructorName={course.instructor_name}
                        questionCount={quiz.question_count}
                        totalMarks={quiz.total_marks}
                        duration={quiz.duration_minutes}
                        dueDate={quiz.due_at || quiz.available_at || new Date().toISOString()}
                        status={quiz.status}
                        onViewQuestions={() => {
                          router.push(`/student/course/${courseId}/quiz/${quiz.quiz_batch_id}`);
                        }}
                        onStartQuiz={quiz.status === 'available' ? () => {
                          router.push(`/student/course/${courseId}/quiz/${quiz.quiz_batch_id}`);
                        } : undefined}
                        onViewAttempt={
                          quiz.status === 'in_progress' || quiz.status === 'submitted' || quiz.status === 'grades_released'
                            ? () => router.push(`/student/course/${courseId}/quiz/${quiz.quiz_batch_id}`)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="bg-card border border-border rounded-xl p-12 text-center">
                    <FileCheck className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No online quizzes available yet</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'assignments' && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-6">Course Assignments</h2>
            {assignmentSystemMissing && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {getAssignmentSystemMissingMessage()}
              </div>
            )}
            {studentAssignments.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {studentAssignments.map((assignment) => {
                  const cardStatus = getStudentAssignmentCardStatus(assignment);

                  return (
                  <StudentAssignmentCard
                    key={assignment.id}
                    label={assignment.assignment_label}
                    title={assignment.assignment_title}
                    courseName={course.title}
                    instructorName={course.instructor_name}
                    dueDate={assignment.due_at}
                    totalMarks={assignment.points_possible}
                    status={cardStatus}
                    submittedAt={assignment.submitted_at}
                    gradeScore={assignment.grade_score}
                    isSocratic={assignment.experience_type === 'socratic_writing'}
                    onViewAssignment={() => {
                      router.push(`/student/course/${courseId}/assignment/${assignment.id}`);
                    }}
                    onSubmitWork={cardStatus === 'pending' ? () => {
                      router.push(`/student/course/${courseId}/assignment/${assignment.id}`);
                    } : undefined}
                    onViewSubmission={cardStatus !== 'pending' ? () => {
                      router.push(`/student/course/${courseId}/assignment/${assignment.id}`);
                    } : undefined}
                  />
                  );
                })}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <ClipboardList className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No assignments available yet</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'overview' && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-6">Course Overview</h2>
            <StudentPerformanceSummary
              totalQuizzes={assignmentSummaryData.totalQuizzes}
              totalAssignments={assignmentSummaryData.totalAssignments}
              totalLectures={assignmentSummaryData.totalLectures}
              performanceItems={assignmentSummaryData.performanceItems}
            />
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <CheckSquare className="w-5 h-5" />
                Context Sources
              </h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={contextSources.syllabus}
                    onChange={(e) => setContextSources({ ...contextSources, syllabus: e.target.checked })}
                    className="w-5 h-5 rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                  />
                  <span className="text-foreground">Course Syllabus</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={contextSources.courseMaterials}
                    onChange={(e) => setContextSources({ ...contextSources, courseMaterials: e.target.checked })}
                    className="w-5 h-5 rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                  />
                  <span className="text-foreground">Course Materials</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={contextSources.studentUploads}
                    onChange={(e) => setContextSources({ ...contextSources, studentUploads: e.target.checked })}
                    className="w-5 h-5 rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                  />
                  <span className="text-foreground">My Uploaded Documents ({uploads.length})</span>
                </label>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload Document
              </h3>
              <label className="block">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-yellow file:text-brand-maroon hover:file:bg-brand-yellow-hover cursor-pointer"
                  accept=".pdf,.doc,.docx,.txt"
                />
              </label>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-foreground mb-4">Generate Content</h3>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What would you like to learn about?"
                  className="w-full px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-background text-foreground min-h-[120px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Video Length (minutes)
                </label>
                <select
                  value={videoLength}
                  onChange={(e) => setVideoLength(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-background text-foreground"
                >
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={20}>20 minutes</option>
                  <option value={30}>30 minutes</option>
                </select>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={handleGenerateLecture}
                  disabled={!prompt.trim() || generating}
                  className="flex-1 bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Video className="w-5 h-5" />
                  {generating ? 'Generating...' : 'Generate Video Lecture'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'uploads' && (
          <div>
            {uploads.length > 0 ? (
              <div className="space-y-3">
                {uploads.map((upload) => (
                  <div
                    key={upload.id}
                    className="bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-brand-yellow/10 p-3 rounded-lg">
                        <FileText className="w-6 h-6 text-brand-maroon" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">{upload.file_name}</h4>
                        <p className="text-sm text-muted-foreground">
                          {formatFileSize(upload.file_size)} • {formatTimeAgo(upload.created_at)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteUpload(upload.id)}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <Upload className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">No uploaded documents yet</p>
                <button
                  onClick={() => setActiveTab('chat')}
                  className="bg-brand-maroon hover:bg-brand-maroon-hover text-white px-6 py-2 rounded-lg transition-colors"
                >
                  Upload Your First Document
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </StudentLayout>
  );
}
