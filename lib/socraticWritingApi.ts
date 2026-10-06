import { getBackendBase } from '@/lib/backend';
import {
  SocraticFinalQuizState,
  SocraticReviewState,
  SocraticStageKey,
  SocraticStudioBlueprint,
  SocraticStudioSession,
} from '@/lib/socraticWriting';
import { supabase } from '@/lib/supabase';

const backendBase = getBackendBase();

export type SocraticWorkspacePayload = {
  assignment: {
    id: string;
    courseId: string;
    courseCode: string;
    courseTitle: string;
    assignmentTitle: string;
    assignmentBrief: string;
    dueAt: string | null;
    pointsPossible: number;
    experienceType: string;
    status: string;
  };
  blueprint: SocraticStudioBlueprint;
  workspaceId: string;
  courseStudentId: string;
  readOnly: boolean;
  session: SocraticStudioSession;
  review: SocraticReviewState;
  finalQuiz: SocraticFinalQuizState;
};

export type SocraticReviewStudent = {
  workspaceId: string;
  courseStudentId: string;
  studentId: string | null;
  studentName: string;
  studentEmail: string | null;
  status: string;
  submittedAt: string | null;
  stageStatuses: SocraticStudioSession['stageStatuses'];
  essayHtml: string;
  essayJson: string;
  notes: SocraticStudioSession['notes'];
  ledger: SocraticStudioSession['ledger'];
  buildArtifacts: SocraticStudioSession['buildArtifacts'];
  review: SocraticReviewState;
  finalQuiz?: SocraticFinalQuizState;
  resources: Array<{
    id: string;
    type: string;
    title: string;
    summary: string;
    required: boolean;
    url?: string | null;
    storageBucket?: string | null;
    storagePath?: string | null;
    progress: {
      opened: boolean;
      completed: boolean;
      manuallyReviewed: boolean;
    };
  }>;
};

export type SocraticReviewPayload = {
  assignment: SocraticWorkspacePayload['assignment'];
  blueprint: SocraticStudioBlueprint;
  students: SocraticReviewStudent[];
};

export type SocraticConfigPayload = {
  assignment: Record<string, unknown>;
  blueprint: SocraticStudioBlueprint;
  availableResources: {
    readings: Array<{
      id: string;
      title: string;
      summary: string;
      url?: string | null;
      storageBucket?: string | null;
      storagePath?: string | null;
    }>;
    lectures: Array<{ id: string; title: string; summary: string }>;
    quizzes: Array<{ id: string; title: string; summary: string }>;
  };
};

const requireBackendBase = () => {
  if (!backendBase) {
    throw new Error('Backend base URL is not configured.');
  }
  return backendBase;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const AUTH_EXPIRED_PATTERNS = [
  'session from session_id claim in jwt does not exist',
  'invalid or expired token',
  'no active session found',
  'auth session missing',
  'invalid refresh token',
];

export const isSocraticAuthExpiredError = (error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((pattern) => message.includes(pattern));
};

const clearExpiredSocraticSession = async () => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    try {
      await supabase.auth.signOut();
    } catch {
      // The original request error is more useful than a failed cleanup attempt.
    }
  }
};

const getAccessToken = async () => {
  const retryDelays = [0, 150, 300, 600, 1000, 1500];
  let lastToken: string | undefined;

  for (const delay of retryDelays) {
    if (delay) {
      await wait(delay);
    }

    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null;
    try {
      const response = await supabase.auth.getSession();
      session = response.data.session;
    } catch (error) {
      if (isSocraticAuthExpiredError(error)) {
        await clearExpiredSocraticSession();
        throw new Error('Your login session expired. Please sign in again.');
      }
      throw error;
    }

    lastToken = session?.access_token;
    if (lastToken) {
      return lastToken;
    }
  }

  throw new Error('No active session found. Please refresh the page and sign in again if the problem continues.');
};

const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = await getAccessToken();
  const base = requireBackendBase();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      detail = typeof parsed.detail === 'string' ? parsed.detail.trim() : '';
    } catch {
      // Keep raw text when the body is not JSON.
    }
    if (isSocraticAuthExpiredError(detail)) {
      await clearExpiredSocraticSession();
      throw new Error('Your login session expired. Please sign in again.');
    }
    throw new Error(detail || `Request failed with status ${response.status}. Please try again.`);
  }

  return (await response.json()) as T;
};

