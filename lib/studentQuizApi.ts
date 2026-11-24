import { getBackendBase } from '@/lib/backend';
import { supabase } from '@/lib/supabase';


export type StudentQuizMaterial = {
  key: string;
  name: string;
  type: string;
};

export type StudentQuizCourse = {
  id: string;
  courseNumber: string;
  title: string;
  semester: string;
  instructorName: string;
  materials: StudentQuizMaterial[];
};

export type StudentPrivateQuizSummary = {
  id: string;
  quizName: string;
  status: 'generated' | 'archived';
  courseId: string;
  courseNumber: string;
  courseTitle: string;
  mcqCount: number;
  shortAnswerCount: number;
  questionCount: number;
  sourceSummary: Array<{ type: string; name: string }>;
  lastScorePercent: number | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  private: true;
};

export type StudentPrivateQuizDetail = StudentPrivateQuizSummary & {
  quiz: {
    mcq: Array<{
      question: string;
      options: Record<'A' | 'B' | 'C' | 'D', string>;
    }>;
    short_answer: Array<{ question: string }>;
  };
  attempts: Array<{
    id: string;
    attemptNumber: number;
    correctCount: number;
    totalScoredQuestions: number;
    scorePercent: number | null;
    createdAt: string;
  }>;
  latestAttempt: {
    id: string;
    attemptNumber: number;
    submittedAnswers: {
      mcq?: Record<string, string>;
      shortAnswer?: Record<string, string>;
    };
    result: StudentQuizResult;
    submittedAt: string;
  } | null;
};

export type StudentQuizResult = {
  attemptId: string;
  attemptNumber: number;
  correctCount: number;
  mcqTotal?: number;
  shortAnswerTotal?: number;
  totalScoredQuestions: number;
  scorePercent: number | null;
  scoreNote: string;
  overallFeedback?: string;
  evaluationModel?: string;
  evaluationFallback?: boolean;
  mcq: Array<{
    questionIndex: number;
    submitted: string | null;
    correct: string;
    isCorrect: boolean;
    explanation: string;
  }>;
  shortAnswer: Array<{
    questionIndex: number;
    submitted: string;
    modelAnswer: string;
    scorePercent?: number | null;
    rating?: 'correct' | 'partially_correct' | 'incorrect' | 'not_evaluated';
    feedback?: string;
  }>;
};

export type GenerateStudentQuizInput = {
  courseId: string;
  quizName: string;
  mcqCount: number;
  shortAnswerCount: number;
  fixedAnswerKeyEnabled: boolean;
  fixedAnswerKey: string[];
  additionalInstructions: string;
  pastedText: string;
  materialKeys: string[];
  files: File[];
};


async function authorizationHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

async function responsePayload<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const payload = await response.json().catch(() => null) as { detail?: string } | null;
  throw new Error(payload?.detail || `Request failed (${response.status})`);
}

export async function loadStudentQuizContext(): Promise<{ courses: StudentQuizCourse[] }> {
  const headers = await authorizationHeader();
  const response = await fetch(`${getBackendBase()}/api/student/private-quizzes/context`, {
    headers,
    cache: 'no-store',
  });
  return responsePayload(response);
}

export async function listStudentPrivateQuizzes(
  limit = 100,
  courseId?: string,
): Promise<StudentPrivateQuizSummary[]> {
  const headers = await authorizationHeader();
  const query = new URLSearchParams({ limit: String(limit) });
  if (courseId) query.set('courseId', courseId);
  const response = await fetch(
    `${getBackendBase()}/api/student/private-quizzes?${query.toString()}`,
    { headers, cache: 'no-store' },
  );
  const payload = await responsePayload<{ quizzes: StudentPrivateQuizSummary[] }>(response);
  return payload.quizzes;
}

export async function getStudentPrivateQuiz(quizId: string): Promise<StudentPrivateQuizDetail> {
  const headers = await authorizationHeader();
  const response = await fetch(
    `${getBackendBase()}/api/student/private-quizzes/${encodeURIComponent(quizId)}`,
    { headers, cache: 'no-store' },
  );
  return responsePayload(response);
}

export async function generateStudentPrivateQuiz(
  input: GenerateStudentQuizInput,
): Promise<StudentPrivateQuizDetail> {
  const headers = await authorizationHeader();
  const body = new FormData();
  body.append('courseId', input.courseId);
  body.append('quizName', input.quizName);
  body.append('mcqCount', String(input.mcqCount));
  body.append('shortAnswerCount', String(input.shortAnswerCount));
  body.append('fixedAnswerKeyEnabled', String(input.fixedAnswerKeyEnabled));
  body.append('fixedAnswerKey', JSON.stringify(input.fixedAnswerKey));
  body.append('additionalInstructions', input.additionalInstructions);
  body.append('pastedText', input.pastedText);
  body.append('materialKeys', JSON.stringify(input.materialKeys));
  input.files.forEach((file) => body.append('files', file));
  const response = await fetch(`${getBackendBase()}/api/student/private-quizzes/generate`, {
    method: 'POST',
    headers,
    body,
  });
  return responsePayload(response);
}

export async function submitStudentPrivateQuiz(
  quizId: string,
  mcqAnswers: Record<string, string>,
  shortAnswers: Record<string, string>,
): Promise<StudentQuizResult> {
  const headers = await authorizationHeader();
  const response = await fetch(
    `${getBackendBase()}/api/student/private-quizzes/${encodeURIComponent(quizId)}/submit`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcqAnswers, shortAnswers }),
    },
  );
  return responsePayload(response);
}

export async function deleteStudentPrivateQuiz(quizId: string): Promise<void> {
  const headers = await authorizationHeader();
  const response = await fetch(
    `${getBackendBase()}/api/student/private-quizzes/${encodeURIComponent(quizId)}`,
    { method: 'DELETE', headers },
  );
  await responsePayload<{ deleted: boolean }>(response);
}

