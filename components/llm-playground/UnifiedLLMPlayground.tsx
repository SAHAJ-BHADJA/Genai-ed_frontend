'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Bot,
  BrainCircuit,
  Check,
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
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
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
    id: 'gemini-2.5-flash',
    label: 'Google Gemini 2.5 Flash',
    shortLabel: 'Gemini 2.5 Flash',
    provider: 'Google',
    accent: '#3b82f6',
    tint: 'bg-blue-50 border-blue-200',
    hoverTint: 'hover:border-blue-300 hover:bg-blue-100/70',
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
];

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

export default function UnifiedLLMPlayground({ role }: { role: UserRole }) {
  const router = useRouter();
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
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

  async function getAccessToken() {
    let { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) {
      const refreshed = await supabase.auth.refreshSession();
      data = refreshed.data;
    }
    if (!data.session?.access_token) throw new Error('Your session expired. Please sign in again.');
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
    if (!response.ok) throw new Error(readableError(payload, `Request failed (${response.status}).`));
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
      setDetail((current) =>
        current
          ? {
              ...current,
              runs: current.runs.some((item) => item.id === transient.id)
                ? current.runs.map((item) => (item.id === transient.id ? transient : item))
                : [...current.runs, transient],
            }
          : current
      );
      if (!transient.targetRunId) setSelectedTargetRunId(transient.id);
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
            const item = asRecord(payload.item) as unknown as ModelOutput | null;
            if (!item) return run;
            const outputs = run.outputs.some((output) => output.modelId === item.modelId)
              ? run.outputs.map((output) => (output.modelId === item.modelId ? item : output))
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

  async function loadConversations(preferredId?: string) {
    const result = await apiRequest<{ conversations: Conversation[] }>(`/conversations?userRole=${role}`);
    const rows = result.conversations || [];
    setConversations(rows);
    const nextId = preferredId || activeConversationId || rows[0]?.id || '';
    if (nextId) {
      setActiveConversationId(nextId);
      await loadConversation(nextId);
    } else {
      await createConversation();
    }
  }

  async function loadConversation(conversationId: string) {
    setLoadingConversation(true);
    setError('');
    try {
      const nextDetail = await apiRequest<ConversationDetail>(`/conversations/${conversationId}`);
      applyDetail(nextDetail);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load the conversation.');
    } finally {
      setLoadingConversation(false);
    }
  }

  function applyDetail(nextDetail: ConversationDetail) {
    setDetail(nextDetail);
    setActiveConversationId(nextDetail.conversation.id);
    const saved = nextDetail.conversation.settings || {};
    const savedModels = saved.responseModelIds;
    if (Array.isArray(savedModels) && savedModels.length) {
      setSelectedResponseModels(savedModels.filter((item): item is string => typeof item === 'string').slice(0, 3));
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

  async function createConversation() {
    setError('');
    setLoadingConversation(true);
    try {
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
      const result = await apiRequest<{ conversations: Conversation[] }>(`/conversations?userRole=${role}`);
      setConversations(result.conversations || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create a conversation.');
    } finally {
      setLoadingConversation(false);
    }
  }

  async function deleteConversation() {
    if (!activeConversationId || !window.confirm('Delete this conversation and all saved model results?')) return;
    setError('');
    try {
      await apiRequest<{ ok: boolean }>(`/conversations/${activeConversationId}`, { method: 'DELETE' });
      setDetail(null);
      setActiveConversationId('');
      await loadConversations();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete the conversation.');
    }
  }

  async function sendMessage() {
    const prompt = input.trim();
    if (!prompt || !activeConversationId || processing) return;
    setInput('');
    setError('');
    setProcessing('respond');
    let runStarted = false;
    try {
      await streamRequest(
        `/conversations/${activeConversationId}/respond/stream`,
        { prompt, modelIds: selectedResponseModels, config },
        (event, payload) => {
          if (event === 'run_started') runStarted = true;
          handleStreamEvent(event, payload);
        }
      );
      const result = await apiRequest<{ conversations: Conversation[] }>(`/conversations?userRole=${role}`);
      setConversations(result.conversations || []);
      requestAnimationFrame(() => timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (requestError) {
      if (!runStarted) setInput(prompt);
      if (runStarted) await loadConversation(activeConversationId);
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
      for (const model of MODELS) {
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
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        if (!user) {
          router.replace(`/${role}/login`);
          return;
        }
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        if (!profileData || profileData.role !== role) {
          router.replace(`/${role}/login`);
          return;
        }
        if (!active) return;
        setProfile(profileData as Profile);
        await loadConversations();
      } catch (authError) {
        if (active) setError(authError instanceof Error ? authError.message : 'Unable to open the playground.');
      } finally {
        if (active) setAuthLoading(false);
      }
    }
    void authenticate();
    return () => {
      active = false;
    };
    // Authentication runs once per portal entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

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
                  onClick={() => void createConversation()}
                  title="New chat"
                  aria-label="New chat"
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#a90000] text-white transition hover:bg-[#850000]"
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
                  onClick={() => setModelsPanelCollapsed(false)}
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
                  onClick={() => void createConversation()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#a90000] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#850000]"
                >
                  <Plus className="h-4 w-4" />
                  New Chat
                </button>
                <button
                  type="button"
                  onClick={() => void deleteConversation()}
                  disabled={!activeConversationId}
                  title="Delete conversation"
                  className="rounded-xl border border-slate-200 bg-white px-3 text-slate-500 transition hover:border-red-200 hover:text-red-700 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Conversation history
              </label>
              <div className="relative mt-2">
                <select
                  value={activeConversationId}
                  onChange={(event) => {
                    setActiveConversationId(event.target.value);
                    void loadConversation(event.target.value);
                  }}
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm font-medium text-slate-800 outline-none focus:border-[#a90000]"
                >
                  {conversations.map((conversation) => (
                    <option key={conversation.id} value={conversation.id}>
                      {conversation.title}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
              </div>
            </div>

            <div className={`p-4 ${modelsPanelCollapsed ? 'xl:hidden' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">Response Models</h2>
                  <p className="text-xs text-slate-500">Select up to 3 for the next turn.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {selectedResponseModels.length}/3
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {MODELS.map((model) => {
                  const selected = selectedResponseModels.includes(model.id);
                  return (
                    <button
                      type="button"
                      key={model.id}
                      onClick={() => toggleResponseModel(model.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selected
                          ? 'border-[#a90000] bg-red-50 shadow-sm'
                          : 'border-transparent bg-white hover:border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full ring-4 ring-white"
                            style={{ backgroundColor: model.accent }}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{model.shortLabel}</div>
                            <div className="text-xs text-slate-500">{model.provider}</div>
                          </div>
                        </div>
                        {selected && (
                          <span className="rounded-full bg-[#a90000] p-1 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
                Change models at any time. Every selected model receives the same saved conversation context.
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
                            run.outputs.length === 1
                              ? 'mx-auto max-w-3xl grid-cols-1'
                              : run.outputs.length === 2
                                ? 'md:grid-cols-2'
                                : 'lg:grid-cols-3'
                          }`}
                        >
                          {run.outputs.map((output) => {
                            const model = modelDefinition(output.modelId);
                            const outputStreaming = run.status === 'running' && output.latencyMs === 0 && !output.error;
                            return (
                              <div
                                key={output.id}
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
                                ) : (
                                  <div>
                                    <Markdown value={output.text} />
                                    {outputStreaming && (
                                      <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-current align-middle" />
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
              <div className="mt-3 flex flex-wrap gap-2">
                {MODELS.map((model) => {
                  const selected = judgeModels.includes(model.id);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => toggleJudgeModel(model.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        selected ? 'border-[#a90000] bg-red-50 text-[#850000]' : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: model.accent }} />
                      {model.shortLabel}
                    </button>
                  );
                })}
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
                {MODELS.map((model) => (
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

  if (authLoading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading LLM Playground...
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
  if (score <= 25) return 'Low';
  if (score <= 50) return 'Moderate';
  if (score <= 75) return 'High';
  return 'Very high';
}

function confidenceFromRisk(score: number) {
  if (score <= 25) return 'High';
  if (score <= 50) return 'Moderate';
  if (score <= 75) return 'Low';
  return 'Very low';
}

function assessmentStrength(score: number) {
  if (score <= 25) return 'The response appears broadly useful, relevant, and low risk.';
  if (score <= 50) return 'The response is useful, but some claims should be checked before relying on it.';
  if (score <= 75) return 'The response contains useful material, but important concerns reduce its reliability.';
  return 'The response should not be relied on without substantial review and correction.';
}

function assessmentAction(score: number, hasConcerns: boolean) {
  if (!hasConcerns && score <= 25) return 'No significant issue was identified. A quick source check is still advisable for time-sensitive information.';
  if (score <= 25) return 'Use the response as a starting point, and verify the specific claims highlighted below.';
  if (score <= 50) return 'Review the highlighted claims and correct any unsupported or outdated details before using the response.';
  if (score <= 75) return 'Verify the response against reliable sources and revise the flagged sections before using it.';
  return 'Do not rely on this response as written. Confirm the underlying facts and rewrite the affected sections.';
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

  const judgeAverages = completedJudges.map((item) => ({
    judgeId: item.judgeId,
    score: averageRisk(item.assessments) ?? 0,
  }));
  const lowest = [...judgeAverages].sort((a, b) => a.score - b.score)[0];
  const highest = [...judgeAverages].sort((a, b) => b.score - a.score)[0];
  const spread = highest.score - lowest.score;
  const agreement = spread <= 10 ? 'High' : spread <= 25 ? 'Moderate' : 'Low';
  const concerns = uniqueItems(assessments.flatMap((assessment) => assessment.failure_modes), 3);
  const disagreement =
    judgeAverages.length < 2
      ? 'More judge results are still needed before agreement can be measured.'
      : spread <= 10
        ? `The judges reached similar conclusions; their average scores differ by only ${spread} points.`
        : `${modelDefinition(highest.judgeId).shortLabel} was most cautious (${highest.score}/100), while ${modelDefinition(lowest.judgeId).shortLabel} assigned the lowest risk (${lowest.score}/100).`;

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
        <SummaryMetric label="Judge agreement" value={agreement} />
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
        <div className="border-b border-blue-100 bg-blue-50/70 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Evaluation overview by response and judge</h3>
          <p className="mt-1 text-xs text-slate-500">Select a score to inspect potential issues, reviewed claims, and the evaluator explanation.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <th className="px-4 py-3 font-semibold">Response model</th>
              {judgeIds.map((judgeId) => (
                <th key={judgeId} className="px-3 py-3 text-center font-semibold">
                  {modelDefinition(judgeId).shortLabel}
                </th>
              ))}
              <th className="px-4 py-3 text-center font-semibold">Consensus</th>
            </tr>
          </thead>
          <tbody>
            {targetIds.map((targetId) => {
              const rowAssessments = judgeIds
                .map((judgeId) => cells.get(`${targetId}:${judgeId}`))
                .filter((assessment): assessment is MultiJudgeAssessment => Boolean(assessment));
              const scores = rowAssessments.map((assessment) => assessment.risk_score);
              const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
              const range = scores.length ? `${Math.min(...scores)}-${Math.max(...scores)}` : '';
              return (
                <tr key={targetId} className="border-b border-slate-100 last:border-0">
                  <th className="px-4 py-3 text-sm font-semibold text-slate-900">
                    {modelDefinition(targetId).shortLabel}
                  </th>
                  {judgeIds.map((judgeId) => {
                    const key = `${targetId}:${judgeId}`;
                    const assessment = cells.get(key);
                    return (
                      <td key={judgeId} className="px-3 py-3 text-center">
                        {assessment ? (
                          <button
                            type="button"
                            onClick={() => setSelectedCell((current) => (current === key ? '' : key))}
                            className={`min-w-[86px] rounded-lg border px-2.5 py-2 font-semibold transition hover:-translate-y-0.5 hover:shadow-sm ${riskTone(assessment.risk_label)} ${
                              selectedCell === key ? 'ring-2 ring-blue-400 ring-offset-2' : ''
                            }`}
                          >
                            <span className="block">{assessment.risk_score}/100</span>
                            <span className="mt-0.5 block text-[10px]">{assessment.risk_label}</span>
                          </button>
                        ) : run.status === 'running' ? (
                          <span className="inline-flex min-w-[86px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-3 text-slate-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Pending
                          </span>
                        ) : (
                          <span className="text-slate-400">Not available</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-center">
                    {average === null ? (
                      <span className="text-slate-400">Pending</span>
                    ) : (
                      <div className={`inline-flex min-w-[92px] flex-col rounded-lg border px-2.5 py-2 ${riskTone(riskLabel(average))}`}>
                        <span className="font-semibold">{average}/100</span>
                        <span className="text-[10px]">Range {range}</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>

        {selectedAssessment && (
          <div className="border-t border-blue-100 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Selected evaluation</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {modelDefinition(selectedTargetId).shortLabel} evaluated by {modelDefinition(selectedJudgeId).shortLabel}
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskTone(selectedAssessment.risk_label)}`}>
                {friendlyRisk(selectedAssessment.risk_score)} accuracy risk, {selectedAssessment.risk_score}/100
              </span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <AssessmentList title="Potential issues" items={selectedAssessment.failure_modes} empty="No potential issues identified." />
              <AssessmentList title="Claims reviewed" items={selectedAssessment.evidence} empty="No specific claims were highlighted." />
            </div>
            {selectedAssessment.notes && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">Evaluator explanation</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{selectedAssessment.notes}</p>
              </div>
            )}
            {selectedAssessment.error && <p className="mt-3 text-sm text-red-700">{selectedAssessment.error}</p>}
          </div>
        )}
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