export const fetchSocraticAssignmentConfig = async (assignmentId: string) =>
  apiRequest<SocraticConfigPayload>(`/api/socratic/assignment/${assignmentId}/config`);

export const saveSocraticAssignmentConfig = async (
  assignmentId: string,
  blueprint: SocraticStudioBlueprint,
) =>
  apiRequest<SocraticConfigPayload>(`/api/socratic/assignment/${assignmentId}/config`, {
    method: 'PUT',
    body: JSON.stringify({ blueprint }),
  });

export const generateSocraticStarterResponse = async (
  stage: SocraticStageKey,
  blueprint: SocraticStudioBlueprint,
  questionFile?: File | null,
) => {
  const token = await getAccessToken();
  const base = requireBackendBase();
  const formData = new FormData();
  formData.append('stage', stage);
  formData.append('blueprint', JSON.stringify(blueprint));
  if (questionFile) {
    formData.append('question_pdf', questionFile);
  }

  const response = await fetch(`${base}/api/socratic/assignment/starter-response`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      detail = parsed.detail || raw;
    } catch {
      // Keep raw text when the body is not JSON.
    }
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as { stage: SocraticStageKey; response: string };
};

export const generateSocraticReadinessQuestions = async (
  blueprint: SocraticStudioBlueprint,
  questionFile?: File | null,
  stage?: SocraticStageKey,
) => {
  const token = await getAccessToken();
  const base = requireBackendBase();
  const formData = new FormData();
  formData.append('blueprint', JSON.stringify(blueprint));
  if (stage) {
    formData.append('stage', stage);
  }
  if (questionFile) {
    formData.append('question_pdf', questionFile);
  }

  const response = await fetch(`${base}/api/socratic/assignment/readiness-questions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      detail = parsed.detail || raw;
    } catch {
      // Keep raw text when the body is not JSON.
    }
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as { stages: Record<SocraticStageKey, string[]> };
};

export const fetchStudentSocraticWorkspace = async (assignmentId: string) =>
  apiRequest<SocraticWorkspacePayload>(`/api/socratic/student/assignment/${assignmentId}/workspace`);

export const saveStudentSocraticWorkspace = async (
  workspaceId: string,
  session: SocraticStudioSession,
) =>
  apiRequest<SocraticWorkspacePayload>(`/api/socratic/student/workspace/${workspaceId}`, {
    method: 'PUT',
    body: JSON.stringify({ session }),
  });

export const sendSocraticCoachMessage = async (
  workspaceId: string,
  stage: string,
  input: string,
  draftExcerpt?: string,
  promptClientId?: string,
  replyClientId?: string,
) =>
  apiRequest<{
    reply: string;
    entries: SocraticStudioSession['ledger'];
  }>(`/api/socratic/student/workspace/${workspaceId}/coach`, {
    method: 'POST',
    body: JSON.stringify({ stage, input, draftExcerpt, promptClientId, replyClientId }),
  });

const SOCRATIC_COACH_ERROR = 'The AI tutor could not complete the response. Please try again.';
const SOCRATIC_COACH_TIMEOUT_MS = 105_000;

const readSocraticCoachStream = async (
  response: Response,
  handlers: {
    onDelta: (chunk: string) => void;
    onDone: (payload: { reply: string; entries: SocraticStudioSession['ledger'] }) => void;
    onError: (message: string) => void;
  },
) => {
  if (!response.ok || !response.body) {
    const raw = await response.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      detail = parsed.detail || raw;
    } catch {
      // Keep raw text when the body is not JSON.
    }
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminalEventReceived = false;

  const processEvent = (block: string) => {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataParts: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataParts.push(line.slice(5).trim());
      }
    }
    if (!dataParts.length) return;
    const payload = JSON.parse(dataParts.join('\n')) as
      | { type: 'delta'; text: string }
      | { type: 'done'; reply: string; entries: SocraticStudioSession['ledger'] }
      | { type: 'error'; message?: string }
      | { type: 'heartbeat' };

    if (eventName === 'delta' && payload.type === 'delta') {
      handlers.onDelta(payload.text);
      return;
    }
    if (eventName === 'done' && payload.type === 'done') {
      terminalEventReceived = true;
      handlers.onDone({ reply: payload.reply, entries: payload.entries });
      return;
    }
    if (eventName === 'error' && payload.type === 'error') {
      terminalEventReceived = true;
      handlers.onError(payload.message?.trim() || SOCRATIC_COACH_ERROR);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitIndex = buffer.indexOf('\n\n');
    while (splitIndex !== -1) {
      const block = buffer.slice(0, splitIndex).trim();
      buffer = buffer.slice(splitIndex + 2);
      if (block) processEvent(block);
      splitIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  const finalBlock = buffer.trim();
  if (finalBlock) processEvent(finalBlock);
  if (!terminalEventReceived) {
    throw new Error('The AI tutor connection closed before the response completed. Please try again.');
  }
};

const fetchSocraticCoachStream = async (
  url: string,
  token: string,
  body: Record<string, unknown>,
  handlers: {
    onDelta: (chunk: string) => void;
    onDone: (payload: { reply: string; entries: SocraticStudioSession['ledger'] }) => void;
    onError: (message: string) => void;
  },
) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SOCRATIC_COACH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    await readSocraticCoachStream(response, handlers);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The AI tutor did not complete the response in time. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

export const streamSocraticCoachMessage = async (
  workspaceId: string,
  stage: string,
  input: string,
  draftExcerpt: string | undefined,
  promptClientId: string,
  replyClientId: string,
  handlers: {
    onDelta: (chunk: string) => void;
    onDone: (payload: { reply: string; entries: SocraticStudioSession['ledger'] }) => void;
    onError: (message: string) => void;
  },
) => {
  const token = await getAccessToken();
  const base = requireBackendBase();
  await fetchSocraticCoachStream(
    `${base}/api/socratic/student/workspace/${workspaceId}/coach/stream`,
    token,
    { stage, input, draftExcerpt, promptClientId, replyClientId },
    handlers,
  );
};

export const streamSocraticPreviewCoachMessage = async (
  blueprint: SocraticStudioBlueprint,
  session: SocraticStudioSession,
  stage: string,
  input: string,
  draftExcerpt: string | undefined,
  promptClientId: string,
  replyClientId: string,
  handlers: {
    onDelta: (chunk: string) => void;
    onDone: (payload: { reply: string; entries: SocraticStudioSession['ledger'] }) => void;
    onError: (message: string) => void;
  },
) => {
  const token = await getAccessToken();
  const base = requireBackendBase();
  await fetchSocraticCoachStream(
    `${base}/api/socratic/educator/preview/coach/stream`,
    token,
    {
      blueprint,
      session,
      stage,
      input,
      draftExcerpt,
      promptClientId,
      replyClientId,
    },
    handlers,
  );
};

export const submitSocraticWorkspace = async (workspaceId: string) =>
  apiRequest<SocraticWorkspacePayload>(`/api/socratic/student/workspace/${workspaceId}/submit`, {
    method: 'POST',
  });

export const prepareSocraticFinalQuiz = async (
  workspaceId: string,
  session?: SocraticStudioSession,
) =>
  apiRequest<SocraticWorkspacePayload>(`/api/socratic/student/workspace/${workspaceId}/final-quiz/prepare`, {
    method: 'POST',
    body: session ? JSON.stringify({ session }) : undefined,
  });

export const fetchSocraticAssignmentReview = async (assignmentId: string) =>
  apiRequest<SocraticReviewPayload>(`/api/socratic/educator/assignment/${assignmentId}/review`);

export const gradeSocraticWorkspace = async (
  workspaceId: string,
  score: number | null,
  feedback: string,
) =>
  apiRequest<{
    workspaceId: string;
    score: number | null;
    feedback: string | null;
    gradedAt: string;
  }>(`/api/socratic/educator/workspace/${workspaceId}/grade`, {
    method: 'POST',
    body: JSON.stringify({ score, feedback }),
  });
