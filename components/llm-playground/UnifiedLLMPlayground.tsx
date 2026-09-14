'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Bot,
  BrainCircuit,
  ChevronDown,
  Clock3,
  GitCompareArrows,
  History,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import EducatorLayout from '@/components/EducatorLayout';
import StudentLayout from '@/components/StudentLayout';
import GenerationSettings from '@/components/GenerationSettings';
import Markdown from '@/components/Markdown';
import { ModelOutputExpandModal } from '@/components/ModelOutputExpandModal';
import { getBackendBase } from '@/lib/backend';
import { supabase, type Profile } from '@/lib/supabase';

type UserRole = 'educator' | 'student';
type RunMode = 'single' | 'compare' | 'single-judge' | 'multi-judge' | 'synthesis';
type JudgeMode = 'single' | 'multi';

type ModelDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  provider: string;
  accent: string;
  tint: string;
  hoverTint: string;
};

type Conversation = {
  id: string;
  title: string;
  userRole: UserRole;
  activeMode: RunMode;
  activeModelId?: string | null;
  settings?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
};

type ModelOutput = {
  id: string;
  runId: string;
  modelId: string;
  text: string;
  latencyMs: number;
  error?: string | null;
  structured?: Record<string, unknown> | null;
  createdAt?: string;
};

type Judgement = {
  id: string;
  runId: string;
  judgeModelId?: string | null;
  type: string;
  text: string;
  structured?: Record<string, unknown> | null;
  createdAt?: string;
};

type PlaygroundRun = {
  id: string;
  conversationId: string;
  targetRunId?: string | null;
  mode: RunMode;
  prompt: string;
  requestSettings?: Record<string, unknown>;
  status: 'running' | 'succeeded' | 'failed';
  error?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  completedAt?: string | null;
  outputs: ModelOutput[];
  judgements: Judgement[];
};

type ConversationDetail = {
  conversation: Conversation;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    mode?: RunMode;
    modelId?: string | null;
    runId?: string | null;
    metadata?: Record<string, unknown>;
    createdAt?: string;
    turnIndex?: number;
  }>;
  runs: PlaygroundRun[];
};

type StreamPayload = Record<string, unknown>;

class PlaygroundApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PlaygroundApiError';
    this.status = status;
  }
}

type MultiJudgeAssessment = {
  targetModelId: string;
  risk_score: number;
  risk_label: string;
  failure_modes: string[];
  evidence: string[];
  notes: string;
  latencyMs?: number;
  error?: string | null;
};

const MODELS: ModelDefinition[] = [
  {
    id: 'gpt-5.2-chat',
    label: 'OpenAI gpt-5.2-chat',
    shortLabel: 'GPT 5.2',
    provider: 'OpenAI',
    accent: '#eab308',
    tint: 'bg-amber-50 border-amber-200',
    hoverTint: 'hover:border-amber-300 hover:bg-amber-100/70',
  },
  {
    id: 'gpt-5.6-terra',
    label: 'OpenAI GPT-5.6 Terra',
    shortLabel: 'GPT-5.6 Terra',
    provider: 'Azure OpenAI',
    accent: '#0f766e',
    tint: 'bg-teal-50 border-teal-200',
    hoverTint: 'hover:border-teal-300 hover:bg-teal-100/70',
  },
  {
    id: 'gpt-5.6-luna',
    label: 'OpenAI GPT-5.6 Luna',
    shortLabel: 'GPT-5.6 Luna',
    provider: 'Azure OpenAI',
    accent: '#f97316',
    tint: 'bg-orange-50 border-orange-200',
    hoverTint: 'hover:border-orange-300 hover:bg-orange-100/70',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Google Gemini 2.5 Flash',
    shortLabel: 'Gemini 2.5 Flash',
    provider: 'Google',
    accent: '#3b82f6',
    tint: 'bg-blue-50 border-blue-200',
    hoverTint: 'hover:border-blue-300 hover:bg-blue-100/70',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Google Gemini 3.8 Flash',
    shortLabel: 'Gemini 3.8 Flash',
    provider: 'Google',
    accent: '#2563eb',
    tint: 'bg-blue-50 border-blue-200',
    hoverTint: 'hover:border-blue-300 hover:bg-blue-100/70',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Google Gemini 3.5 Flash-Lite',
    shortLabel: 'Gemini 3.5 Flash-Lite',
    provider: 'Google',
    accent: '#0891b2',
    tint: 'bg-cyan-50 border-cyan-200',
    hoverTint: 'hover:border-cyan-300 hover:bg-cyan-100/70',
  },
  {
    id: 'claude-opus-4.5',
    label: 'Claude Opus 4.5',
    shortLabel: 'Opus 4.5',
    provider: 'Anthropic',
    accent: '#8b5cf6',
    tint: 'bg-violet-50 border-violet-200',
    hoverTint: 'hover:border-violet-300 hover:bg-violet-100/70',
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    shortLabel: 'Sonnet 5',
    provider: 'Anthropic',
    accent: '#d97706',
    tint: 'bg-amber-50 border-amber-200',
    hoverTint: 'hover:border-amber-300 hover:bg-amber-100/70',
  },
  {
    id: 'claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    shortLabel: 'Haiku 4.5',
    provider: 'Anthropic',
    accent: '#db2777',
    tint: 'bg-pink-50 border-pink-200',
    hoverTint: 'hover:border-pink-300 hover:bg-pink-100/70',
  },
];

const DEFAULT_AVAILABLE_MODEL_IDS = MODELS
  .filter((model) => model.id !== 'gpt-5.6-terra' && model.id !== 'gpt-5.6-luna')
  .map((model) => model.id);

const DEFAULT_SYNTHESIS_PROMPT =
  'Analyze the selected responses and synthesize one comprehensive, accurate answer. Highlight consensus, preserve useful differences, and resolve conflicts using the strongest supported reasoning.';

function modelDefinition(modelId?: string | null) {
  return MODELS.find((model) => model.id === modelId) || {
    id: modelId || 'unknown',
    label: modelId || 'Unknown model',
    shortLabel: modelId || 'Unknown',
    provider: 'Model',
    accent: '#64748b',
    tint: 'bg-slate-50 border-slate-200',
    hoverTint: 'hover:border-slate-300 hover:bg-slate-100/70',
  };
}

function readableError(payload: unknown, fallback: string) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const detail = record.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
  }
  return fallback;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeModelOutput(value: unknown, fallbackRunId: string): ModelOutput | null {
  const record = asRecord(value);
  if (!record) return null;
  const content = asRecord(record.content);
  const modelId = typeof record.modelId === 'string' ? record.modelId : '';
  if (!modelId) return null;
  const runId = typeof record.runId === 'string' ? record.runId : fallbackRunId;
  const text =
    typeof record.text === 'string'
      ? record.text
      : typeof content?.value === 'string'
        ? content.value
        : '';
  return {
    id: typeof record.id === 'string' ? record.id : `stream-${runId}-${modelId}`,
    runId,
    modelId,
    text,
    latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : 0,
    error: typeof record.error === 'string' ? record.error : null,
    structured: asRecord(record.structured),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
  };
}

function orderedModelOutputs(run: PlaygroundRun) {
  const modelIds = stringList(run.metadata?.modelIds);
  if (!modelIds.length) return run.outputs;
  const positions = new Map(modelIds.map((modelId, index) => [modelId, index]));
  return [...run.outputs].sort(
    (left, right) =>
      (positions.get(left.modelId) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(right.modelId) ?? Number.MAX_SAFE_INTEGER)
  );
}

function compactConversationTitle(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, ' ');
  if (!title) return 'New chat';
  return title.length > 60 ? `${title.slice(0, 57)}...` : title;
}

function riskLabel(score: number) {
  if (score <= 24) return 'LOW';
  if (score <= 49) return 'MEDIUM';
  if (score <= 74) return 'HIGH';
  return 'VERY HIGH';
}

function riskTone(label: string) {
  const normalized = label.replace('_', ' ').toUpperCase();
  if (normalized === 'LOW') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (normalized === 'MEDIUM') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (normalized === 'HIGH') return 'border-orange-200 bg-orange-50 text-orange-800';
  return 'border-red-200 bg-red-50 text-red-800';
}

