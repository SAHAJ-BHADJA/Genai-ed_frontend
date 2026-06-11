'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Profile } from '@/lib/supabase';
import EducatorLayout from '@/components/EducatorLayout';
import { getBackendBase } from '@/lib/backend';
import GenerationSettings from '@/components/GenerationSettings';
import Markdown from '@/components/Markdown';
import { ModelOutputExpandModal, ExpandButton } from '@/components/ModelOutputExpandModal';
import {
  Bot,
  Send,
  Trash2,
  MessageSquare,
  ArrowLeftRight,
  Users,
  User,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  FileText,
  Sparkles,
  X,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Menu,
  Check,
  AlertTriangle
} from 'lucide-react';

type AIModel = {
  id: string;
  name: string;
  provider: string;
  icon: string;
  color: string;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  timestamp: Date;
};

type Mode = 'single' | 'compare' | 'multi-judge' | 'single-judge';

type EnvelopeItem = {
  kind: string;
  modelId: string;
  latencyMs: number;
  content: { format: 'markdown'; value: string };
  structured?: any;
  error?: string | null;
};

type EnvelopeResponse = {
  phase: string;
  items: EnvelopeItem[];
  meta?: any;
};

type LlmOutput = {
  modelId: string;
  text: string;
  latencyMs: number;
  error?: string;
};

type CompareRun = {
  id: string;
  prompt: string;
  modelIds: string[];
  outputs: EnvelopeItem[];
  orchestratorModelId?: string;
  orchestrationPrompt?: string;
  finalAnswer?: string;
  rationale?: string;
  orchestratedThread?: Message[];
};

type MultiJudgeRun = {
  id: string;
  prompt: string;
  primaryModelIds: string[];
  judgeModelIds: string[];
  primaryOutputs: EnvelopeItem[];
  assessments: EnvelopeItem[];
  meta?: any;
};

type SingleJudgeRun = {
  id: string;
  prompt: string;
  primaryModelIds: string[];
  evaluatorModelId: string;
  primaryOutputs: EnvelopeItem[];
  report: string;
  latencyMs: number;
  structured?: SingleJudgeStructured | null;
};

type CrossModelAnalysisItem = {
  topicOrClaim: string;
  agreementLevel: string;
  riskFlag: string;
};

type VerificationClaim = {
  claim: string;
  why: string;
  suggestedVerification: string;
};

type CostOfErrorAssessment = {
  domain: string;
  potentialImpactIfWrong: string;
  recommendedVerificationLevel: string;
};

type ModelByModelAssessment = {
  modelId: string;
  riskLevel: string;
  concerns: string[];
  confidenceIndicators: string[];
};

type SingleJudgeStructured = {
  overallHallucinationRisk: string;
  riskSummary: string;
  crossModelAnalysis: CrossModelAnalysisItem[];
  claimsRequiringVerification: VerificationClaim[];
  costOfError: CostOfErrorAssessment;
  modelByModel: ModelByModelAssessment[];
  safeToTrustElements: string[];
  recommendationsForUser: string[];
};

const AI_MODELS: AIModel[] = [
  { id: 'gpt-5.2-chat', name: 'OpenAI gpt-5.2-chat', provider: 'OpenAI', icon: '🤖', color: 'bg-green-500' },
  { id: 'gemini-2.5-flash', name: 'Google Gemini 2.5-flash', provider: 'Google', icon: '✨', color: 'bg-blue-500' },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'Anthropic', icon: '🧠', color: 'bg-purple-500' }
];

const BACKEND_BASE = getBackendBase();

function getEnvelopeText(item?: EnvelopeItem | null): string {
  const v = item?.content?.value;
  if (typeof v === 'string' && v.trim().length > 0) return v;
  if (item?.error) return `Error: ${item.error}`;
  return 'No response';
}

function toLlmOutputs(items: EnvelopeItem[]): LlmOutput[] {
  return (items || []).map((it) => ({
    modelId: it.modelId,
    text: (it.content?.value && it.content.value.trim().length > 0) ? it.content.value : '',
    latencyMs: it.latencyMs ?? 0,
    error: it.error ?? undefined,
  }));
}