function partialJsonString(raw: string, key: string) {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!match || match.index === undefined) return raw.trim();
  const start = match.index + match[0].length;
  let escaped = false;
  let value = '';
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      if (character === 'n') value += '\n';
      else if (character === 't') value += '\t';
      else value += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      break;
    } else {
      value += character;
    }
  }
  return value;
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatHistoryDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  return isToday
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function UnifiedLLMPlayground({ role }: { role: UserRole }) {
  const router = useRouter();
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const conversationLoadSequenceRef = useRef(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [deletingConversationId, setDeletingConversationId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [availableModelIds, setAvailableModelIds] = useState<string[]>(DEFAULT_AVAILABLE_MODEL_IDS);
  const [selectedResponseModels, setSelectedResponseModels] = useState<string[]>(['claude-opus-4.5']);
  const [selectedTargetRunId, setSelectedTargetRunId] = useState('');
  const [judgeMode, setJudgeMode] = useState<JudgeMode>('multi');
  const [judgeModels, setJudgeModels] = useState<string[]>([
    'claude-opus-4.5',
    'gpt-5.2-chat',
    'gemini-2.5-flash',
  ]);
  const [orchestratorModelId, setOrchestratorModelId] = useState('claude-opus-4.5');
  const [synthesisPrompt, setSynthesisPrompt] = useState(DEFAULT_SYNTHESIS_PROMPT);
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [includeSystemInstruction, setIncludeSystemInstruction] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [input, setInput] = useState('');
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [processing, setProcessing] = useState<'respond' | 'evaluate' | 'synthesize' | ''>('');
  const [error, setError] = useState('');
  const [modelsPanelCollapsed, setModelsPanelCollapsed] = useState(false);
  const [toolsPanelCollapsed, setToolsPanelCollapsed] = useState(false);
  const [expandedOutput, setExpandedOutput] = useState<ModelOutput | null>(null);

  const config = useMemo(
    () => ({
      temperature,
      maxTokens,
      includeSystemInstruction,
      systemPrompt,
    }),
    [temperature, maxTokens, includeSystemInstruction, systemPrompt]
  );

  const responseRuns = useMemo(
    () =>
      (detail?.runs || []).filter(
        (run) =>
          !run.targetRunId &&
          (run.metadata?.operationType === 'response' || run.mode === 'single' || run.mode === 'compare')
      ),
    [detail?.runs]
  );

  const operationsByTarget = useMemo(() => {
    const grouped: Record<string, PlaygroundRun[]> = {};
    for (const run of detail?.runs || []) {
      if (!run.targetRunId) continue;
      grouped[run.targetRunId] = [...(grouped[run.targetRunId] || []), run];
    }
    return grouped;
  }, [detail?.runs]);

  const selectedTarget = useMemo(
    () => responseRuns.find((run) => run.id === selectedTargetRunId) || null,
    [responseRuns, selectedTargetRunId]
  );

  const availableModels = useMemo(
    () => MODELS.filter((model) => availableModelIds.includes(model.id)),
    [availableModelIds]
  );

  const modelGroups = useMemo(
    () => [
      { label: 'OpenAI', models: availableModels.filter((model) => model.id.startsWith('gpt-')) },
      { label: 'Google', models: availableModels.filter((model) => model.id.startsWith('gemini-')) },
      { label: 'Anthropic', models: availableModels.filter((model) => model.id.startsWith('claude-')) },
    ].filter((group) => group.models.length > 0),
    [availableModels]
  );

  async function clearInvalidSession() {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Local auth storage may already be empty or invalid.
    }
    router.replace(`/${role}/login`);
  }

  async function getAccessToken() {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.access_token) {
      await clearInvalidSession();
      throw new Error('Your session expired. Please sign in again.');
    }
    return data.session.access_token;
  }

  async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getAccessToken();
    const response = await fetch(`${getBackendBase()}/api/llm-playground${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    const raw = await response.text();
    let payload: unknown = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }
    if (!response.ok) {
      throw new PlaygroundApiError(readableError(payload, `Request failed (${response.status}).`), response.status);
    }
    return payload as T;
  }

  async function streamRequest(
    path: string,
    body: Record<string, unknown>,
    onEvent: (event: string, payload: StreamPayload) => void
  ) {
    const token = await getAccessToken();
    const response = await fetch(`${getBackendBase()}/api/llm-playground${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const raw = await response.text();
      let payload: unknown = raw;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        // Keep the raw server error when it is not JSON.
      }
      throw new Error(readableError(payload, `Request failed (${response.status}).`));
    }
    if (!response.body) throw new Error('The server did not provide a response stream.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processBlock = (block: string) => {
      if (!block.trim()) return;
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) return;
      let payload: StreamPayload = {};
      try {
        payload = JSON.parse(data.join('\n')) as StreamPayload;
      } catch {
        payload = { message: data.join('\n') };
      }
      if (event === 'error') throw new Error(readableError(payload, 'The streaming request failed.'));
      onEvent(event, payload);
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        processBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    processBlock(buffer);
  }

  function handleStreamEvent(event: string, payload: StreamPayload) {
    if (event === 'complete') {
      const canonical = asRecord(payload.detail);
      if (canonical) applyDetail(canonical as unknown as ConversationDetail);
      return;
    }

    if (event === 'run_started') {
      const rawRun = asRecord(payload.run);
      if (!rawRun) return;
      const run = rawRun as unknown as PlaygroundRun;
      const metadata = run.metadata || {};
      const modelIds = stringList(metadata.modelIds);
      const judgeIds = stringList(metadata.judgeModelIds);
      const orchestratorId = typeof metadata.orchestratorModelId === 'string' ? metadata.orchestratorModelId : '';
      const transient: PlaygroundRun = {
        ...run,
        outputs:
          modelIds.length > 0
            ? modelIds.map((modelId) => ({
                id: `stream-${run.id}-${modelId}`,
                runId: run.id,
                modelId,
                text: '',
                latencyMs: 0,
              }))
            : orchestratorId
              ? [{ id: `stream-${run.id}-${orchestratorId}`, runId: run.id, modelId: orchestratorId, text: '', latencyMs: 0 }]
              : run.outputs || [],
        judgements: judgeIds.map((judgeModelId) => ({
          id: `stream-${run.id}-${judgeModelId}`,
          runId: run.id,
          judgeModelId,
          type: run.mode,
          text: '',
        })),
      };
      const isResponseRun =
        !transient.targetRunId && (transient.mode === 'single' || transient.mode === 'compare');
      setDetail((current) =>
        current
          ? {
              ...current,
              conversation:
                isResponseRun && current.conversation.title === 'New chat'
                  ? {
                      ...current.conversation,
                      title: compactConversationTitle(transient.prompt),
                      messageCount: (current.conversation.messageCount || 0) + 1,
                      updatedAt: new Date().toISOString(),
                    }
                  : current.conversation,
              runs: current.runs.some((item) => item.id === transient.id)
                ? current.runs.map((item) => (item.id === transient.id ? transient : item))
                : [...current.runs, transient],
            }
          : current
      );
      if (isResponseRun) {
        setSelectedTargetRunId(transient.id);
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === transient.conversationId && conversation.title === 'New chat'
              ? {
                  ...conversation,
                  title: compactConversationTitle(transient.prompt),
                  messageCount: (conversation.messageCount || 0) + 1,
                  updatedAt: new Date().toISOString(),
                }
              : conversation
          )
        );
      }
      requestAnimationFrame(() => timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
      return;
    }

    const runId = typeof payload.runId === 'string' ? payload.runId : '';
    if (!runId) return;
    setDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        runs: current.runs.map((run) => {
          if (run.id !== runId) return run;

          if (event === 'output_delta') {
            const modelId = typeof payload.modelId === 'string' ? payload.modelId : '';
            const text = typeof payload.text === 'string' ? payload.text : '';
            const exists = run.outputs.some((output) => output.modelId === modelId);
            const outputs = exists
              ? run.outputs.map((output) =>
                  output.modelId === modelId ? { ...output, text: `${output.text}${text}` } : output
                )
              : [...run.outputs, { id: `stream-${runId}-${modelId}`, runId, modelId, text, latencyMs: 0 }];
            return { ...run, outputs };
          }

          if (event === 'output_done') {
            const item = normalizeModelOutput(payload.item, runId);
            if (!item) return run;
            const outputs = run.outputs.some((output) => output.modelId === item.modelId)
              ? run.outputs.map((output) =>
                  output.modelId === item.modelId
                    ? { ...item, text: item.text || output.text }
                    : output
                )
              : [...run.outputs, item];
            return { ...run, outputs };
          }

          if (event === 'judgement_delta' || event === 'assessment_delta') {
            const judgeModelId = typeof payload.judgeModelId === 'string' ? payload.judgeModelId : '';
            const text = typeof payload.text === 'string' ? payload.text : '';
            const exists = run.judgements.some((judgement) => judgement.judgeModelId === judgeModelId);
            const judgements = exists
              ? run.judgements.map((judgement) =>
                  judgement.judgeModelId === judgeModelId
                    ? { ...judgement, text: `${judgement.text}${text}` }
                    : judgement
                )
              : [
                  ...run.judgements,
                  { id: `stream-${runId}-${judgeModelId}`, runId, judgeModelId, type: run.mode, text },
                ];
            return { ...run, judgements };
          }

          if (event === 'judgement_done') {
            const item = asRecord(payload.item) as unknown as Judgement | null;
            if (!item) return run;
            const judgements = run.judgements.some(
              (judgement) => judgement.judgeModelId === item.judgeModelId
            )
              ? run.judgements.map((judgement) =>
                  judgement.judgeModelId === item.judgeModelId ? item : judgement
                )
              : [...run.judgements, item];
            return { ...run, judgements };
          }

          return run;
        }),
      };
    });
  }

  async function loadConversationList() {
    setHistoryLoading(true);
    try {
      const result = await apiRequest<{ conversations: Conversation[] }>(`/conversations?userRole=${role}`);
      const rows = result.conversations || [];
      setConversations(rows);
      return rows;
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadAvailableModels() {
    const result = await apiRequest<{ modelIds?: string[] }>('/models');
    const knownIds = Array.isArray(result.modelIds)
      ? result.modelIds.filter((modelId) => MODELS.some((model) => model.id === modelId))
      : [];
    if (!knownIds.length) return;

    setAvailableModelIds(knownIds);
    setSelectedResponseModels((current) => {
      const filtered = current.filter((modelId) => knownIds.includes(modelId)).slice(0, 3);
      return filtered.length ? filtered : [knownIds[0]];
    });
    setJudgeModels((current) => {
      const filtered = current.filter((modelId) => knownIds.includes(modelId));
      const targetCount = judgeMode === 'single' ? 1 : Math.min(3, knownIds.length);
      for (const modelId of knownIds) {
        if (filtered.length >= targetCount) break;
        if (!filtered.includes(modelId)) filtered.push(modelId);
      }
      return filtered.slice(0, targetCount);
    });
    setOrchestratorModelId((current) => current && knownIds.includes(current) ? current : knownIds[0]);
  }

  function startNewChat() {
    conversationLoadSequenceRef.current += 1;
    setActiveConversationId('');
    setDetail(null);
    setSelectedTargetRunId('');
    setExpandedOutput(null);
    setHistoryOpen(false);
    setHistoryQuery('');
    setLoadingConversation(false);
    setInput('');
    setError('');
  }

  async function loadConversation(conversationId: string) {
    const loadSequence = conversationLoadSequenceRef.current + 1;
    conversationLoadSequenceRef.current = loadSequence;
    setActiveConversationId(conversationId);
    setDetail(null);
    setSelectedTargetRunId('');
    setHistoryOpen(false);
    setLoadingConversation(true);
    setError('');
    try {
      const nextDetail = await apiRequest<ConversationDetail>(`/conversations/${conversationId}`);
      if (conversationLoadSequenceRef.current !== loadSequence) return;
      applyDetail(nextDetail);
    } catch (requestError) {
      if (conversationLoadSequenceRef.current !== loadSequence) return;
      if (requestError instanceof PlaygroundApiError && requestError.status === 404) {
        setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
        startNewChat();
        setError('That conversation no longer exists. A new chat is ready.');
        return;
      }
      setError(requestError instanceof Error ? requestError.message : 'Unable to load the conversation.');
    } finally {
      if (conversationLoadSequenceRef.current === loadSequence) setLoadingConversation(false);
    }
  }

  function applyDetail(nextDetail: ConversationDetail) {
    setDetail(nextDetail);
    setActiveConversationId(nextDetail.conversation.id);
    const saved = nextDetail.conversation.settings || {};
    const savedModels = saved.responseModelIds;
    if (Array.isArray(savedModels) && savedModels.length) {
      const enabledSavedModels = savedModels
        .filter((item): item is string => typeof item === 'string' && availableModelIds.includes(item))
        .slice(0, 3);
      if (enabledSavedModels.length) setSelectedResponseModels(enabledSavedModels);
    }
    if (typeof saved.temperature === 'number') setTemperature(saved.temperature);
    if (typeof saved.maxTokens === 'number') setMaxTokens(saved.maxTokens);
    if (typeof saved.includeSystemInstruction === 'boolean') {
      setIncludeSystemInstruction(saved.includeSystemInstruction);
    }
    if (typeof saved.systemPrompt === 'string') setSystemPrompt(saved.systemPrompt);
    const availableTargets = nextDetail.runs.filter(
      (run) => !run.targetRunId && (run.mode === 'single' || run.mode === 'compare')
    );
    setSelectedTargetRunId((current) =>
      availableTargets.some((run) => run.id === current)
        ? current
        : availableTargets[availableTargets.length - 1]?.id || ''
    );
  }

  async function createConversationRecord() {
    const created = await apiRequest<ConversationDetail>('/conversations', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New chat',
        userRole: role,
        activeMode: 'single',
        activeModelId: selectedResponseModels[0],
        settings: { ...config, responseModelIds: selectedResponseModels },
      }),
    });
    applyDetail(created);
    setConversations((current) => [
      created.conversation,
      ...current.filter((conversation) => conversation.id !== created.conversation.id),
    ]);
    return created;
  }

  async function deleteConversation(conversationId = activeConversationId) {
    if (!conversationId || deletingConversationId || processing) return;
    const conversation = conversations.find((item) => item.id === conversationId);
    const title = conversation?.title || 'this conversation';
    if (!window.confirm(`Delete “${title}” and all of its saved responses?`)) return;
    setError('');
    setDeletingConversationId(conversationId);
    try {
      await apiRequest<{ ok: boolean }>(`/conversations/${conversationId}`, { method: 'DELETE' });
    } catch (requestError) {
      if (!(requestError instanceof PlaygroundApiError && requestError.status === 404)) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to delete the conversation.');
        return;
      }
    } finally {
      setDeletingConversationId('');
    }

    setConversations((current) => current.filter((item) => item.id !== conversationId));
    if (activeConversationId === conversationId) {
      startNewChat();
    }
  }

  async function sendMessage() {
    const prompt = input.trim();
    if (!prompt || processing) return;
    setInput('');
    setError('');
    setProcessing('respond');
    let runStarted = false;
    let conversationId = activeConversationId;
    try {
      if (!conversationId) {
        const created = await createConversationRecord();
        conversationId = created.conversation.id;
      }
      await streamRequest(
        `/conversations/${conversationId}/respond/stream`,
        { prompt, modelIds: selectedResponseModels, config },
        (event, payload) => {
          if (event === 'run_started') runStarted = true;
          handleStreamEvent(event, payload);
        }
      );
      void loadConversationList().catch(() => {
        // The completed response remains usable even if refreshing history fails.
      });
      requestAnimationFrame(() => timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (requestError) {
      if (!runStarted) setInput(prompt);
      if (runStarted && conversationId) await loadConversation(conversationId);
      setError(requestError instanceof Error ? requestError.message : 'The models could not answer.');
    } finally {
      setProcessing('');
    }
  }

  async function evaluateSelectedTurn() {
    if (!activeConversationId || !selectedTargetRunId || processing) return;
    const required = judgeMode === 'single' ? 1 : 2;
    if (judgeModels.length < required) {
      setError(judgeMode === 'single' ? 'Select one judge model.' : 'Select at least two judge models.');
      return;
    }
    setError('');
    setProcessing('evaluate');
    try {
      await streamRequest(
        `/conversations/${activeConversationId}/evaluate/stream`,
        {
          targetRunId: selectedTargetRunId,
          judgeMode,
          judgeModelIds: judgeMode === 'single' ? judgeModels.slice(0, 1) : judgeModels.slice(0, 3),
          config,
        },
        (event, payload) => {
          handleStreamEvent(event, payload);
        }
      );
    } catch (requestError) {
      await loadConversation(activeConversationId);
      setError(requestError instanceof Error ? requestError.message : 'Evaluation failed.');
    } finally {
      setProcessing('');
    }
  }

  async function synthesizeSelectedTurn() {
    if (!activeConversationId || !selectedTargetRunId || processing) return;
    setError('');
    setProcessing('synthesize');
    try {
      await streamRequest(
        `/conversations/${activeConversationId}/synthesize/stream`,
        {
          targetRunId: selectedTargetRunId,
          orchestratorModelId,
          customPrompt: synthesisPrompt,
          config,
        },
        (event, payload) => {
          handleStreamEvent(event, payload);
        }
      );
    } catch (requestError) {
      await loadConversation(activeConversationId);
      setError(requestError instanceof Error ? requestError.message : 'Synthesis failed.');
    } finally {
      setProcessing('');
    }
  }

  function toggleResponseModel(modelId: string) {
    setSelectedResponseModels((current) => {
      if (current.includes(modelId)) return current.length === 1 ? current : current.filter((id) => id !== modelId);
      if (current.length >= 3) return current;
      return [...current, modelId];
    });
  }

  function toggleJudgeModel(modelId: string) {
    setJudgeModels((current) => {
      if (current.includes(modelId)) return current.filter((id) => id !== modelId);
      const max = judgeMode === 'single' ? 1 : 3;
      return current.length >= max ? [...current.slice(1), modelId] : [...current, modelId];
    });
  }

  function changeJudgeMode(mode: JudgeMode) {
    setJudgeMode(mode);
    setJudgeModels((current) => {
      if (mode === 'single') return [current[0] || 'claude-opus-4.5'];
      const expanded = [...current];
      for (const model of availableModels) {
        if (expanded.length >= 3) break;
        if (!expanded.includes(model.id)) expanded.push(model.id);
      }
      return expanded;
    });
  }

  useEffect(() => {
    let active = true;
    async function authenticate() {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData.session?.user;
        if (!user) {
          router.replace(`/${role}/login`);
          return;
        }
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profileData || profileData.role !== role) {
          router.replace(`/${role}/login`);
          return;
        }
        if (!active) return;
        setProfile(profileData as Profile);
        setAuthLoading(false);
        void loadAvailableModels().catch(() => {
          // Keep the safe default catalog if availability cannot be refreshed.
        });
        void loadConversationList().catch((historyError) => {
          if (active) {
            setError(historyError instanceof Error ? historyError.message : 'Unable to load conversation history.');
          }
        });
      } catch (authError) {
        if (!active) return;
        const message = authError instanceof Error ? authError.message : 'Unable to open the playground.';
        if (/refresh token|session.*expired|invalid.*token/i.test(message)) {
          await clearInvalidSession();
          return;
        }
        setError(message);
        setAuthLoading(false);
      }
    }
    void authenticate();
    return () => {
      active = false;
    };
    // Authentication runs once per portal entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    if (!historyOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!historyMenuRef.current?.contains(event.target as Node)) setHistoryOpen(false);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [historyOpen]);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const responseModeLabel =
    selectedResponseModels.length === 1
      ? `Single Response - ${modelDefinition(selectedResponseModels[0]).shortLabel}`
      : `Compare Mode - ${selectedResponseModels.length} models selected`;
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const filteredConversations = historyQuery.trim()
    ? conversations.filter((conversation) =>
        conversation.title.toLowerCase().includes(historyQuery.trim().toLowerCase())
      )
    : conversations;

  const responsesFocused = modelsPanelCollapsed && toolsPanelCollapsed;
  const workspaceGridColumns = modelsPanelCollapsed
    ? toolsPanelCollapsed
      ? 'xl:grid-cols-[64px_minmax(0,1fr)_64px]'
      : 'xl:grid-cols-[64px_minmax(0,1fr)_300px] 2xl:grid-cols-[64px_minmax(0,1fr)_320px]'
    : toolsPanelCollapsed
      ? 'xl:grid-cols-[240px_minmax(0,1fr)_64px] 2xl:grid-cols-[260px_minmax(0,1fr)_64px]'
      : 'xl:grid-cols-[240px_minmax(0,1fr)_300px] 2xl:grid-cols-[260px_minmax(0,1fr)_320px]';

  const body = (
    <div className="-m-8 min-h-[calc(100vh-5rem)] bg-[#f4f5f7] p-5 lg:p-7">
      <section className="mx-auto max-w-[1680px] overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <header className="flex flex-col gap-4 bg-gradient-to-r from-[#850000] via-[#a90000] to-[#850000] px-6 py-5 text-white md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/12 p-2.5 ring-1 ring-white/20">
                <BrainCircuit className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">LLM Playground</h1>
                <p className="mt-0.5 text-sm text-white/75">{responseModeLabel}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-black/15 px-4 py-2 text-xs font-medium text-white/85 ring-1 ring-white/15">
            <History className="h-4 w-4" />
            One continuous, saved conversation
          </div>
        </header>

        {error && (
          <div className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div
          className={`grid min-h-[720px] grid-cols-1 transition-[grid-template-columns] duration-300 ease-out ${workspaceGridColumns}`}
        >
          <aside className="relative border-b border-slate-200 bg-slate-50/80 xl:border-b-0 xl:border-r">
            {!modelsPanelCollapsed && (
              <button
                type="button"
                onClick={() => setModelsPanelCollapsed(true)}
                title="Collapse model panel"
                aria-label="Collapse model panel"
                className="absolute -right-3 top-5 z-20 hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md transition hover:border-[#a90000] hover:text-[#a90000] xl:flex"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            )}

            {modelsPanelCollapsed && (
              <div className="hidden h-full min-h-[720px] flex-col items-center gap-3 py-4 xl:flex">
                <button
                  type="button"
                  onClick={() => setModelsPanelCollapsed(false)}
                  title="Expand model panel"
                  aria-label="Expand model panel"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-[#a90000] hover:bg-red-50 hover:text-[#a90000]"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
                <div className="h-px w-8 bg-slate-200" />
                <button
                  type="button"
                  onClick={startNewChat}
                  disabled={Boolean(processing)}
                  title="New chat"
                  aria-label="New chat"
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#a90000] text-white transition hover:bg-[#850000] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setModelsPanelCollapsed(false)}
                  title={`${selectedResponseModels.length} response models selected`}
                  aria-label="Expand response model selection"
                  className="relative flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-[#a90000]"
                >
                  <Bot className="h-5 w-5" />
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ffcc00] px-1 text-[9px] font-bold text-slate-900">
                    {selectedResponseModels.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModelsPanelCollapsed(false);
                    setHistoryOpen(true);
                  }}
                  title="Conversation history"
                  aria-label="Expand conversation history"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-[#a90000]"
                >
                  <History className="h-5 w-5" />
                </button>
              </div>
            )}

            <div className={`border-b border-slate-200 p-4 ${modelsPanelCollapsed ? 'xl:hidden' : ''}`}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={startNewChat}
                  disabled={Boolean(processing)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#a90000] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#850000] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  New Chat
                </button>
                <button
                  type="button"
                  onClick={() => void deleteConversation()}
                  disabled={!activeConversationId || Boolean(deletingConversationId) || Boolean(processing)}
                  title="Delete conversation"
                  className="flex w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                >
                  {deletingConversationId === activeConversationId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Conversation history
                </span>
                {historyLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : (
                  <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    {conversations.length}
                  </span>
                )}
              </div>
              <div ref={historyMenuRef} className="relative mt-2">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((current) => !current)}
                  aria-haspopup="listbox"
                  aria-expanded={historyOpen}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm outline-none transition hover:border-slate-300 focus:border-[#a90000] focus:ring-2 focus:ring-red-100"
                >
                  <History className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">
                      {activeConversation?.title || 'New chat'}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {activeConversation
                        ? `${activeConversation.messageCount || 0} messages · ${formatHistoryDate(activeConversation.updatedAt)}`
                        : 'Unsaved draft'}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-400 transition ${historyOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {historyOpen && (
                  <div
                    role="listbox"
                    aria-label="Saved conversations"
                    className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
                  >
                    <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Recent chats</span>
                    </div>
                    {conversations.length > 5 && (
                      <div className="relative border-b border-slate-100 p-2">
                        <Search className="pointer-events-none absolute left-4 top-4 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="search"
                          value={historyQuery}
                          onChange={(event) => setHistoryQuery(event.target.value)}
                          placeholder="Search chats"
                          aria-label="Search conversation history"
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#a90000] focus:bg-white"
                        />
                      </div>
                    )}
                    <div className="max-h-80 overflow-y-auto p-1.5">
                      {historyLoading && conversations.length === 0 ? (
                        <div className="space-y-2 p-2" aria-label="Loading conversation history">
                          {[0, 1, 2].map((item) => (
                            <div key={item} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                          ))}
                        </div>
                      ) : conversations.length === 0 ? (
                        <div className="px-3 py-6 text-center">
                          <MessageSquare className="mx-auto h-5 w-5 text-slate-300" />
                          <p className="mt-2 text-xs font-medium text-slate-600">No saved chats yet</p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-400">Your first message will save this draft.</p>
                        </div>
                      ) : filteredConversations.length === 0 ? (
                        <div className="px-3 py-6 text-center">
                          <Search className="mx-auto h-5 w-5 text-slate-300" />
                          <p className="mt-2 text-xs font-medium text-slate-600">No matching chats</p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-400">Try a different title.</p>
                        </div>
                      ) : (
                        filteredConversations.map((conversation) => {
                          const active = conversation.id === activeConversationId;
                          const deleting = deletingConversationId === conversation.id;
                          return (
                            <div
                              key={conversation.id}
                              className={`group flex items-center rounded-lg transition ${
                                active ? 'bg-red-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => void loadConversation(conversation.id)}
                                disabled={Boolean(processing) || Boolean(deletingConversationId)}
                                className="min-w-0 flex-1 px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className={`block truncate text-xs font-semibold ${active ? 'text-[#850000]' : 'text-slate-700'}`}>
                                  {conversation.title}
                                </span>
                                <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                                  <span>{conversation.messageCount || 0} messages</span>
                                  <span aria-hidden="true">•</span>
                                  <span>{formatHistoryDate(conversation.updatedAt)}</span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteConversation(conversation.id)}
                                disabled={Boolean(deletingConversationId) || Boolean(processing)}
                                title={`Delete ${conversation.title}`}
                                aria-label={`Delete ${conversation.title}`}
                                className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 opacity-0 transition hover:bg-red-100 hover:text-red-700 focus:opacity-100 disabled:opacity-50 group-hover:opacity-100"
                              >
                                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={`p-3 ${modelsPanelCollapsed ? 'xl:hidden' : ''}`}>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Response Models</h2>
                    <p className="mt-1 text-xs text-slate-400">Select up to 3 models</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {selectedResponseModels.length}/3
                  </span>
                </div>

                <div className="model-picker-scroll max-h-[520px] overflow-y-auto px-2.5 py-3">
                  {modelGroups.map((group, groupIndex) => (
                    <section key={group.label} className={groupIndex === 0 ? '' : 'mt-4'}>
                      <h3 className="px-1.5 text-xs font-medium text-slate-400">{group.label}</h3>
                      <div className="mt-1.5 space-y-0.5">
                        {group.models.map((model) => {
                          const selected = selectedResponseModels.includes(model.id);
                          return (
                            <button
                              type="button"
                              key={model.id}
                              onClick={() => toggleResponseModel(model.id)}
                              aria-pressed={selected}
                              title={`${selected ? 'Remove' : 'Select'} ${model.shortLabel}`}
                              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                                selected
                                  ? 'bg-[#b50000] font-semibold text-white shadow-sm hover:bg-[#960000]'
                                  : 'font-medium text-slate-700 hover:bg-red-50 hover:text-[#850000]'
                              }`}
                            >
                              <span
                                className={`h-2.5 w-2.5 shrink-0 rounded-full ${selected ? 'ring-2 ring-white/30' : ''}`}
                                style={{ backgroundColor: model.accent }}
                              />
                              <span className="min-w-0 flex-1 truncate">{model.shortLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] leading-4 text-slate-500">
                  Models share your prompts and continue from their own previous answers.
                </div>
              </div>
            </div>
          </aside>

          <main className="flex min-w-0 flex-col bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">
                  {detail?.conversation.title || 'New chat'}
                </p>
                <p className="text-xs text-slate-500">
                  {responseRuns.length} response {responseRuns.length === 1 ? 'turn' : 'turns'} saved
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedTarget && (
                  <span className="hidden rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 2xl:inline">
                    Turn selected for tools
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const collapsePanels = !responsesFocused;
                    setModelsPanelCollapsed(collapsePanels);
                    setToolsPanelCollapsed(collapsePanels);
                  }}
                  aria-pressed={responsesFocused}
                  title={responsesFocused ? 'Restore side panels' : 'Focus on responses'}
                  className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-[#a90000] hover:text-[#a90000] xl:inline-flex"
                >
                  {responsesFocused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {responsesFocused ? 'Show panels' : 'Focus responses'}
                </button>
              </div>
            </div>

            <div className="h-[620px] overflow-y-auto bg-[radial-gradient(circle_at_top,#f8fafc_0,white_42%)] px-3 py-6 sm:px-4 2xl:px-5">
              {loadingConversation ? (
                <div className="flex h-full items-center justify-center text-slate-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading conversation...
                </div>
              ) : responseRuns.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="max-w-md text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-[#a90000]">
                      <MessageSquare className="h-8 w-8" />
                    </div>
                    <h2 className="mt-5 text-xl font-semibold text-slate-900">Start a Conversation</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Ask one model or compare several. Later, evaluate or synthesize any response without leaving this chat.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  {responseRuns.map((run, index) => {
                    const selected = run.id === selectedTargetRunId;
                    const attachedOperations = operationsByTarget[run.id] || [];
                    const outputs = orderedModelOutputs(run);
                    return (
                      <article
                        key={run.id}
                        className={`rounded-3xl border p-3 transition 2xl:p-4 ${
                          selected ? 'border-amber-300 bg-amber-50/35' : 'border-transparent'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedTargetRunId(run.id)}
                          className="ml-auto flex w-fit max-w-3xl items-start gap-3 text-left"
                        >
                          <div className="rounded-2xl rounded-tr-sm bg-[#a90000] px-4 py-3 text-sm leading-6 text-white shadow-sm">
                            {run.prompt}
                          </div>
                          <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffcc00] text-xs font-bold text-slate-900">
                            {profile?.first_name?.slice(0, 1) || 'U'}
                          </span>
                        </button>

                        <div
                          className={`mt-4 grid items-start gap-3 ${
                            outputs.length === 1
                              ? 'mx-auto max-w-3xl grid-cols-1'
                              : outputs.length === 2
                                ? 'md:grid-cols-2'
                                : 'lg:grid-cols-3'
                          }`}
                        >
                          {outputs.map((output) => {
                            const model = modelDefinition(output.modelId);
                            const outputStreaming = run.status === 'running' && output.latencyMs === 0 && !output.error;
                            const previewTruncated = output.text.length > 700;
                            return (
                              <div
                                key={`${run.id}-${output.modelId}`}
                                role="button"
                                tabIndex={0}
                                aria-haspopup="dialog"
                                aria-label={`Open the full ${model.shortLabel} response`}
                                title="Click to read the full response"
                                onClick={(event) => {
                                  const target = event.target as HTMLElement;
                                  if (target.closest('a, button, input, textarea, select')) return;
                                  setExpandedOutput(output);
                                }}
                                onKeyDown={(event) => {
                                  if (event.target !== event.currentTarget) return;
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setExpandedOutput(output);
                                  }
                                }}
                                className={`group min-w-0 cursor-zoom-in rounded-2xl border bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#a90000]/30 focus:ring-offset-2 ${model.tint} ${model.hoverTint}`}
                              >
                                <div className="mb-3 flex items-center justify-between gap-3 border-b border-black/5 pb-3">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: model.accent }} />
                                    <span className="truncate text-sm font-semibold text-slate-900">{model.shortLabel}</span>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                      {outputStreaming ? (
                                        <>
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                          Streaming
                                        </>
                                      ) : (
                                        <>
                                          <Clock3 className="h-3 w-3" />
                                          {(output.latencyMs / 1000).toFixed(1)}s
                                        </>
                                      )}
                                    </span>
                                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80 text-slate-400 opacity-60 transition group-hover:text-[#a90000] group-hover:opacity-100 group-focus:text-[#a90000] group-focus:opacity-100">
                                      <Maximize2 className="h-3.5 w-3.5" />
                                    </span>
                                  </div>
                                </div>
                                {output.error ? (
                                  <p className="text-sm text-red-700">{output.error}</p>
                                ) : !output.text && outputStreaming ? (
                                  <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Waiting for {model.shortLabel}...
                                  </div>
                                ) : !output.text ? (
                                  <p className="py-2 text-sm text-slate-500">No response content was returned.</p>
                                ) : (
                                  <div className="min-w-0">
                                    <div className="relative min-w-0">
                                      <div className="max-h-[360px] min-w-0 overflow-hidden [&_.markdown-table-scroll]:overflow-hidden">
                                        <Markdown value={output.text} />
                                        {outputStreaming && (
                                          <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-current align-middle" />
                                        )}
                                      </div>
                                      {previewTruncated && (
                                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/90 to-transparent" />
                                      )}
                                    </div>
                                    {output.text && (
                                      <div className="mt-3 flex items-center justify-center gap-1.5 border-t border-black/5 pt-3 text-[11px] font-semibold text-slate-500 transition group-hover:text-[#a90000]">
                                        <Maximize2 className="h-3 w-3" />
                                        Open full response
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {run.status === 'failed' && run.error && (
                          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {run.error}
                          </div>
                        )}

                        {attachedOperations.map((operation) => (
                          <OperationResult key={operation.id} run={operation} />
                        ))}

                        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                          <span>Turn {index + 1}</span>
                          <span>{formatDate(run.createdAt)}</span>
                        </div>
                      </article>
                    );
                  })}
                  <div ref={timelineEndRef} />
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 bg-white p-4 md:p-5">
              <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-2 shadow-inner focus-within:border-[#a90000] focus-within:bg-white">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  rows={2}
                  placeholder={`Ask ${selectedResponseModels.length === 1 ? modelDefinition(selectedResponseModels[0]).shortLabel : 'the selected models'} anything...`}
                  className="max-h-40 min-h-[52px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || Boolean(processing)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#a90000] text-white transition hover:bg-[#850000] disabled:bg-red-300"
                >
                  {processing === 'respond' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-slate-400">Enter to send. Shift+Enter for a new line.</p>
            </div>
          </main>

          <aside className="relative border-t border-slate-200 bg-slate-50/70 xl:border-l xl:border-t-0">
            {!toolsPanelCollapsed && (
              <button
                type="button"
                onClick={() => setToolsPanelCollapsed(true)}
                title="Collapse tools panel"
                aria-label="Collapse tools panel"
                className="absolute -left-3 top-5 z-20 hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md transition hover:border-[#a90000] hover:text-[#a90000] xl:flex"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            )}

            {toolsPanelCollapsed && (
              <div className="hidden h-full min-h-[720px] flex-col items-center gap-3 py-4 xl:flex">
                <button
                  type="button"
                  onClick={() => setToolsPanelCollapsed(false)}
                  title="Expand tools panel"
                  aria-label="Expand tools panel"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-[#a90000] hover:bg-red-50 hover:text-[#a90000]"
                >
                  <PanelRightOpen className="h-4 w-4" />
                </button>
                <div className="h-px w-8 bg-slate-200" />
                <button
                  type="button"
                  onClick={() => setToolsPanelCollapsed(false)}
                  title="Evaluate responses"
                  aria-label="Expand evaluation tools"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-[#a90000] transition hover:bg-white"
                >
                  <ShieldCheck className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setToolsPanelCollapsed(false)}
                  title="Synthesize responses"
                  aria-label="Expand synthesis tools"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-amber-600 transition hover:bg-white"
                >
                  <Sparkles className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setToolsPanelCollapsed(false)}
                  title="Advanced settings"
                  aria-label="Expand advanced settings"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-[#a90000]"
                >
                  <Settings2 className="h-5 w-5" />
                </button>
              </div>
            )}

            <div className={`border-b border-slate-200 p-4 ${toolsPanelCollapsed ? 'xl:hidden' : ''}`}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#a90000]" />
                <div>
                  <h2 className="font-semibold text-slate-900">Evaluate Responses</h2>
                  <p className="text-xs text-slate-500">Judge quality, support, and risk.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-200/70 p-1">
                <button
                  type="button"
                  onClick={() => changeJudgeMode('multi')}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ${judgeMode === 'multi' ? 'bg-white text-[#a90000] shadow-sm' : 'text-slate-500'}`}
                >
                  Multi-Judge
                </button>
                <button
                  type="button"
                  onClick={() => changeJudgeMode('single')}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ${judgeMode === 'single' ? 'bg-white text-[#a90000] shadow-sm' : 'text-slate-500'}`}
                >
                  Single Judge
                </button>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#a90000]" />
                    Judge models
                  </span>
                  <span className="text-[10px] text-slate-500">Evaluator role</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableModels.map((model) => {
                    const selected = judgeModels.includes(model.id);
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => toggleJudgeModel(model.id)}
                        title={`${model.shortLabel} will act as a judge`}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                          selected ? 'border-[#a90000] bg-red-50 text-[#850000]' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: model.accent }} />
                        {model.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void evaluateSelectedTurn()}
                disabled={!selectedTargetRunId || Boolean(processing)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#a90000] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#850000] disabled:bg-slate-300"
              >
                {processing === 'evaluate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Run Evaluation
              </button>
            </div>

            <div className={`border-b border-slate-200 p-4 ${toolsPanelCollapsed ? 'xl:hidden' : ''}`}>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-600" />
                <div>
                  <h2 className="font-semibold text-slate-900">Synthesize</h2>
                  <p className="text-xs text-slate-500">Orchestrate the selected responses.</p>
                </div>
              </div>
              <label className="mt-4 block text-xs font-semibold text-slate-700">Orchestrator model</label>
              <select
                value={orchestratorModelId}
                onChange={(event) => setOrchestratorModelId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a90000]"
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
              <label className="mt-4 block text-xs font-semibold text-slate-700">Custom prompt</label>
              <textarea
                value={synthesisPrompt}
                onChange={(event) => setSynthesisPrompt(event.target.value)}
                rows={5}
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm leading-5 outline-none focus:border-[#a90000]"
              />
              <button
                type="button"
                onClick={() => void synthesizeSelectedTurn()}
                disabled={!selectedTargetRunId || Boolean(processing)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {processing === 'synthesize' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
                Synthesize Selected Turn
              </button>
            </div>

            <details className={`group p-4 ${toolsPanelCollapsed ? 'xl:hidden' : ''}`}>
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-800">
                <span className="flex items-center gap-2"><Settings2 className="h-4 w-4" />Advanced Settings</span>
                <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
              </summary>
              <div className="mt-4">
                <GenerationSettings
                  temperature={temperature}
                  maxTokens={maxTokens}
                  includeSystemInstruction={includeSystemInstruction}
                  systemPrompt={systemPrompt}
                  onTemperatureChange={setTemperature}
                  onMaxTokensChange={setMaxTokens}
                  onIncludeSystemInstructionChange={setIncludeSystemInstruction}
                  onSystemPromptChange={setSystemPrompt}
                />
              </div>
            </details>
          </aside>
        </div>
      </section>

      <ModelOutputExpandModal
        isOpen={Boolean(expandedOutput)}
        onClose={() => setExpandedOutput(null)}
        modelName={modelDefinition(expandedOutput?.modelId).shortLabel}
        modelProvider={modelDefinition(expandedOutput?.modelId).provider}
        modelAccent={modelDefinition(expandedOutput?.modelId).accent}
        content={expandedOutput?.text || ''}
        latencyMs={expandedOutput?.latencyMs}
      />
    </div>
  );

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading LLM Playground...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto h-8 w-8 text-[#a90000]" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Unable to open the playground</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {error || 'Your account session could not be verified.'}
          </p>
          <button
            type="button"
            onClick={() => router.replace(`/${role}/login`)}
            className="mt-5 rounded-xl bg-[#a90000] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#850000]"
          >
            Return to sign in
          </button>
        </div>
      </div>
    );
  }

  return role === 'educator' ? (
    <EducatorLayout profile={profile}>{body}</EducatorLayout>
  ) : (
    <StudentLayout profile={profile}>{body}</StudentLayout>
  );
}

function OperationResult({ run }: { run: PlaygroundRun }) {
  const isSynthesis = run.mode === 'synthesis';
  const isMultiJudge = run.mode === 'multi-judge';
  return (
    <section
      className={`mt-4 overflow-hidden rounded-2xl border ${
        isSynthesis ? 'border-emerald-200 bg-emerald-50/70' : 'border-blue-200 bg-blue-50/70'
      }`}
    >
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
        <div className="flex items-center gap-2">
          {isSynthesis ? <Sparkles className="h-4 w-4 text-emerald-700" /> : <ShieldCheck className="h-4 w-4 text-blue-700" />}
          <span className="text-sm font-semibold text-slate-900">
            {isSynthesis ? 'Synthesized Answer' : run.mode === 'single-judge' ? 'Single-Judge Evaluation' : 'Multi-Judge Evaluation'}
          </span>
        </div>
        <span className="text-[11px] text-slate-500">{formatDate(run.createdAt)}</span>
      </div>
      <div className="space-y-3 p-4">
        {run.status === 'failed' && run.error && <p className="text-sm text-red-700">{run.error}</p>}
        {isSynthesis ? (
          run.outputs.length ? (
            run.outputs.map((output) => {
              const finalAnswer =
                typeof output.structured?.finalAnswer === 'string'
                  ? output.structured.finalAnswer
                  : run.status === 'running'
                    ? partialJsonString(output.text, 'finalAnswer')
                    : output.text;
              const rationale = typeof output.structured?.rationale === 'string' ? output.structured.rationale : '';
              return (
                <div key={output.id} className="rounded-xl bg-white p-4 shadow-sm">
                  {finalAnswer ? (
                    <div>
                      <Markdown value={finalAnswer} />
                      {run.status === 'running' && (
                        <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-emerald-700 align-middle" />
                      )}
                    </div>
                  ) : (
                    <StreamingStatus label="Starting synthesis..." />
                  )}
                  {rationale && (
                    <details className="mt-4 border-t border-slate-100 pt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-emerald-800">View synthesis rationale</summary>
                      <div className="mt-3"><Markdown value={rationale} /></div>
                    </details>
                  )}
                </div>
              );
            })
          ) : run.status === 'running' ? (
            <StreamingStatus label="Starting synthesis..." />
          ) : null
        ) : (
          <>
            {isMultiJudge && <MultiJudgeMatrix run={run} />}
            {run.judgements.length ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Individual judge reports
                </p>
                {run.judgements.map((judgement) =>
                  isMultiJudge ? (
                    <MultiJudgeReport
                      key={judgement.id}
                      judgement={judgement}
                      running={run.status === 'running'}
                      open={run.judgements.length === 1}
                    />
                  ) : (
                    <details
                      key={judgement.id}
                      open={run.judgements.length === 1}
                      className="rounded-xl bg-white p-4 shadow-sm"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-800">
                        <span>{modelDefinition(judgement.judgeModelId).shortLabel} report</span>
                        {!judgement.structured && run.status === 'running' && (
                          <span className="flex items-center gap-1.5 text-xs font-normal text-blue-700">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Evaluating
                          </span>
                        )}
                      </summary>
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        {judgement.text ? <Markdown value={judgement.text} /> : <StreamingStatus label="Waiting for evaluator..." />}
                      </div>
                    </details>
                  )
                )}
              </div>
            ) : run.status === 'running' ? (
              <StreamingStatus label="Starting evaluation..." />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function StreamingStatus({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function parseAssessments(judgement: Judgement): MultiJudgeAssessment[] {
  const assessments = judgement.structured?.assessments;
  if (!Array.isArray(assessments)) return [];
  return assessments.flatMap((value) => {
    const record = asRecord(value);
    if (!record || typeof record.targetModelId !== 'string') return [];
    const scoreValue = Number(record.risk_score);
    const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, Math.round(scoreValue))) : 50;
    const label =
      typeof record.risk_label === 'string' && record.risk_label.trim()
        ? record.risk_label.replace('_', ' ').toUpperCase()
        : riskLabel(score);
    return [
      {
        targetModelId: record.targetModelId,
        risk_score: score,
        risk_label: label,
        failure_modes: stringList(record.failure_modes),
        evidence: stringList(record.evidence),
        notes: typeof record.notes === 'string' ? record.notes : '',
        latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : undefined,
        error: typeof record.error === 'string' ? record.error : null,
      },
    ];
  });
}

function uniqueItems(items: string[], limit = 4) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, limit);
}

function averageRisk(assessments: MultiJudgeAssessment[]) {
  if (!assessments.length) return null;
  return Math.round(
    assessments.reduce((total, assessment) => total + assessment.risk_score, 0) / assessments.length
  );
}

function friendlyRisk(score: number) {
  if (score <= 24) return 'Low';
  if (score <= 49) return 'Moderate';
  if (score <= 74) return 'High';
  return 'Very high';
}

function confidenceFromRisk(score: number) {
  if (score <= 24) return 'High';
  if (score <= 49) return 'Moderate';
  if (score <= 74) return 'Low';
  return 'Very low';
}

function assessmentStrength(score: number) {
  if (score <= 24) return 'The response appears broadly useful, relevant, and low risk.';
  if (score <= 49) return 'The response is useful, but some claims should be checked before relying on it.';
  if (score <= 74) return 'The response contains useful material, but important concerns reduce its reliability.';
  return 'The response should not be relied on without substantial review and correction.';
}

function assessmentAction(score: number, hasConcerns: boolean) {
  if (!hasConcerns && score <= 24) return 'No significant issue was identified. A quick source check is still advisable for time-sensitive information.';
  if (score <= 24) return 'Use the response as a starting point, and verify the specific claims highlighted below.';
  if (score <= 49) return 'Review the highlighted claims and correct any unsupported or outdated details before using the response.';
  if (score <= 74) return 'Verify the response against reliable sources and revise the flagged sections before using it.';
  return 'Do not rely on this response as written. Confirm the underlying facts and rewrite the affected sections.';
}

function judgeAgreementFromSpread(spread: number) {
  if (spread <= 10) return 'High';
  if (spread <= 25) return 'Moderate';
  return 'Low';
}

function MultiJudgeSummary({ run }: { run: PlaygroundRun }) {
  const completedJudges = run.judgements
    .map((judgement) => ({
      judgeId: judgement.judgeModelId || '',
      assessments: parseAssessments(judgement),
    }))
    .filter((item) => item.assessments.length > 0);
  const assessments = completedJudges.flatMap((item) => item.assessments);
  const average = averageRisk(assessments);

  if (average === null) {
    return run.status === 'running' ? <StreamingStatus label="Waiting for the first judge summary..." /> : null;
  }

  const targetIds = Array.from(new Set(assessments.map((assessment) => assessment.targetModelId)));
  const responseSpreads = targetIds.flatMap((targetId) => {
    const scores = completedJudges.flatMap((judge) =>
      judge.assessments
        .filter((assessment) => assessment.targetModelId === targetId)
        .map((assessment) => assessment.risk_score)
    );
    if (scores.length < 2) return [];
    return [{ targetId, spread: Math.max(...scores) - Math.min(...scores) }];
  });
  const averageSpread = responseSpreads.length
    ? Math.round(responseSpreads.reduce((total, item) => total + item.spread, 0) / responseSpreads.length)
    : null;
  const widestDisagreement = [...responseSpreads].sort((left, right) => right.spread - left.spread)[0];
  const agreement = averageSpread === null ? 'Waiting' : judgeAgreementFromSpread(averageSpread);
  const concerns = uniqueItems(assessments.flatMap((assessment) => assessment.failure_modes), 3);
  const disagreement =
    averageSpread === null
      ? 'More judge results are still needed before agreement can be measured.'
      : averageSpread <= 10
        ? `The judges reached similar conclusions across responses, with an average score spread of ${averageSpread} points.`
        : `Judges differed most on the ${modelDefinition(widestDisagreement.targetId).shortLabel} response (${widestDisagreement.spread}-point spread). The average spread across responses is ${averageSpread} points.`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Combined judge summary</p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">What the evaluations mean</h3>
        </div>
        {run.status === 'running' && (
          <span className="flex items-center gap-1.5 text-xs text-blue-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating as judges finish
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryMetric label="Overall confidence" value={confidenceFromRisk(average)} />
        <SummaryMetric label="Average accuracy risk" value={`${average}/100 (${friendlyRisk(average)})`} />
        <SummaryMetric
          label="Judge score agreement"
          value={averageSpread === null ? agreement : `${agreement} (${averageSpread}-point avg spread)`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700">Main concerns to check</p>
          {concerns.length ? (
            <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-600">
              {concerns.map((concern) => <li key={concern}>- {concern}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-600">The completed judges have not identified a specific concern.</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700">Recommended action</p>
          <p className="mt-2 text-sm leading-5 text-slate-600">{assessmentAction(average, concerns.length > 0)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
        <p className="text-xs font-semibold text-blue-900">Where the judges differ</p>
        <p className="mt-1 text-sm leading-5 text-blue-800">{disagreement}</p>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function MultiJudgeReport({
  judgement,
  running,
  open,
}: {
  judgement: Judgement;
  running: boolean;
  open: boolean;
}) {
  const assessments = parseAssessments(judgement);
  const average = averageRisk(assessments);
  const judgeName = modelDefinition(judgement.judgeModelId).shortLabel;

  return (
    <details open={open} className="rounded-xl bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-800">
        <span>{judgeName} evaluation</span>
        {average !== null ? (
          <span className={`rounded-full border px-2.5 py-1 text-xs ${riskTone(riskLabel(average))}`}>
            {friendlyRisk(average)} risk, {average}/100
          </span>
        ) : running ? (
          <span className="flex items-center gap-1.5 text-xs font-normal text-blue-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Evaluating
          </span>
        ) : (
          <span className="text-xs font-normal text-slate-500">Summary unavailable</span>
        )}
      </summary>

      <div className="mt-3 space-y-4 border-t border-slate-100 pt-3">
        {assessments.length ? (
          assessments.map((assessment) => {
            const hasConcerns = assessment.failure_modes.length > 0;
            return (
              <section key={assessment.targetModelId} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Response reviewed</p>
                    <h4 className="mt-1 text-sm font-semibold text-slate-900">
                      {modelDefinition(assessment.targetModelId).shortLabel}
                    </h4>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${riskTone(assessment.risk_label)}`}>
                      {friendlyRisk(assessment.risk_score)} accuracy risk
                    </span>
                    <p className="mt-1 text-xs text-slate-500">Confidence: {confidenceFromRisk(assessment.risk_score)}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <p className="text-xs font-semibold text-emerald-900">What looks good</p>
                    <p className="mt-1 text-sm leading-5 text-emerald-800">{assessmentStrength(assessment.risk_score)}</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-900">What should be checked</p>
                    {hasConcerns ? (
                      <ul className="mt-1 space-y-1 text-sm leading-5 text-amber-900">
                        {uniqueItems(assessment.failure_modes).map((item) => <li key={item}>- {item}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm leading-5 text-amber-900">No specific issue was identified by this judge.</p>
                    )}
                  </div>
                </div>

                {assessment.evidence.length > 0 && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-700">Claims worth verifying</p>
                    <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-600">
                      {uniqueItems(assessment.evidence).map((item) => <li key={item}>- {item}</li>)}
                    </ul>
                  </div>
                )}

                {assessment.notes && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-slate-700">Evaluator explanation</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{assessment.notes}</p>
                  </div>
                )}

                <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/70 p-3">
                  <p className="text-xs font-semibold text-blue-900">Recommendation</p>
                  <p className="mt-1 text-sm leading-5 text-blue-800">
                    {assessmentAction(assessment.risk_score, hasConcerns)}
                  </p>
                </div>

                {assessment.error && <p className="mt-3 text-sm text-red-700">Evaluation issue: {assessment.error}</p>}
              </section>
            );
          })
        ) : running ? (
          <StreamingStatus label={`${judgeName} is reviewing the selected responses...`} />
        ) : (
          <p className="text-sm text-slate-600">A readable structured summary was not available for this evaluation.</p>
        )}

        <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">View technical details</summary>
          <div className="mt-3 space-y-3 text-xs text-slate-600">
            <p><span className="font-semibold">Judge model:</span> {judgement.judgeModelId || 'Unknown'}</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">
              {judgement.structured ? JSON.stringify(judgement.structured, null, 2) : judgement.text || 'No raw result available.'}
            </pre>
          </div>
        </details>
      </div>
    </details>
  );
}

function MultiJudgeMatrix({ run }: { run: PlaygroundRun }) {
  const [selectedCell, setSelectedCell] = useState('');
  const metadataJudges = stringList(run.metadata?.judgeModelIds);
  const metadataTargets = stringList(run.metadata?.targetModelIds);
  const judgeIds = Array.from(
    new Set([...metadataJudges, ...run.judgements.map((item) => item.judgeModelId || '').filter(Boolean)])
  );
  const assessmentsByJudge = new Map(
    run.judgements.map((judgement) => [judgement.judgeModelId || '', parseAssessments(judgement)])
  );
  const targetIds = Array.from(
    new Set([
      ...metadataTargets,
      ...Array.from(assessmentsByJudge.values()).flatMap((assessments) =>
        assessments.map((assessment) => assessment.targetModelId)
      ),
    ])
  );
  const cells = new Map<string, MultiJudgeAssessment>();
  for (const [judgeId, assessments] of Array.from(assessmentsByJudge.entries())) {
    for (const assessment of assessments) cells.set(`${assessment.targetModelId}:${judgeId}`, assessment);
  }
  const selectedAssessment = cells.get(selectedCell);
  const [selectedTargetId, selectedJudgeId] = selectedCell.split(':');

  if (!judgeIds.length || !targetIds.length) {
    return run.status === 'running' ? <StreamingStatus label="Building the judge comparison matrix..." /> : null;
  }

  return (
    <div className="space-y-3">
      <MultiJudgeSummary run={run} />
      <div className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
        <div className="border-b border-blue-100 bg-blue-50/70 px-4 py-4">
          <h3 className="text-sm font-semibold text-slate-900">Multi-judge evaluation matrix</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Read across each row: every judge column scores the response named on the left. Lower risk is better.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 shadow-sm">
                <MessageSquare className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800">Rows = responses</p>
                <p className="mt-0.5 text-xs text-amber-900">Answers produced by the selected response models</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/80 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-800">Columns = judges</p>
                <p className="mt-0.5 text-xs text-blue-900">Evaluator models checking each response for accuracy risk</p>
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th rowSpan={2} scope="col" className="w-[210px] border-r border-slate-200 bg-amber-50/60 px-4 py-3 align-middle">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800">Responses being reviewed</span>
                <span className="mt-1 block font-normal text-slate-500">One answer per row</span>
              </th>
              <th colSpan={judgeIds.length} scope="colgroup" className="border-r border-slate-200 bg-blue-50/70 px-4 py-2 text-center">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-800">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Judge models · evaluator role
                </span>
              </th>
              <th rowSpan={2} scope="col" className="w-[155px] bg-violet-50/70 px-4 py-3 text-center align-middle">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-violet-800">Combined judge result</span>
                <span className="mt-1 block font-normal text-slate-500">Average + spread</span>
              </th>
            </tr>
            <tr className="border-b border-slate-200 bg-blue-50/30 text-slate-600">
              {judgeIds.map((judgeId) => (
                <th key={judgeId} scope="col" className="border-r border-slate-100 px-3 py-3 text-center font-semibold last:border-r-slate-200">
                  <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.1em] text-blue-700">Judge</span>
                  <span className="inline-flex items-center justify-center gap-1.5 text-slate-800">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: modelDefinition(judgeId).accent }} />
                    {modelDefinition(judgeId).shortLabel}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targetIds.map((targetId) => {
              const rowAssessments = judgeIds
                .map((judgeId) => cells.get(`${targetId}:${judgeId}`))
                .filter((assessment): assessment is MultiJudgeAssessment => Boolean(assessment));
              const scores = rowAssessments.map((assessment) => assessment.risk_score);
              const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
              const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : null;
              const agreement = spread === null ? 'Need 2+ judges' : `${judgeAgreementFromSpread(spread)} agreement`;
              const targetModel = modelDefinition(targetId);
              return (
                <tr key={targetId} className="border-b border-slate-100 transition hover:bg-slate-50/80 last:border-0">
                  <th scope="row" className="border-r border-slate-200 bg-amber-50/25 px-4 py-4 text-slate-900">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700">Response</span>
                    <span className="mt-1.5 flex items-center gap-2 text-sm font-semibold">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: targetModel.accent }} />
                      {targetModel.shortLabel}
                    </span>
                    <span className="mt-1 block pl-[18px] text-[10px] font-normal text-slate-500">{targetModel.provider} answer</span>
                  </th>
                  {judgeIds.map((judgeId) => {
                    const key = `${targetId}:${judgeId}`;
                    const assessment = cells.get(key);
                    const isSelfReview = judgeId === targetId;
                    return (
                      <td key={judgeId} className="border-r border-slate-100 px-3 py-3 text-center last:border-r-slate-200">
                        {assessment ? (
                          <button
                            type="button"
                            onClick={() => setSelectedCell(key)}
                            title={`${modelDefinition(judgeId).shortLabel} judge scored the ${targetModel.shortLabel} response${isSelfReview ? ' (self-review)' : ''}`}
                            aria-label={`${modelDefinition(judgeId).shortLabel} judge score for ${targetModel.shortLabel}: ${assessment.risk_score} out of 100${isSelfReview ? ', self-review' : ''}`}
                            className={`min-w-[104px] rounded-xl border px-2.5 py-2 font-semibold transition hover:-translate-y-0.5 hover:shadow-md ${riskTone(assessment.risk_label)} ${
                              selectedCell === key ? 'ring-2 ring-blue-400 ring-offset-2' : ''
                            }`}
                          >
                            <span className="block">{assessment.risk_score}/100</span>
                            <span className="mt-0.5 block text-[10px]">{assessment.risk_label}</span>
                            {isSelfReview && (
                              <span className="mt-1.5 block border-t border-current/15 pt-1 text-[9px] font-bold uppercase tracking-wide opacity-75">
                                Self-review
                              </span>
                            )}
                          </button>
                        ) : run.status === 'running' ? (
                          <span className="inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-3 text-slate-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Pending
                          </span>
                        ) : (
                          <span className="text-slate-400">Not available</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="bg-violet-50/25 px-4 py-3 text-center">
                    {average === null ? (
                      <span className="text-slate-400">Pending</span>
                    ) : (
                      <div className={`inline-flex min-w-[124px] flex-col rounded-xl border px-3 py-2.5 ${riskTone(riskLabel(average))}`}>
                        <span className="text-[9px] font-bold uppercase tracking-wide opacity-75">Judge average</span>
                        <span className="mt-0.5 text-sm font-bold">{average}/100</span>
                        <span className="mt-1 text-[10px]">{spread === null ? 'One score available' : `${spread}-point spread`}</span>
                        <span className="text-[10px] font-semibold">{agreement}</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>

        <div className="flex gap-3 border-t border-violet-100 bg-violet-50/60 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
          <div className="text-xs leading-5 text-violet-900">
            <p className="font-semibold">How the combined judge result is calculated</p>
            <p className="mt-0.5 text-violet-800">
              For each response, the available judge risk scores are added together, divided by the number of judges, and rounded. The spread is the highest score minus the lowest. This measures judge score agreement—not agreement between the response models or a vote for the best answer.
            </p>
            <p className="mt-1 text-violet-700">Agreement bands: High 0–10 points, Moderate 11–25, Low 26+.</p>
          </div>
        </div>

      </div>

      {selectedAssessment && (
        <JudgeAssessmentModal
          assessment={selectedAssessment}
          targetModelId={selectedTargetId}
          judgeModelId={selectedJudgeId}
          onClose={() => setSelectedCell('')}
        />
      )}
    </div>
  );
}

function JudgeAssessmentModal({
  assessment,
  targetModelId,
  judgeModelId,
  onClose,
}: {
  assessment: MultiJudgeAssessment;
  targetModelId: string;
  judgeModelId: string;
  onClose: () => void;
}) {
  const responseModel = modelDefinition(targetModelId);
  const judgeModel = modelDefinition(judgeModelId);
  const isSelfReview = targetModelId === judgeModelId;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="judge-assessment-title"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Selected judge score</p>
            <h3 id="judge-assessment-title" className="mt-1 text-lg font-semibold text-slate-900">Evaluation details</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close evaluation details"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">Response reviewed</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: responseModel.accent }} />
                <span className="text-sm font-semibold text-slate-900">{responseModel.shortLabel}</span>
              </div>
              <p className="mt-1 pl-[18px] text-xs text-slate-500">{responseModel.provider} answer</p>
            </div>
            <div className="flex items-center justify-center px-2 text-xs font-medium text-slate-400">reviewed by</div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700">Judge model</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: judgeModel.accent }} />
                <span className="text-sm font-semibold text-slate-900">{judgeModel.shortLabel}</span>
              </div>
              <p className="mt-1 pl-[18px] text-xs text-slate-500">Evaluator role</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-xs font-semibold text-slate-700">Hallucination / accuracy risk</p>
              <p className="mt-1 text-xs text-slate-500">Higher scores indicate greater risk.</p>
            </div>
            <span className={`rounded-xl border px-4 py-2 text-sm font-bold ${riskTone(assessment.risk_label)}`}>
              {assessment.risk_score}/100 · {friendlyRisk(assessment.risk_score)} risk
            </span>
          </div>

          {isSelfReview && (
            <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p><span className="font-semibold">Self-review:</span> this model evaluated its own response. Consider the other judges before drawing a conclusion.</p>
            </div>
          )}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <AssessmentList title="Potential issues" items={assessment.failure_modes} empty="No potential issues identified." />
            <AssessmentList title="Claims reviewed" items={assessment.evidence} empty="No specific claims were highlighted." />
          </div>

          {assessment.notes && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold text-slate-700">Evaluator explanation</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{assessment.notes}</p>
            </div>
          )}
          {assessment.error && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{assessment.error}</p>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-slate-200 bg-slate-50 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#a90000] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#850000]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AssessmentList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      {items.length ? (
        <ul className="mt-2 space-y-2 text-sm leading-5 text-slate-600">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">{empty}</p>
      )}
    </div>
  );
}