async function apiPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: any;

  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Failed to parse response: ${text}`);
  }

  if (!res.ok) {
    const errorMessage = json.detail || json.message || text || `HTTP ${res.status}`;
    throw new Error(errorMessage);
  }

  return json;
}

async function streamSinglePlaygroundResponse(
  body: any,
  handlers: {
    onDelta: (chunk: string) => void;
    onDone: (item: EnvelopeItem | null) => void;
    onError: (message: string) => void;
  }
): Promise<void> {
  const res = await fetch(`${BACKEND_BASE}/api/llm-playground/single/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    throw new Error(json.detail || json.message || text || `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body was not available.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

  const processEvent = (eventName: string, data: string) => {
    if (!data.trim()) return;
    const payload = JSON.parse(data);
    if (eventName === 'delta') {
      handlers.onDelta(payload.text || '');
      return;
    }
    if (eventName === 'done') {
      handlers.onDone((payload.item as EnvelopeItem | undefined) ?? null);
      return;
    }
    if (eventName === 'error') {
      handlers.onError(payload.message || 'Streaming request failed.');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = rawEvent.split(/\r?\n/);
      const dataLines: string[] = [];
      currentEvent = 'message';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (dataLines.length > 0) {
        processEvent(currentEvent, dataLines.join('\n'));
      }

      boundary = buffer.indexOf('\n\n');
    }

    if (done) {
      const trailing = buffer.trim();
      if (trailing) {
        const lines = trailing.split(/\r?\n/);
        const dataLines: string[] = [];
        currentEvent = 'message';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length > 0) {
          processEvent(currentEvent, dataLines.join('\n'));
        }
      }
      break;
    }
  }
}

type JudgeAssessment = {
  targetModelId: string;
  risk_score: number;
  risk_label: string;
  failure_modes?: string[];
  evidence?: string[];
  notes?: string;
  latencyMs?: number;
  error?: string | null;
};

function badgeClassForRisk(label: string) {
  const v = (label || "").toUpperCase();
  if (v === "LOW") return "bg-green-100 text-green-800 border-green-200";
  if (v === "HIGH") return "bg-red-100 text-red-800 border-red-200";
  return "bg-yellow-100 text-yellow-800 border-yellow-200";
}

function safeNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function formatJudgeLabel(value: string | undefined | null) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ').toUpperCase();
}

function formatAgreementLevel(value: string | undefined | null) {
  const raw = String(value || 'Unknown').trim();
  const normalized = raw.toLowerCase().replace(/_/g, ' ');
  if (normalized === 'full') return 'Full agreement';
  if (normalized === 'partial') return 'Partial agreement';
  if (normalized === 'conflict') return 'CONTRADICTION';
  if (normalized === 'unique') return 'Only one model mentions this';
  return raw;
}

function singleJudgeRiskClass(label: string) {
  const v = formatJudgeLabel(label);
  if (v === 'LOW') return 'bg-green-50 text-green-800 border-green-200';
  if (v === 'MEDIUM') return 'bg-yellow-50 text-yellow-800 border-yellow-200';
  if (v === 'HIGH') return 'bg-orange-50 text-orange-800 border-orange-200';
  if (v === 'VERY HIGH') return 'bg-red-50 text-red-800 border-red-200';
  return 'bg-gray-50 text-gray-800 border-gray-200';
}

function agreementLevelClass(level: string) {
  const v = formatAgreementLevel(level).toLowerCase();
  if (v.includes('full')) return 'text-green-700';
  if (v.includes('partial')) return 'text-yellow-700';
  if (v.includes('contrad')) return 'text-red-700';
  if (v.includes('only')) return 'text-orange-700';
  return 'text-gray-600';
}

function agreementLevelCellClass(level: string) {
  const v = formatAgreementLevel(level).toLowerCase();
  if (v.includes('full')) return 'bg-green-50';
  if (v.includes('partial')) return 'bg-yellow-50';
  if (v.includes('contrad')) return 'bg-red-50';
  if (v.includes('only')) return 'bg-orange-50';
  return 'bg-white';
}

function riskFlagClass(flag: string) {
  const v = String(flag || '').toUpperCase();
  if (v.includes('LOW')) return 'text-green-700';
  if (v.includes('MEDIUM')) return 'text-yellow-700';
  if (v.includes('HIGH') || v.includes('CRITICAL')) return 'text-red-700';
  return 'text-gray-700';
}

function riskFlagCellClass(flag: string) {
  const v = String(flag || '').toUpperCase();
  if (v.includes('LOW')) return 'bg-green-50';
  if (v.includes('MEDIUM')) return 'bg-yellow-50';
  if (v.includes('HIGH') || v.includes('CRITICAL')) return 'bg-red-50';
  return 'bg-white';
}

function formatRiskFlag(flag: string | undefined | null) {
  return String(flag || 'Unknown').trim().toUpperCase();
}

export default function LLMPlayground() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('single');

  const [selectedModel, setSelectedModel] = useState<string>('gpt-5.2-chat');
  const [singleMessages, setSingleMessages] = useState<Message[]>([]);

  const [compareModelIds, setCompareModelIds] = useState<string[]>(AI_MODELS.map((m) => m.id));
  const [compareRuns, setCompareRuns] = useState<CompareRun[]>([]);
  const [activeCompareRunId, setActiveCompareRunId] = useState<string | null>(null);

  const [multiJudgePrimaryIds, setMultiJudgePrimaryIds] = useState<string[]>(AI_MODELS.map((m) => m.id));
  const [multiJudgeJudgeIds, setMultiJudgeJudgeIds] = useState<string[]>(AI_MODELS.map((m) => m.id));
  const [multiJudgeRuns, setMultiJudgeRuns] = useState<MultiJudgeRun[]>([]);

  const [singleJudgePrimaryIds, setSingleJudgePrimaryIds] = useState<string[]>(AI_MODELS.map((m) => m.id));
  const [singleJudgeEvaluatorId, setSingleJudgeEvaluatorId] = useState<string>('claude-opus-4.5');
  const [singleJudgeRuns, setSingleJudgeRuns] = useState<SingleJudgeRun[]>([]);

  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeSingleAssistantId, setActiveSingleAssistantId] = useState<string | null>(null);

  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [includeSystemInstruction, setIncludeSystemInstruction] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());
  const [openCell, setOpenCell] = useState<null | { runId: string; primaryId: string; judgeId: string }>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [expandedModal, setExpandedModal] = useState<{
    modelId: string;
    modelName: string;
    modelIcon: string;
    content: string;
    latencyMs: number;
  } | null>(null);

  const [orchestratorModelId, setOrchestratorModelId] = useState<string>('');
  const [orchestrationPrompt, setOrchestrationPrompt] = useState<string>('');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const handleEsc = (e: Event) => {
      const keyEvent = e as unknown as { key: string };
      if (keyEvent.key === 'Escape' && openCell) {
        setOpenCell(null);
      }
      if (keyEvent.key === 'Escape' && isMobileSettingsOpen) {
        setIsMobileSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [openCell, isMobileSettingsOpen]);

  useEffect(() => {
    if (mode !== 'compare') return;
    if (compareRuns.length === 0) {
      setActiveCompareRunId(null);
      return;
    }
    if (!activeCompareRunId || !compareRuns.some((r) => r.id === activeCompareRunId)) {
      setActiveCompareRunId(compareRuns[compareRuns.length - 1].id);
    }
  }, [mode, compareRuns, activeCompareRunId]);

  useEffect(() => {
    if (mode !== 'compare') return;
    const activeRun = compareRuns.find((r) => r.id === activeCompareRunId);
    if (!activeRun) {
      setOrchestratorModelId('');
      setOrchestrationPrompt('');
      return;
    }
    setOrchestratorModelId(activeRun.orchestratorModelId ?? '');
    setOrchestrationPrompt(activeRun.orchestrationPrompt ?? '');
  }, [mode, activeCompareRunId, compareRuns]);

  const checkAuth = async () => {
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/educator/login');
        return;
      }

      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();

      if (!profileData || profileData.role !== 'educator') {
        await supabase.auth.signOut();
        router.push('/educator/login');
        return;
      }

      setProfile(profileData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const activeCompareRun = useMemo(
    () => compareRuns.find((r) => r.id === activeCompareRunId) || null,
    [compareRuns, activeCompareRunId]
  );

  const toggleExpanded = (id: string, type: 'outputs' | 'reports') => {
    const setter = type === 'outputs' ? setExpandedOutputs : setExpandedReports;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;

    const userPrompt = input.trim();
    setInput('');

    if (mode === 'single') {
      const userMessageId = Date.now().toString();
      const assistantMessageId = `${userMessageId}-assistant`;
      const userMessage: Message = {
        id: userMessageId,
        role: 'user',
        content: userPrompt,
        timestamp: new Date()
      };
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        model: selectedModel,
        timestamp: new Date()
      };
      setSingleMessages((prev) => [...prev, userMessage, assistantMessage]);

      setIsProcessing(true);
      setActiveSingleAssistantId(assistantMessageId);
      try {
        await streamSinglePlaygroundResponse({
          modelId: selectedModel,
          prompt: userPrompt,
          config: {
            temperature,
            maxTokens,
            includeSystemInstruction,
            systemPrompt,
          },
        }, {
          onDelta: (chunk) => {
            setSingleMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: `${message.content}${chunk}` }
                  : message
              )
            );
          },
          onDone: (item) => {
            const text = getEnvelopeText(item);
            setSingleMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: text }
                  : message
              )
            );
          },
          onError: (message) => {
            setSingleMessages((prev) =>
              prev.map((entry) =>
                entry.id === assistantMessageId
                  ? { ...entry, content: `Error: ${message}` }
                  : entry
              )
            );
          },
        });
      } catch (error: any) {
        setSingleMessages((prev) =>
          prev.map((entry) =>
            entry.id === assistantMessageId
              ? { ...entry, content: `Error: ${error.message}` }
              : entry
          )
        );
      } finally {
        setIsProcessing(false);
        setActiveSingleAssistantId(null);
      }
      return;
    }

    if (mode === 'compare') {
      if (compareModelIds.length < 1) {
        window.alert('Please select at least 1 model to compare.');
        return;
      }

      const newRun: CompareRun = {
        id: Date.now().toString(),
        prompt: userPrompt,
        modelIds: compareModelIds,
        outputs: compareModelIds.map((modelId) => ({
          kind: 'model_output',
          modelId,
          latencyMs: 0,
          content: { format: 'markdown', value: 'Loading...' },
          structured: null,
          error: null,
        }))
      };

      setCompareRuns((prev) => [...prev, newRun]);
      setActiveCompareRunId(newRun.id);

      setIsProcessing(true);
      try {
        const resp = await apiPost('/api/llm-playground/compare', {
          modelIds: compareModelIds,
          prompt: userPrompt,
          config: {
            temperature,
            maxTokens,
            includeSystemInstruction,
            systemPrompt,
          },
        });

        const env = resp as EnvelopeResponse;
        const items = env.items || [];
        setCompareRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              outputs: items,
            };
          })
        );
      } catch (error: any) {
        setCompareRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              outputs: r.outputs.map((output) => ({
                ...output,
                content: { format: 'markdown', value: `Error: ${error.message}` },
                error: error.message,
                latencyMs: 0,
              })),
            };
          })
        );
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (mode === 'multi-judge') {
      if (multiJudgePrimaryIds.length < 1) {
        window.alert('Please select at least 1 primary model.');
        return;
      }
      if (multiJudgeJudgeIds.length < 1) {
        window.alert('Please select at least 1 judge model.');
        return;
      }

      const newRun: MultiJudgeRun = {
        id: Date.now().toString(),
        prompt: userPrompt,
        primaryModelIds: multiJudgePrimaryIds,
        judgeModelIds: multiJudgeJudgeIds,
        primaryOutputs: multiJudgePrimaryIds.map((id) => ({
          kind: 'model_output',
          modelId: id,
          latencyMs: 0,
          content: { format: 'markdown', value: 'Loading...' },
          structured: null,
          error: null,
        })),
        assessments: [],
        meta: null
      };
      setMultiJudgeRuns((prev) => [...prev, newRun]);

      setIsProcessing(true);
      try {
        const compareResp = await apiPost('/api/llm-playground/compare', {
          modelIds: multiJudgePrimaryIds,
          prompt: userPrompt,
          config: {
            temperature,
            maxTokens,
            includeSystemInstruction,
            systemPrompt,
          },
        });

        const env = compareResp as EnvelopeResponse;
        const primaryEnvelopeItems = env.items || [];
        const primaryOutputsForJudge = toLlmOutputs(primaryEnvelopeItems);

        setMultiJudgeRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              primaryOutputs: primaryEnvelopeItems,
            };
          })
        );

        const judgeResp = await apiPost('/api/llm-playground/judge/multi', {
          judgeModelIds: multiJudgeJudgeIds,
          prompt: userPrompt,
          primaryOutputs: primaryOutputsForJudge,
          config: {
            temperature,
            maxTokens,
            includeSystemInstruction,
            systemPrompt,
          },
        });

        const judgeEnv = judgeResp as EnvelopeResponse;

        setMultiJudgeRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              assessments: judgeEnv.items || [],
              meta: judgeEnv.meta ?? null,
            };
          })
        );
      } catch (error: any) {
        setMultiJudgeRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              meta: { error: `Error: ${error.message}` },
            };
          })
        );
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (mode === 'single-judge') {
      if (singleJudgePrimaryIds.length < 1) {
        window.alert('Please select at least 1 primary model.');
        return;
      }
      if (!singleJudgeEvaluatorId) {
        window.alert('Please select an evaluator model.');
        return;
      }

      const newRun: SingleJudgeRun = {
        id: Date.now().toString(),
        prompt: userPrompt,
        primaryModelIds: singleJudgePrimaryIds,
        evaluatorModelId: singleJudgeEvaluatorId,
        primaryOutputs: singleJudgePrimaryIds.map((id) => ({
          kind: 'model_output',
          modelId: id,
          latencyMs: 0,
          content: { format: 'markdown', value: 'Loading...' },
          structured: null,
          error: null,
        })),
        report: 'Loading...',
        latencyMs: 0,
        structured: null,
      };
      setSingleJudgeRuns((prev) => [...prev, newRun]);

      setIsProcessing(true);
      try {
        const compareResp = await apiPost('/api/llm-playground/compare', {
          modelIds: singleJudgePrimaryIds,
          prompt: userPrompt,
          config: {
            temperature,
            maxTokens,
            includeSystemInstruction,
            systemPrompt,
          },
        });

        const env = compareResp as EnvelopeResponse;
        const primaryEnvelopeItems = env.items || [];
        const primaryOutputsForJudge = toLlmOutputs(primaryEnvelopeItems);

        setSingleJudgeRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              primaryOutputs: primaryEnvelopeItems,
            };
          })
        );

        const judgeResp = await apiPost('/api/llm-playground/judge/single', {
          evaluatorModelId: singleJudgeEvaluatorId,
          prompt: userPrompt,
          primaryOutputs: primaryOutputsForJudge,
          config: {
            temperature,
            maxTokens,
            includeSystemInstruction,
            systemPrompt,
          },
        });

        const judgeEnv = judgeResp as EnvelopeResponse;
        const item = judgeEnv.items?.[0];
        const report = getEnvelopeText(item);
        const structured = (item?.structured as SingleJudgeStructured | undefined) ?? null;

        setSingleJudgeRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              report,
              latencyMs: item?.latencyMs || 0,
              structured,
            };
          })
        );
      } catch (error: any) {
        setSingleJudgeRuns((prev) =>
          prev.map((r) => {
            if (r.id !== newRun.id) return r;
            return {
              ...r,
              report: `Error: ${error.message}`,
              latencyMs: 0,
              structured: null,
            };
          })
        );
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleGenerateFinalAnswer = async () => {
    if (!activeCompareRunId) return;

    const activeRun = compareRuns.find((r) => r.id === activeCompareRunId);
    if (!activeRun) {
      window.alert('Active compare run not found.');
      return;
    }

    if (!orchestratorModelId) {
      window.alert('Please select an orchestrator model.');
      return;
    }

    setIsProcessing(true);
    try {
      const resp = await apiPost('/api/llm-playground/orchestrate', {
        orchestratorModelId,
        prompt: activeRun.prompt,
        outputs: toLlmOutputs(activeRun.outputs),
        orchestrationPrompt: orchestrationPrompt || undefined,
        config: {
          temperature,
          maxTokens: 300,
          includeSystemInstruction,
          systemPrompt,
        },
      });

      const env = resp as EnvelopeResponse;
      const item = env.items?.[0];

      const finalAnswer =
        item?.structured?.finalAnswer ??
        getEnvelopeText(item);

      const rationale =
        item?.structured?.rationale ?? '';

      setCompareRuns((prev) =>
        prev.map((run) => {
          if (run.id !== activeCompareRunId) return run;

          const userMessage: Message = {
            id: `${Date.now()}u`,
            role: 'user',
            content: activeRun.prompt,
            timestamp: new Date()
          };
          const assistantMessage: Message = {
            id: `${Date.now()}a`,
            role: 'assistant',
            content: finalAnswer,
            timestamp: new Date()
          };

          return {
            ...run,
            finalAnswer,
            rationale,
            orchestratorModelId,
            orchestrationPrompt: orchestrationPrompt || undefined,
            orchestratedThread: [userMessage, assistantMessage]
          };
        })
      );
    } catch (error: any) {
      setCompareRuns((prev) =>
        prev.map((run) => {
          if (run.id !== activeCompareRunId) return run;
          return {
            ...run,
            finalAnswer: `Error: ${error.message}`,
            rationale: '',
            orchestratorModelId,
            orchestrationPrompt: orchestrationPrompt || undefined,
          };
        })
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearChat = () => {
    if (!confirm('Are you sure you want to clear the chat history?')) return;

    if (mode === 'single') {
      setSingleMessages([]);
    } else if (mode === 'compare') {
      setCompareRuns([]);
      setActiveCompareRunId(null);
      setOrchestratorModelId('');
      setOrchestrationPrompt('');
    } else if (mode === 'multi-judge') {
      setMultiJudgeRuns([]);
    } else if (mode === 'single-judge') {
      setSingleJudgeRuns([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getPlaceholder = () => {
    switch (mode) {
      case 'single':
        return `Ask ${AI_MODELS.find((m) => m.id === selectedModel)?.name} anything...`;
      case 'compare':
        return activeCompareRun?.orchestratedThread ? 'Continue the conversation...' : 'Ask selected models the same question (then orchestrate)...';
      case 'multi-judge':
        return 'Enter a prompt to evaluate for safety risks (multi-judge)...';
      case 'single-judge':
        return 'Enter a prompt to evaluate for safety risks (single-judge)...';
      default:
        return 'Type your message...';
    }
  };

  const getModeTitle = () => {
    switch (mode) {
      case 'single':
        return 'Single Model';
      case 'compare':
        return 'Compare & Orchestrate';
      case 'multi-judge':
        return 'Multi-Judge Evaluation';
      case 'single-judge':
        return 'Single-Judge Evaluation';
      default:
        return 'Settings';
    }
  };

  const getGridCols = (count: number) => {
    if (count <= 1) return 'lg:grid-cols-1';
    if (count === 2) return 'lg:grid-cols-2';
    return 'lg:grid-cols-3';
  };

  const renderSingleSidebar = () => (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">Select AI Model</h3>
        <div className="space-y-2">
          {AI_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              className={`w-full p-4 rounded-xl text-left transition-all ${
                selectedModel === model.id ? 'bg-red-50 border-2 border-brand-maroon' : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{model.icon}</span>
                <div className="flex-1">
                  <div className="font-semibold text-gray-900">{model.name}</div>
                  <div className="text-sm text-gray-600">{model.provider}</div>
                </div>
              </div>
              {selectedModel === model.id && <div className="w-full h-1 bg-green-500 rounded-full" />}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-4 border-t border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Generation Settings</h3>
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
    </div>
  );

  const renderCompareSidebar = () => (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-2">Compare and Orchestrate</h3>
        <p className="text-sm text-gray-600 mb-4">Select which models to compare.</p>

        <div className="space-y-2 mb-4">
          <div className="text-sm font-medium text-gray-700 mb-2">Models to Compare:</div>
          {AI_MODELS.map((model) => (
            <label
              key={model.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={compareModelIds.includes(model.id)}
                onChange={(e) => {
                  if (e.target.checked) setCompareModelIds((prev) => [...prev, model.id]);
                  else setCompareModelIds((prev) => prev.filter((id) => id !== model.id));
                }}
                className="w-4 h-4 text-brand-maroon focus:ring-brand-maroon border-gray-300 rounded"
              />
              <span className="text-xl">{model.icon}</span>
              <span className="font-medium text-gray-900 text-sm">{model.name}</span>
            </label>
          ))}
        </div>

        <div className="text-xs text-gray-500">
          Tip: Orchestration appears inside each run after the side-by-side outputs.
        </div>
      </div>

      <div className="pt-4 border-t border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Generation Settings</h3>
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
    </div>
  );

  const renderMultiJudgeSidebar = () => (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-2">Multi-Judge Evaluation</h3>
        <p className="text-sm text-gray-600 mb-4">Multiple judges will evaluate prompts generated by primary models.</p>

        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Primary Models:</div>
            {AI_MODELS.map((model) => (
              <label
                key={model.id}
                className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer mb-2"
              >
                <input
                  type="checkbox"
                  checked={multiJudgePrimaryIds.includes(model.id)}
                  onChange={(e) => {
                    if (e.target.checked) setMultiJudgePrimaryIds((prev) => [...prev, model.id]);
                    else setMultiJudgePrimaryIds((prev) => prev.filter((id) => id !== model.id));
                  }}
                  className="w-4 h-4 text-brand-maroon focus:ring-brand-maroon border-gray-300 rounded"
                />
                <span className="text-lg">{model.icon}</span>
                <span className="font-medium text-gray-900 text-sm">{model.name}</span>
              </label>
            ))}
          </div>

          <div className="border-t border-gray-200 pt-3">
            <div className="text-sm font-medium text-gray-700 mb-2">Judge Models:</div>
            {AI_MODELS.map((model) => (
              <label
                key={model.id}
                className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer mb-2"
              >
                <input
                  type="checkbox"
                  checked={multiJudgeJudgeIds.includes(model.id)}
                  onChange={(e) => {
                    if (e.target.checked) setMultiJudgeJudgeIds((prev) => [...prev, model.id]);
                    else setMultiJudgeJudgeIds((prev) => prev.filter((id) => id !== model.id));
                  }}
                  className="w-4 h-4 text-brand-maroon focus:ring-brand-maroon border-gray-300 rounded"
                />
                <span className="text-lg">{model.icon}</span>
                <span className="font-medium text-gray-900 text-sm">{model.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Generation Settings</h3>
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
    </div>
  );

  const renderSingleJudgeSidebar = () => (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-2">Single-Judge Evaluation</h3>
        <p className="text-sm text-gray-600 mb-4">One evaluator will provide detailed assessment of prompts from primary models.</p>

        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Primary Models:</div>
            {AI_MODELS.map((model) => (
              <label
                key={model.id}
                className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer mb-2"
              >
                <input
                  type="checkbox"
                  checked={singleJudgePrimaryIds.includes(model.id)}
                  onChange={(e) => {
                    if (e.target.checked) setSingleJudgePrimaryIds((prev) => [...prev, model.id]);
                    else setSingleJudgePrimaryIds((prev) => prev.filter((id) => id !== model.id));
                  }}
                  className="w-4 h-4 text-brand-maroon focus:ring-brand-maroon border-gray-300 rounded"
                />
                <span className="text-lg">{model.icon}</span>
                <span className="font-medium text-gray-900 text-sm">{model.name}</span>
              </label>
            ))}
          </div>

          <div className="border-t border-gray-200 pt-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">Evaluator Model</label>
            <select
              value={singleJudgeEvaluatorId}
              onChange={(e) => setSingleJudgeEvaluatorId(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent text-sm"
            >
              {AI_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-gray-200">
        <h3 className="font-semibold text-gray-900 mb-3">Generation Settings</h3>
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
    </div>
  );

  const renderSidebarForMode = (currentMode: Mode) => {
    switch (currentMode) {
      case 'single':
        return renderSingleSidebar();
      case 'compare':
        return renderCompareSidebar();
      case 'multi-judge':
        return renderMultiJudgeSidebar();
      case 'single-judge':
        return renderSingleJudgeSidebar();
      default:
        return null;
    }
  };

  const renderCompareRuns = () => {
    const activeRun = compareRuns.find(r => r.id === activeCompareRunId);

    if (!activeRun) {
      return (
        <div className="h-full overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-2">
                <ArrowLeftRight className="w-5 h-5 text-brand-maroon" />
                <h3 className="font-semibold text-gray-900">Compare and Orchestrate</h3>
              </div>
              <p className="text-sm text-gray-600">Send a prompt to create your first compare run.</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full overflow-hidden">
        <div className="h-full overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-5 h-5 text-brand-maroon" />
                  <h3 className="font-semibold text-gray-900">Compare and Orchestrate Run</h3>
                </div>
                <p className="text-sm text-gray-600 mt-1">{activeRun.prompt}</p>
              </div>

              <div className="p-4 space-y-4">
                <div className={`grid grid-cols-1 ${getGridCols(activeRun.outputs.length)} gap-4`}>
                  {activeRun.outputs.map((output) => {
                    const model = AI_MODELS.find(m => m.id === output.modelId);
                    return (
                      <div key={output.modelId} className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-gray-100 px-3 py-2 border-b border-gray-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{model?.icon}</span>
                              <div>
                                <div className="font-medium text-gray-900 text-sm">{model?.name}</div>
                                <div className="text-xs text-gray-500">
                                  {output.latencyMs > 0 ? `${output.latencyMs}ms` : 'Pending'}
                                </div>
                              </div>
                            </div>
                            <ExpandButton
                              onClick={() =>
                                setExpandedModal({
                                  modelId: output.modelId,
                                  modelName: model?.name || output.modelId,
                                  modelIcon: model?.icon || '🤖',
                                  content: getEnvelopeText(output),
                                  latencyMs: output.latencyMs || 0,
                                })
                              }
                            />
                          </div>
                        </div>
                        <div className="p-3">
                          <Markdown value={getEnvelopeText(output)} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {activeRun.finalAnswer && activeRun.rationale ? (
                  <>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-green-600" />
                        <h4 className="font-semibold text-green-900 text-sm">Final Answer</h4>
                      </div>
                      <Markdown value={activeRun.finalAnswer} />
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-900 mb-2 text-sm">Rationale</h4>
                      <Markdown value={activeRun.rationale} />
                    </div>

                    <button
                      onClick={() => toggleExpanded(activeRun.id, 'outputs')}
                      className="flex items-center gap-2 text-sm text-brand-maroon hover:text-red-800 font-medium"
                    >
                      {expandedOutputs.has(activeRun.id) ? (
                        <>
                          <span>Hide Individual Outputs</span>
                          <ChevronUp className="w-4 h-4" />
                        </>
                      ) : (
                        <>
                          <span>View Individual Model Outputs</span>
                          <ChevronDown className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    {expandedOutputs.has(activeRun.id) && (
                      <div className={`grid grid-cols-1 ${getGridCols(activeRun.outputs.length)} gap-4 pt-2`}>
                        {activeRun.outputs.map((output) => {
                          const model = AI_MODELS.find(m => m.id === output.modelId);
                          return (
                            <div key={`${activeRun.id}-${output.modelId}`} className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
                              <div className="bg-gray-100 px-3 py-2 border-b border-gray-200">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{model?.icon}</span>
                                    <div>
                                      <div className="font-medium text-gray-900 text-xs">{model?.name}</div>
                                      <div className="text-xs text-gray-500">{output.latencyMs}ms</div>
                                    </div>
                                  </div>
                                  <ExpandButton
                                    onClick={() =>
                                      setExpandedModal({
                                        modelId: output.modelId,
                                        modelName: model?.name || output.modelId,
                                        modelIcon: model?.icon || '🤖',
                                        content: getEnvelopeText(output),
                                        latencyMs: output.latencyMs || 0,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                              <div className="p-3">
                                <Markdown value={getEnvelopeText(output)} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {activeRun.orchestratedThread && (
                      <div className="border-t border-gray-200 pt-4 mt-2">
                        <h4 className="font-semibold text-gray-900 mb-3 text-sm">Conversation Thread</h4>
                        <div className="space-y-3">
                          {activeRun.orchestratedThread.map((message) => (
                            <div
                              key={message.id}
                              className={`flex gap-3 ${
                                message.role === 'user' ? 'justify-end' : 'justify-start'
                              }`}
                            >
                              {message.role === 'assistant' && (
                                <div className="w-8 h-8 bg-brand-maroon rounded-full flex items-center justify-center flex-shrink-0">
                                  <Bot className="w-5 h-5 text-white" />
                                </div>
                              )}
                              <div
                                className={`max-w-2xl rounded-2xl px-4 py-3 ${
                                  message.role === 'user'
                                    ? 'bg-brand-maroon text-white'
                                    : 'bg-white text-gray-900 border border-gray-200'
                                }`}
                              >
                                <Markdown value={message.content} />
                              </div>
                              {message.role === 'user' && (
                                <div className="w-8 h-8 bg-brand-yellow rounded-full flex items-center justify-center flex-shrink-0 font-bold text-gray-900">
                                  {profile?.first_name?.[0]}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-brand-maroon" />
                      Orchestration (optional)
                    </h4>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Orchestrator Model
                        </label>
                        <select
                          value={orchestratorModelId}
                          onChange={(e) => setOrchestratorModelId(e.target.value)}
                          className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent text-sm"
                        >
                          <option value="">None</option>
                          {AI_MODELS.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {orchestratorModelId && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Orchestration Prompt (optional)
                            </label>
                            <textarea
                              value={orchestrationPrompt}
                              onChange={(e) => setOrchestrationPrompt(e.target.value)}
                              placeholder="e.g., Synthesize all responses into a comprehensive answer..."
                              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent text-sm resize-none"
                              rows={3}
                            />
                          </div>

                          <button
                            onClick={handleGenerateFinalAnswer}
                            disabled={isProcessing}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-maroon text-white rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                          >
                            <Sparkles className="w-4 h-4" />
                            Generate Final Answer
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {isProcessing && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-center gap-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-brand-maroon rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-brand-maroon rounded-full animate-bounce delay-100"></div>
                    <div className="w-2 h-2 bg-brand-maroon rounded-full animate-bounce delay-200"></div>
                  </div>
                  <span className="text-gray-600 font-medium">Processing...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAssessmentPopup = () => {
    if (!openCell) return null;

    const run = multiJudgeRuns.find(r => r.id === openCell.runId);
    if (!run) return null;

    const judgeItem = run.assessments.find(a => a.modelId === openCell.judgeId);
    if (!judgeItem) return null;

    const assessments = (judgeItem.structured?.assessments || []) as JudgeAssessment[];
    const assessment = assessments.find(a => a.targetModelId === openCell.primaryId);

    const judgeModel = AI_MODELS.find(m => m.id === openCell.judgeId);
    const primaryModel = AI_MODELS.find(m => m.id === openCell.primaryId);

    return (
      <>
        <div
          className="fixed inset-0 bg-black/50 z-50"
          onClick={() => setOpenCell(null)}
        />
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
          <div className="bg-white rounded-xl border border-gray-300 shadow-2xl">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{judgeModel?.icon}</span>
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {judgeModel?.name} assessed {primaryModel?.name}
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Judge: {openCell.judgeId} → Primary: {openCell.primaryId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpenCell(null)}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {assessment ? (
                <>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldAlert className="w-4 h-4 text-gray-700" />
                      <h4 className="font-semibold text-gray-900 text-sm">Risk Assessment</h4>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center px-3 py-1.5 rounded-md border font-semibold text-sm ${badgeClassForRisk(
                          assessment.risk_label
                        )}`}
                      >
                        {String(assessment.risk_label || 'MEDIUM').toUpperCase()}
                      </span>
                      <span className="text-gray-700 font-medium">
                        Score: <span className="font-bold">{safeNumber(assessment.risk_score, 0)}</span>
                      </span>
                    </div>
                  </div>

                  {assessment.failure_modes && assessment.failure_modes.length > 0 && (
                    <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                      <h4 className="font-semibold text-red-900 text-sm mb-2">Failure Modes</h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-red-800">
                        {assessment.failure_modes.map((mode, idx) => (
                          <li key={idx}>{mode}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {assessment.evidence && assessment.evidence.length > 0 && (
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                      <h4 className="font-semibold text-blue-900 text-sm mb-2">Evidence</h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-blue-800">
                        {assessment.evidence.map((ev, idx) => (
                          <li key={idx}>{ev}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {assessment.notes && (
                    <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                      <h4 className="font-semibold text-yellow-900 text-sm mb-2">Notes</h4>
                      <p className="text-sm text-yellow-800">{assessment.notes}</p>
                    </div>
                  )}

                  {assessment.latencyMs != null && assessment.latencyMs > 0 && (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-semibold text-gray-900 text-sm mb-1">Performance</h4>
                      <p className="text-sm text-gray-700">Latency: <span className="font-medium">{assessment.latencyMs}ms</span></p>
                    </div>
                  )}

                  {assessment.error && (
                    <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                      <h4 className="font-semibold text-red-900 text-sm mb-2">Error</h4>
                      <p className="text-sm text-red-800">{assessment.error}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">
                    No detailed assessment available. Displaying raw content:
                  </p>
                  <div className="mt-3 p-3 bg-white rounded border border-gray-200">
                    <Markdown value={judgeItem.content?.value || 'No content'} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderMultiJudgeRuns = () => (
    <div className="space-y-6">
      {multiJudgeRuns.map((run) => {
        const isStillLoadingPrimary = run.primaryOutputs.some((o) => o.content?.value === 'Loading...');
        const isLoading = run.meta === null;
        const hasError = run.meta && typeof run.meta === 'object' && 'error' in run.meta;

        return (
          <div key={run.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-brand-maroon" />
                <h3 className="font-semibold text-gray-900">Multi-Judge Evaluation</h3>
              </div>
              <p className="text-sm text-gray-600 mt-1">{run.prompt}</p>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">Primary Model Outputs</h4>

                {isStillLoadingPrimary ? (
                  <p className="text-sm text-gray-500 italic">Loading primary outputs...</p>
                ) : (
                  <div className={`grid grid-cols-1 ${getGridCols(run.primaryOutputs.length)} gap-4`}>
                    {run.primaryOutputs.map((output) => {
                      const model = AI_MODELS.find((m) => m.id === output.modelId);
                      return (
                        <div key={output.modelId} className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
                          <div className="bg-gray-100 px-3 py-2 border-b border-gray-200">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{model?.icon}</span>
                                <div>
                                  <div className="font-medium text-gray-900 text-sm">{model?.name}</div>
                                  <div className="text-xs text-gray-500">
                                    {output.latencyMs > 0 ? `${output.latencyMs}ms` : '—'}
                                  </div>
                                </div>
                              </div>
                              <ExpandButton
                                onClick={() =>
                                  setExpandedModal({
                                    modelId: output.modelId,
                                    modelName: model?.name || output.modelId,
                                    modelIcon: model?.icon || '🤖',
                                    content: getEnvelopeText(output),
                                    latencyMs: output.latencyMs || 0,
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div className="p-3">
                            <Markdown value={getEnvelopeText(output)} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-3">Judge Assessments (Matrix)</h4>

                {hasError ? (
                  <p className="text-sm text-red-600">{(run.meta as any).error}</p>
                ) : isLoading ? (
                  <p className="text-sm text-gray-500 italic">Waiting for judges...</p>
                ) : run.assessments.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No assessments returned.</p>
                ) : (
                  (() => {
                    const judgeItems = run.assessments;
                    const judgeIds = judgeItems.map((j) => j.modelId);
                    const targetIds = run.primaryModelIds;

                    const matrix: Record<string, Record<string, JudgeAssessment | null>> = {};
                    for (const j of judgeItems) {
                      const perTarget = (j.structured?.assessments || []) as JudgeAssessment[];
                      const byTarget: Record<string, JudgeAssessment> = {};
                      for (const a of perTarget) byTarget[a.targetModelId] = a;
                      matrix[j.modelId] = {};
                      for (const t of targetIds) matrix[j.modelId][t] = byTarget[t] ?? null;
                    }

                    const consensus: Record<string, { mean: number; min: number; max: number }> = {};
                    for (const t of targetIds) {
                      const scores = judgeIds
                        .map((jid) => matrix[jid]?.[t]?.risk_score)
                        .filter((v) => v != null)
                        .map((v) => safeNumber(v, 0));

                      if (!scores.length) {
                        consensus[t] = { mean: 0, min: 0, max: 0 };
                      } else {
                        const sum = scores.reduce((a, b) => a + b, 0);
                        consensus[t] = {
                          mean: sum / scores.length,
                          min: Math.min(...scores),
                          max: Math.max(...scores),
                        };
                      }
                    }

                    return (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-200 rounded-lg overflow-hidden">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left text-xs font-semibold text-gray-700 px-3 py-2 border-b border-gray-200">
                                Primary Model
                              </th>

                              {judgeIds.map((jid) => {
                                const jm = AI_MODELS.find((m) => m.id === jid);
                                return (
                                  <th
                                    key={jid}
                                    className="text-left text-xs font-semibold text-gray-700 px-3 py-2 border-b border-gray-200"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-base">{jm?.icon}</span>
                                      <span>{jm?.name ?? jid}</span>
                                    </div>
                                  </th>
                                );
                              })}

                              <th className="text-left text-xs font-semibold text-gray-700 px-3 py-2 border-b border-gray-200">
                                Consensus
                              </th>
                            </tr>
                          </thead>

                          <tbody className="bg-white">
                            {targetIds.map((tid) => {
                              const tm = AI_MODELS.find((m) => m.id === tid);
                              const c = consensus[tid];

                              return (
                                <tr key={tid} className="border-b border-gray-100">
                                  <td className="px-3 py-3 text-sm text-gray-900">
                                    <div className="flex items-center gap-2">
                                      <span className="text-lg">{tm?.icon}</span>
                                      <div>
                                        <div className="font-medium">{tm?.name ?? tid}</div>
                                        <div className="text-xs text-gray-500">{tid}</div>
                                      </div>
                                    </div>
                                  </td>

                                  {judgeIds.map((jid) => {
                                    const a = matrix[jid]?.[tid] ?? null;

                                    if (!a) {
                                      return (
                                        <td key={`${tid}-${jid}`} className="px-3 py-3 text-sm text-gray-500">
                                          —
                                        </td>
                                      );
                                    }

                                    const badgeCls = badgeClassForRisk(a.risk_label);

                                    return (
                                      <td key={`${tid}-${jid}`} className="px-3 py-3">
                                        <button
                                          onClick={() => setOpenCell({ runId: run.id, primaryId: tid, judgeId: jid })}
                                          className={`inline-flex items-center gap-2 px-2 py-1 rounded-md border text-xs font-semibold cursor-pointer transition-all hover:shadow-md hover:scale-105 ${badgeCls}`}
                                        >
                                          <span>{String(a.risk_label || "MEDIUM").toUpperCase()}</span>
                                          <span className="opacity-80">({safeNumber(a.risk_score, 0)})</span>
                                        </button>
                                        {a.failure_modes?.length ? (
                                          <div className="mt-1 text-[11px] text-gray-500 line-clamp-1" title={a.failure_modes.join(", ")}>
                                            {a.failure_modes.join(", ")}
                                          </div>
                                        ) : null}
                                      </td>
                                    );
                                  })}

                                  <td className="px-3 py-3 text-sm">
                                    <div className="text-xs text-gray-700">
                                      <div>
                                        <span className="font-semibold">Mean:</span>{" "}
                                        {Number.isFinite(c.mean) ? c.mean.toFixed(1) : "—"}
                                      </div>
                                      <div className="text-[11px] text-gray-500">
                                        Min/Max: {c.min} / {c.max}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        <p className="text-xs text-gray-500 mt-2">
                          Click any cell to see detailed assessment including failure modes, evidence, notes, and latency.
                        </p>
                      </div>
                    );
                  })()
                )}
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">Meta (Debug)</h4>
                <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg overflow-x-auto">
                  {JSON.stringify(run.meta, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderSingleJudgeRuns = () => (
    <div className="space-y-6">
      {singleJudgeRuns.map((run) => {
        const evaluator = AI_MODELS.find((m) => m.id === run.evaluatorModelId);
        const isStillLoadingPrimary = run.primaryOutputs.some((o) => o.content?.value === 'Loading...');
        const isLoading = !run.report || run.report === '';
        const structured = run.structured;

        const renderSingleJudgeReport = () => {
          if (!structured) {
            return <Markdown value={run.report} />;
          }

          return (
            <div className="space-y-8">
              <section className="bg-stone-50 border border-stone-200 rounded-xl p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h4 className="text-xs font-semibold tracking-[0.2em] text-gray-500 uppercase">Overall Hallucination Risk</h4>
                    <h5 className="mt-5 text-2xl font-black tracking-tight text-gray-900 uppercase">Risk Summary</h5>
                    <p className="mt-3 text-base text-gray-700 leading-7">{structured.riskSummary}</p>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${singleJudgeRiskClass(structured.overallHallucinationRisk)}`}>
                    {formatJudgeLabel(structured.overallHallucinationRisk)}
                  </span>
                </div>
              </section>

              <section>
                <h4 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Cross-Model Analysis</h4>
                <div className="mt-4 overflow-x-auto border border-gray-200 bg-white">
                  <table className="min-w-full text-[13px]">
                    <thead className="bg-stone-50">
                      <tr>
                        <th className="border-b border-r border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">Topic/Claim</th>
                        <th className="border-b border-r border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">Agreement Level</th>
                        <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">Risk Flag</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {structured.crossModelAnalysis.map((item, idx) => (
                        <tr key={`${run.id}-cross-${idx}`} className="border-t border-gray-100">
                          <td className="border-r border-gray-200 px-3 py-2 text-gray-900">{item.topicOrClaim}</td>
                          <td className={`border-r border-gray-200 px-3 py-2 font-semibold ${agreementLevelClass(item.agreementLevel)} ${agreementLevelCellClass(item.agreementLevel)}`}>
                            <span className="inline-flex items-center gap-2">
                              {formatAgreementLevel(item.agreementLevel).toLowerCase().includes('full') ? (
                                <Check className="h-3.5 w-3.5 text-green-600" strokeWidth={3} />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 fill-amber-100" strokeWidth={2.5} />
                              )}
                              <span>{formatAgreementLevel(item.agreementLevel)}</span>
                            </span>
                          </td>
                          <td className={`px-3 py-2 font-semibold ${riskFlagClass(item.riskFlag)} ${riskFlagCellClass(item.riskFlag)}`}>{formatRiskFlag(item.riskFlag)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h4 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Claims Requiring User Verification</h4>
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-900">Critical - Do Not Trust Without Verification</p>
                  <ol className="mt-4 space-y-5">
                    {structured.claimsRequiringVerification.map((claim, idx) => (
                      <li key={`${run.id}-claim-${idx}`} className="text-sm text-gray-800">
                        <p className="font-semibold">{idx + 1}. {claim.claim}</p>
                        <p className="mt-2 leading-6"><span className="font-medium">Why critical:</span> {claim.why}</p>
                        <p className="mt-1 leading-6"><span className="font-medium">Verification method:</span> {claim.suggestedVerification}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>

              <section>
                <h4 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Cost-of-Error Assessment</h4>
                <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
                  <div className="space-y-3 text-sm text-gray-800">
                    <p><span className="font-semibold">Domain:</span> {structured.costOfError.domain}</p>
                    <p><span className="font-semibold">Potential Impact if Wrong:</span> {structured.costOfError.potentialImpactIfWrong}</p>
                    <p><span className="font-semibold">Recommended Verification Level:</span> {structured.costOfError.recommendedVerificationLevel}</p>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Model-by-Model Assessment</h4>
                <div className="mt-4 space-y-6">
                  {structured.modelByModel.map((assessment) => {
                    const model = AI_MODELS.find((item) => item.id === assessment.modelId);
                    return (
                      <div key={`${run.id}-${assessment.modelId}-assessment`} className="rounded-xl border border-gray-200 bg-white p-5">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{model?.icon ?? '•'}</span>
                          <div>
                            <h5 className="text-xl font-bold text-gray-900">{model?.name ?? assessment.modelId}</h5>
                            <p className="text-sm text-gray-500">{assessment.modelId}</p>
                          </div>
                        </div>

                        <div className="mt-4 space-y-4 text-sm text-gray-800">
                          <p>
                            <span className="font-semibold">Hallucination Risk Level:</span>{' '}
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${singleJudgeRiskClass(assessment.riskLevel)}`}>
                              {formatJudgeLabel(assessment.riskLevel)}
                            </span>
                          </p>

                          <div>
                            <p className="font-semibold">Confidence Indicators:</p>
                            <ul className="mt-2 space-y-2">
                              {assessment.confidenceIndicators.map((item, idx) => (
                                <li key={`${assessment.modelId}-indicator-${idx}`} className="flex gap-2">
                                  <span className="text-green-600">+</span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div>
                            <p className="font-semibold">Specific Concerns:</p>
                            <ul className="mt-2 space-y-2">
                              {assessment.concerns.map((item, idx) => (
                                <li key={`${assessment.modelId}-concern-${idx}`} className="flex gap-2">
                                  <span className="text-red-600">-</span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h4 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Safe-to-Trust Elements</h4>
                <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-5">
                  <ol className="space-y-2 text-sm text-gray-800">
                    {structured.safeToTrustElements.map((item, idx) => (
                      <li key={`${run.id}-safe-${idx}`} className="flex gap-3">
                        <span className="font-semibold text-green-700">{idx + 1}.</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>

              <section>
                <h4 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Recommendations for User</h4>
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-5">
                  <ol className="space-y-4 text-sm text-gray-800">
                    {structured.recommendationsForUser.map((item, idx) => (
                      <li key={`${run.id}-recommendation-${idx}`} className="flex gap-3">
                        <span className="font-semibold text-blue-700">{idx + 1}.</span>
                        <span className="leading-6">{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
            </div>
          );
        };

        return (
          <div key={run.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-brand-maroon" />
                  <h3 className="font-semibold text-gray-900">Single-Judge Evaluation</h3>
                </div>
                {run.primaryOutputs.length > 0 && !isStillLoadingPrimary && (
                  <button
                    onClick={() => toggleExpanded(run.id, 'reports')}
                    className="flex items-center gap-2 text-sm text-brand-maroon hover:text-red-800 font-medium"
                  >
                    {expandedReports.has(run.id) ? (
                      <>
                        <span>Collapse</span>
                        <ChevronUp className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        <span>Expand Details</span>
                        <ChevronDown className="w-4 h-4" />
                      </>
                    )}
                  </button>
                )}
              </div>

              <p className="text-sm text-gray-600 mb-3">{run.prompt}</p>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span className="text-lg">{evaluator?.icon}</span>
                <span>{evaluator?.name}</span>
                {run.latencyMs > 0 && <span>• {run.latencyMs}ms</span>}
              </div>
            </div>

            <div className="px-6 py-4 space-y-4">
              {!expandedReports.has(run.id) && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Evaluation Report</h4>

                  {isStillLoadingPrimary ? (
                    <p className="text-sm text-gray-500 italic">Loading primary outputs...</p>
                  ) : isLoading ? (
                    <p className="text-sm text-gray-500 italic">Waiting for evaluation...</p>
                  ) : (
                    renderSingleJudgeReport()
                  )}
                </div>
              )}

              {expandedReports.has(run.id) && (
                <>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Primary Model Outputs</h4>

                    {isStillLoadingPrimary ? (
                      <p className="text-sm text-gray-500 italic">Loading primary outputs...</p>
                    ) : (
                      <div className={`grid grid-cols-1 ${getGridCols(run.primaryModelIds.length)} gap-4`}>
                        {run.primaryModelIds.map((modelId) => {
                          const output = run.primaryOutputs.find((o) => o.modelId === modelId);
                          const model = AI_MODELS.find((m) => m.id === modelId);

                          return (
                            <div
                              key={`${run.id}-${modelId}`}
                              className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden"
                            >
                              <div className="bg-gray-100 px-3 py-2 border-b border-gray-200">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{model?.icon}</span>
                                    <div>
                                      <div className="font-medium text-gray-900 text-sm">{model?.name}</div>
                                      <div className="text-xs text-gray-500">
                                        {output?.latencyMs && output.latencyMs > 0 ? `${output.latencyMs}ms` : '—'}
                                      </div>
                                    </div>
                                  </div>
                                  <ExpandButton
                                    onClick={() =>
                                      setExpandedModal({
                                        modelId: modelId,
                                        modelName: model?.name || modelId,
                                        modelIcon: model?.icon || '🤖',
                                        content: getEnvelopeText(output),
                                        latencyMs: output?.latencyMs || 0,
                                      })
                                    }
                                  />
                                </div>
                              </div>

                              <div className="p-3">
                                <Markdown
                                  value={getEnvelopeText(output)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Evaluation Report</h4>

                    {isStillLoadingPrimary ? (
                      <p className="text-sm text-gray-500 italic">Waiting for primary outputs...</p>
                    ) : isLoading ? (
                      <p className="text-sm text-gray-500 italic">Waiting for evaluation...</p>
                    ) : (
                      renderSingleJudgeReport()
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const messageCount =
    mode === 'single'
      ? singleMessages.filter((m) => m.role === 'user').length
      : mode === 'compare'
      ? compareRuns.length
      : mode === 'multi-judge'
      ? multiJudgeRuns.length
      : singleJudgeRuns.length;

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-maroon border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <EducatorLayout profile={profile}>
      {renderAssessmentPopup()}
      <ModelOutputExpandModal
        isOpen={expandedModal !== null}
        onClose={() => setExpandedModal(null)}
        modelName={expandedModal?.modelName || ''}
        modelIcon={expandedModal?.modelIcon}
        content={expandedModal?.content || ''}
        latencyMs={expandedModal?.latencyMs}
      />
      <div className="h-[calc(100vh-80px)] flex flex-col">
        <div className="bg-brand-maroon text-white px-6 py-4 rounded-t-2xl">
          <h1 className="text-2xl font-bold">LLM Playground</h1>
          <p className="text-sm text-white/90 mt-1">Chat with AI models - gpt-5.2-chat, Gemini 2.5-Flash, and Claude Opus 4.5</p>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-b">
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-2 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
              <button
                onClick={() => setMode('single')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all text-sm ${
                  mode === 'single' ? 'bg-brand-maroon text-white shadow-md' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Single Model
              </button>

              <button
                onClick={() => setMode('compare')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all text-sm ${
                  mode === 'compare' ? 'bg-brand-maroon text-white shadow-md' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <ArrowLeftRight className="w-4 h-4" />
                Compare and Orchestrate
              </button>

              <button
                onClick={() => setMode('multi-judge')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all text-sm ${
                  mode === 'multi-judge' ? 'bg-brand-maroon text-white shadow-md' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Users className="w-4 h-4" />
                Multi Judge
              </button>

              <button
                onClick={() => setMode('single-judge')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all text-sm ${
                  mode === 'single-judge' ? 'bg-brand-maroon text-white shadow-md' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <User className="w-4 h-4" />
                Single Judge
              </button>
            </div>

            <button
              onClick={() => setIsMobileSettingsOpen(true)}
              className="lg:hidden flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
            >
              <Menu className="w-4 h-4" />
              Settings
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className={`hidden lg:block bg-white border-r border-gray-200 overflow-y-auto transition-all duration-200 ${isSidebarCollapsed ? 'w-16' : 'w-80'}`}>
            {isSidebarCollapsed ? (
              <div className="flex flex-col items-center py-4 gap-4">
                <button
                  onClick={() => setIsSidebarCollapsed(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Expand sidebar"
                >
                  <ChevronRight className="w-5 h-5 text-gray-600" />
                </button>
                <div className="p-2">
                  <Settings2 className="w-5 h-5 text-brand-maroon" />
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 sticky top-0 bg-white border-b border-gray-200 z-10">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-5 h-5 text-brand-maroon" />
                      <div>
                        <h3 className="font-semibold text-gray-900 text-sm">Settings</h3>
                        <p className="text-xs text-gray-600">{getModeTitle()}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsSidebarCollapsed(true)}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Collapse sidebar"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-6">
                  {renderSidebarForMode(mode)}

                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="font-semibold text-gray-900 mb-2 text-sm">Quick Actions</h3>
                    <button
                      onClick={handleClearChat}
                      className="w-full flex items-center justify-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium text-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                      Clear Chat
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {isMobileSettingsOpen && (
            <>
              <div
                className="lg:hidden fixed inset-0 bg-black/50 z-50"
                onClick={() => setIsMobileSettingsOpen(false)}
              />
              <div className="lg:hidden fixed left-0 top-0 bottom-0 w-80 bg-white z-50 overflow-y-auto shadow-2xl">
                <div className="p-4 sticky top-0 bg-white border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-5 h-5 text-brand-maroon" />
                      <div>
                        <h3 className="font-semibold text-gray-900 text-sm">Settings</h3>
                        <p className="text-xs text-gray-600">{getModeTitle()}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsMobileSettingsOpen(false)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-6">
                  {renderSidebarForMode(mode)}

                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="font-semibold text-gray-900 mb-2 text-sm">Quick Actions</h3>
                    <button
                      onClick={handleClearChat}
                      className="w-full flex items-center justify-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium text-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                      Clear Chat
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              {messageCount === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                  <div className="mb-6">
                    {mode === 'single' && (
                      <div className="relative">
                        <div className="w-24 h-24 bg-gradient-to-br from-brand-maroon to-red-700 rounded-3xl flex items-center justify-center shadow-lg">
                          <Bot className="w-12 h-12 text-white" />
                        </div>
                        <div className="absolute -top-2 -right-2 w-8 h-8 bg-brand-yellow rounded-full flex items-center justify-center">
                          <span className="text-sm">{AI_MODELS.find((m) => m.id === selectedModel)?.icon}</span>
                        </div>
                      </div>
                    )}

                    {mode === 'compare' && (
                      <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-blue-700 rounded-3xl flex items-center justify-center shadow-lg">
                        <ArrowLeftRight className="w-12 h-12 text-white" />
                      </div>
                    )}

                    {mode === 'multi-judge' && (
                      <div className="w-24 h-24 bg-gradient-to-br from-red-500 to-red-700 rounded-3xl flex items-center justify-center shadow-lg">
                        <Users className="w-12 h-12 text-white" />
                      </div>
                    )}

                    {mode === 'single-judge' && (
                      <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-blue-700 rounded-3xl flex items-center justify-center shadow-lg">
                        <User className="w-12 h-12 text-white" />
                      </div>
                    )}
                  </div>

                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    {mode === 'single' && 'Start a conversation'}
                    {mode === 'compare' && 'Compare and Orchestrate'}
                    {mode === 'multi-judge' && 'Multi-Judge Evaluation'}
                    {mode === 'single-judge' && 'Single-Judge Evaluation'}
                  </h2>

                  <p className="text-gray-600 max-w-md">
                    {mode === 'single' && `Chat with ${AI_MODELS.find((m) => m.id === selectedModel)?.name}`}
                    {mode === 'compare' && 'Ask the same question to selected models, then orchestrate a final answer'}
                    {mode === 'multi-judge' && 'Multiple judges will evaluate your prompt for safety'}
                    {mode === 'single-judge' && 'Detailed evaluation from a single judge model'}
                  </p>
                </div>
              ) : mode === 'compare' ? (
                renderCompareRuns()
              ) : mode === 'multi-judge' ? (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-6xl mx-auto">{renderMultiJudgeRuns()}</div>
                </div>
              ) : mode === 'single-judge' ? (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-5xl mx-auto">{renderSingleJudgeRuns()}</div>
                </div>
              ) : (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-4xl mx-auto space-y-4">
                    <div className="flex items-center gap-2 mb-4 p-3 bg-white rounded-lg border border-gray-200">
                      <span className="text-2xl">{AI_MODELS.find((m) => m.id === selectedModel)?.icon}</span>
                      <div>
                        <div className="font-semibold text-gray-900">{AI_MODELS.find((m) => m.id === selectedModel)?.name}</div>
                        <div className="text-sm text-gray-600">{messageCount} messages</div>
                      </div>
                    </div>

                    {singleMessages.map((message) => (
                      <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {message.role === 'assistant' && (
                          <div className="w-8 h-8 bg-brand-maroon rounded-full flex items-center justify-center flex-shrink-0">
                            <Bot className="w-5 h-5 text-white" />
                          </div>
                        )}

                        <div
                          className={`max-w-2xl rounded-2xl px-4 py-3 ${
                            message.role === 'user'
                              ? 'bg-brand-maroon text-white'
                              : 'bg-white text-gray-900 border border-gray-200'
                          }`}
                        >
                          <Markdown value={message.content} />
                        </div>

                        {message.role === 'user' && (
                          <div className="w-8 h-8 bg-brand-yellow rounded-full flex items-center justify-center flex-shrink-0 font-bold text-gray-900">
                            {profile?.first_name?.[0]}
                          </div>
                        )}
                      </div>
                    ))}

                    {isProcessing && !activeSingleAssistantId && (
                      <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 bg-brand-maroon rounded-full flex items-center justify-center flex-shrink-0">
                          <Bot className="w-5 h-5 text-white" />
                        </div>
                        <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-white border-t border-gray-200">
              <div className="max-w-4xl mx-auto">
                <div className="flex gap-3 items-end">
                  <div className="flex-1 relative">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={getPlaceholder()}
                      rows={1}
                      className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-maroon focus:border-transparent resize-none"
                      style={{ minHeight: '50px', maxHeight: '150px' }}
                    />
                  </div>

                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isProcessing}
                    className="w-12 h-12 bg-brand-maroon text-white rounded-xl hover:bg-brand-maroon-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-xs text-gray-500 mt-2 text-center">Press Enter to send, Shift+Enter for new line</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </EducatorLayout>
  );
}
