'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  FlaskConical,
  MessageSquareText,
  NotebookPen,
  Send,
  Sparkles,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import Markdown from '@/components/Markdown';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SocraticRichTextEditor from '@/components/socratic-writing/SocraticRichTextEditor';
import SocraticPdfReader from '@/components/socratic-writing/SocraticPdfReader';
import EmbeddedOnlineQuiz from '@/components/socratic-writing/EmbeddedOnlineQuiz';
import EmbeddedLectureViewer from '@/components/socratic-writing/EmbeddedLectureViewer';
import {
  buildPdfHtml,
  createStudioLedgerEntry,
  createStudioNote,
  getRecommendedStage,
  getStageBadgeClasses,
  isStageUnlocked,
  recomputeStageStatuses,
  SOCRATIC_STAGE_ORDER,
  SocraticResource,
  SocraticStageKey,
  SocraticStudioBlueprint,
  SocraticStudioSession,
} from '@/lib/socraticWriting';
import { supabase } from '@/lib/supabase';
import {
  fetchStudentSocraticWorkspace,
  saveStudentSocraticWorkspace,
  streamSocraticCoachMessage,
  submitSocraticWorkspace,
} from '@/lib/socraticWritingApi';

type SocraticStudioWorkspaceProps = {
  assignmentId: string;
  onBack: () => void;
};

type StudentAddedSource = SocraticResource & {
  sourceCreatedAt: string;
};

const isPdfLikeResource = (resource: Pick<SocraticResource, 'url' | 'storagePath'>) => {
  const candidates = [resource.url, resource.storagePath]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toLowerCase());
  return candidates.some((value) => value.includes('.pdf'));
};

const stageIcons = {
  clarify: MessageSquareText,
  research: BookOpen,
  build: FlaskConical,
  write: NotebookPen,
} satisfies Record<SocraticStageKey, typeof MessageSquareText>;

const createClientId = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}`;

export default function SocraticStudioWorkspace({
  assignmentId,
  onBack,
}: SocraticStudioWorkspaceProps) {
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [courseStudentId, setCourseStudentId] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<SocraticStudioBlueprint | null>(null);
  const [session, setSession] = useState<SocraticStudioSession | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [newNoteDraft, setNewNoteDraft] = useState('');
  const [studentPdfSummary, setStudentPdfSummary] = useState('');
  const [studentPdfFile, setStudentPdfFile] = useState<File | null>(null);
  const [uploadingStudentPdf, setUploadingStudentPdf] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);

  const hydratedRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadWorkspace();

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [assignmentId]);

  useEffect(() => {
    const handleVisibilityRefresh = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!workspaceId || !hydratedRef.current) return;

      try {
        const payload = await fetchStudentSocraticWorkspace(assignmentId);
        setBlueprint(payload.blueprint);
        setReadOnly(payload.readOnly);
        setSession((current) => {
          if (!current) {
            return recomputeStageStatuses(payload.session, payload.blueprint);
          }
          return recomputeStageStatuses(
            {
              ...current,
              resourceProgress: payload.session.resourceProgress,
              stageStatuses: payload.session.stageStatuses,
              submittedAt: payload.session.submittedAt,
            },
            payload.blueprint,
          );
        });
      } catch (error) {
        console.error('Error refreshing Socratic resource state:', error);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    window.addEventListener('focus', handleVisibilityRefresh);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      window.removeEventListener('focus', handleVisibilityRefresh);
    };
  }, [assignmentId, workspaceId]);

  const loadWorkspace = async () => {
    setLoading(true);
    hydratedRef.current = false;

    try {
      const payload = await fetchStudentSocraticWorkspace(assignmentId);
      const nextBlueprint = payload.blueprint;
      const nextSession = recomputeStageStatuses(payload.session, nextBlueprint);

      setBlueprint(nextBlueprint);
      setSession(nextSession);
      setWorkspaceId(payload.workspaceId);
      setCourseStudentId(payload.courseStudentId);
      setReadOnly(payload.readOnly);
      setSelectedResourceId((current) => current || nextBlueprint.resources[0]?.id || null);
      hydratedRef.current = true;
    } catch (error) {
      console.error('Error loading Socratic workspace:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load Socratic Writing Studio.');
    } finally {
      setLoading(false);
    }
  };

  const studentAddedSources = useMemo<StudentAddedSource[]>(() => {
    if (!session) return [];

    return session.ledger
      .filter((entry) => entry.entryType === 'resource_added')
      .map((entry) => ({
        id: entry.id,
        type: 'reading' as const,
        title:
          typeof entry.metadata?.sourceTitle === 'string' && entry.metadata.sourceTitle.trim()
            ? entry.metadata.sourceTitle
            : entry.title,
        summary:
          typeof entry.metadata?.sourceSummary === 'string' ? entry.metadata.sourceSummary : entry.content,
        required: false,
        createdFrom:
          entry.metadata?.sourceKind === 'upload' ? ('upload' as const) : ('new' as const),
        url: typeof entry.metadata?.resourceUrl === 'string' ? entry.metadata.resourceUrl : null,
        storageBucket:
          typeof entry.metadata?.storageBucket === 'string' ? entry.metadata.storageBucket : null,
        storagePath:
          typeof entry.metadata?.storagePath === 'string' ? entry.metadata.storagePath : null,
        sourceCreatedAt: entry.createdAt,
      }));
  }, [session]);

  const allResources = useMemo(() => {
    if (!blueprint) return [] as SocraticResource[];
    return [...blueprint.resources, ...studentAddedSources];
  }, [blueprint, studentAddedSources]);

  useEffect(() => {
    if (!selectedResourceId && allResources.length > 0) {
      setSelectedResourceId(allResources[0].id);
      return;
    }

    if (selectedResourceId && !allResources.some((resource) => resource.id === selectedResourceId)) {
      setSelectedResourceId(allResources[0]?.id || null);
    }
  }, [allResources, selectedResourceId]);

  useEffect(() => {
    if (!workspaceId || !session || !blueprint || !hydratedRef.current) return;

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        await saveStudentSocraticWorkspace(workspaceId, session);
      } catch (error) {
        console.error('Error autosaving Socratic workspace:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to save Socratic progress.');
      } finally {
        setSaving(false);
      }
    }, 900);

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [blueprint, session, workspaceId]);

  const selectedStage = session?.activeStage || 'clarify';
  const recommendedStage = session ? getRecommendedStage(session) : 'clarify';

  const stageSummary = useMemo(() => {
    if (!blueprint || !session) return null;
    return {
      stageConfig: blueprint.stages[selectedStage],
      readOnly,
    };
  }, [blueprint, readOnly, selectedStage, session]);

  const selectedResource = useMemo(
    () => allResources.find((resource) => resource.id === selectedResourceId) || null,
    [allResources, selectedResourceId],
  );

  const updateSession = (updater: (current: SocraticStudioSession) => SocraticStudioSession) => {
    setSession((current) => {
      if (!current || !blueprint) return current;
      return recomputeStageStatuses(updater(current), blueprint);
    });
  };

  const setStage = (stage: SocraticStageKey) => {
    if (!session || !blueprint) return;
    if (!isStageUnlocked(stage, session, blueprint)) return;

    updateSession((current) => ({
      ...current,
      activeStage: stage,
    }));
  };

  const getCoachDraft = () => {
    if (!session) return '';
    if (selectedStage === 'clarify') return session.clarifyDraft;
    if (selectedStage === 'research') return session.researchCoachDraft;
    if (selectedStage === 'build') return session.buildCoachDraft;
    return session.writeCoachDraft;
  };

  const setCoachDraft = (value: string) => {
    updateSession((current) => {
      if (current.activeStage === 'clarify') return { ...current, clarifyDraft: value };
      if (current.activeStage === 'research') return { ...current, researchCoachDraft: value };
      if (current.activeStage === 'build') return { ...current, buildCoachDraft: value };
      return { ...current, writeCoachDraft: value };
    });
  };

  const handleAddNote = () => {
    if (readOnly || !newNoteDraft.trim() || !blueprint) return;

    updateSession((current) => ({
      ...current,
      notes: [...current.notes, createStudioNote(current.activeStage, newNoteDraft.trim())],
      ledger: [
        ...current.ledger,
        createStudioLedgerEntry(
          current.activeStage,
          'system',
          'Note added',
          `Added a note in ${blueprint.stages[current.activeStage].label}.`,
        ),
      ],
    }));
    setNewNoteDraft('');
  };

  const handleCoachMessage = async () => {
    if (!blueprint || !session || !workspaceId || sendingMessage) return;

    const draft = getCoachDraft().trim();
    if (!draft) return;

    const stageConfig = blueprint.stages[selectedStage];
    if (!stageConfig.aiAllowed) {
      toast.error(`Claude chat is disabled for ${stageConfig.label}.`);
      return;
    }

    const draftExcerpt =
      selectedStage === 'write'
        ? session.essayHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : undefined;

    const promptClientId = createClientId('student');
    const replyClientId = createClientId('ai');
    const now = new Date().toISOString();

    try {
      setSendingMessage(true);
      updateSession((current) => {
        const clearDraft =
          current.activeStage === 'clarify'
            ? { clarifyDraft: '' }
            : current.activeStage === 'research'
              ? { researchCoachDraft: '' }
              : current.activeStage === 'build'
                ? { buildCoachDraft: '' }
                : { writeCoachDraft: '' };

        return {
          ...current,
          ...clearDraft,
          ledger: [
            ...current.ledger,
            {
              id: promptClientId,
              stage: selectedStage,
              actor: 'student',
              title: 'You',
              content: draft,
              createdAt: now,
              entryType: 'chat_prompt',
              metadata: { draftExcerptIncluded: Boolean(draftExcerpt) },
            },
            {
              id: replyClientId,
              stage: selectedStage,
              actor: 'ai',
              title: 'Claude',
              content: '',
              createdAt: now,
              entryType: 'chat_reply',
              metadata: { model: 'claude-sonnet-4.5' },
            },
          ],
        };
      });

      await streamSocraticCoachMessage(
        workspaceId,
        selectedStage,
        draft,
        draftExcerpt || undefined,
        promptClientId,
        replyClientId,
        {
          onDelta: (chunk) => {
            updateSession((current) => ({
              ...current,
              ledger: current.ledger.map((entry) =>
                entry.id === replyClientId
                  ? { ...entry, content: `${entry.content}${chunk}` }
                  : entry,
              ),
            }));
          },
          onDone: (response) => {
            updateSession((current) => {
              const byId = new Map(current.ledger.map((entry) => [entry.id, entry]));
              for (const entry of response.entries) {
                byId.set(entry.id, entry);
              }
              return {
                ...current,
                ledger: Array.from(byId.values()),
              };
            });
          },
          onError: (message) => {
            throw new Error(message);
          },
        },
      );
    } catch (error) {
      console.error('Error sending Socratic coach message:', error);
      updateSession((current) => ({
        ...current,
        ledger: current.ledger.filter((entry) => entry.id !== replyClientId),
      }));
      toast.error(error instanceof Error ? error.message : 'Failed to reach Claude.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleResourceProgress = (resource: SocraticResource, action: 'open' | 'complete') => {
    if (readOnly) return;

    updateSession((current) => ({
      ...current,
      resourceProgress: {
        ...current.resourceProgress,
        [resource.id]: {
          resourceId: resource.id,
          opened:
            action === 'open' ? true : current.resourceProgress[resource.id]?.opened || false,
          completed:
            action === 'complete'
              ? true
              : current.resourceProgress[resource.id]?.completed || false,
          manuallyReviewed: current.resourceProgress[resource.id]?.manuallyReviewed || false,
        },
      },
      ledger: [
        ...current.ledger,
        createStudioLedgerEntry('research', 'system', 'Resource updated', `${resource.title}: ${action}`),
      ],
    }));
  };

  const syncResourceProgress = (
    resource: SocraticResource,
    nextState: { opened?: boolean; completed?: boolean },
  ) => {
    const currentProgress = session?.resourceProgress[resource.id];
    if (nextState.opened && !currentProgress?.opened) {
      handleResourceProgress(resource, 'open');
    }
    if (nextState.completed && !currentProgress?.completed) {
      handleResourceProgress(resource, 'complete');
    }
  };

  const runBuildTool = (tool: 'thesis' | 'structure' | 'stress') => {
    if (readOnly) return;

    updateSession((current) => {
      const nextArtifacts = { ...current.buildArtifacts };

      if (tool === 'thesis') {
        nextArtifacts.thesisOptions = [
          'Claim one precise relationship instead of trying to explain the whole topic.',
          'Define the contested term before committing to the thesis.',
          'Build the essay around one objection your position can survive.',
        ];
      } else if (tool === 'structure') {
        nextArtifacts.structurePlan = [
          'Clarify the key term and narrow the debate.',
          'State the working thesis and name the standard of judgment.',
          'Develop two body moves with evidence.',
          'Address one strong objection and explain why the thesis still holds.',
        ];
      } else {
        nextArtifacts.stressTestQuestions = [
          'What would a skeptical reader say your strongest evidence does not prove?',
          'Where is the thesis still broader than the evidence supports?',
          'What changes if the strongest objection is partly right?',
        ];
      }

      return {
        ...current,
        buildArtifacts: nextArtifacts,
        ledger: [
          ...current.ledger,
          createStudioLedgerEntry('build', 'system', 'Build tool run', tool),
        ],
      };
    });
  };

  const handleEssayChange = (nextHtml: string) => {
    if (readOnly) return;

    updateSession((current) => ({
      ...current,
      essayHtml: nextHtml,
      essayJson: JSON.stringify({ type: 'doc', version: 1, html: nextHtml }),
    }));
  };

  const handleInsertNote = (noteContent: string) => {
    if (selectedStage !== 'write' || readOnly) return;
    handleEssayChange(`${session?.essayHtml || ''}<p>${noteContent}</p>`);
  };

  const handleUploadStudentPdf = async () => {
    if (readOnly || !studentPdfFile || !workspaceId || !courseStudentId) return;
    if (studentPdfFile.type !== 'application/pdf' && !studentPdfFile.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Please upload a PDF file.');
      return;
    }

    try {
      setUploadingStudentPdf(true);
      const safeName = studentPdfFile.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
      const storagePath = `${assignmentId}/${courseStudentId}/student-research/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('socratic-writing')
        .upload(storagePath, studentPdfFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'application/pdf',
        });

      if (uploadError) {
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('socratic-writing').getPublicUrl(storagePath);

      const sourceId = `upload-${Math.random().toString(36).slice(2, 10)}`;
      const title = studentPdfFile.name;
      const summary =
        studentPdfSummary.trim() || 'Student-uploaded research PDF attached inside Socratic Writing.';

      updateSession((current) => ({
        ...current,
        ledger: [
          ...current.ledger,
          {
            ...createStudioLedgerEntry('research', 'system', title, summary),
            id: sourceId,
            entryType: 'resource_added',
            metadata: {
              sourceTitle: title,
              sourceSummary: summary,
              sourceKind: 'upload',
              resourceType: 'reading',
              resourceUrl: publicUrl,
              storageBucket: 'socratic-writing',
              storagePath,
            },
          },
        ],
      }));
      setSelectedResourceId(sourceId);
      setStudentPdfFile(null);
      setStudentPdfSummary('');
      toast.success('PDF attached to Research.');
    } catch (error) {
      console.error('Error uploading student research PDF:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload PDF.');
    } finally {
      setUploadingStudentPdf(false);
    }
  };

  const handleExportPdf = () => {
    if (!blueprint || !session) return;

    const exportWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!exportWindow) return;

    exportWindow.document.open();
    exportWindow.document.write(buildPdfHtml(blueprint, session));
    exportWindow.document.close();
    exportWindow.focus();
    exportWindow.print();
  };

  const handleSubmit = async () => {
    if (!workspaceId) return;

    try {
      setSubmitting(true);
      const payload = await submitSocraticWorkspace(workspaceId);
      setBlueprint(payload.blueprint);
      setSession(recomputeStageStatuses(payload.session, payload.blueprint));
      setReadOnly(payload.readOnly);
      toast.success('Socratic submission saved.');
    } catch (error) {
      console.error('Error submitting Socratic workspace:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit the Socratic assignment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !blueprint || !session || !stageSummary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading Socratic Writing Studio...</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1500px] mx-auto space-y-6">
      <div className="rounded-3xl border border-gray-200 bg-white px-8 py-7 shadow-sm">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-5"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Assignment
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand-maroon mb-2">
              {blueprint.courseCode} | Coaching: Claude
            </p>
            <h1 className="text-4xl font-bold text-gray-950">{blueprint.assignmentTitle}</h1>
            <p className="text-gray-600 mt-3 max-w-3xl">{blueprint.assignmentBrief}</p>
          </div>
          <div className="rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 min-w-[220px]">
            <div className="text-sm font-medium text-orange-700">Due</div>
            <div className="text-lg font-semibold text-orange-900">
              {blueprint.dueAt ? new Date(blueprint.dueAt).toLocaleString() : 'No due date'}
            </div>
            <div className="text-sm text-orange-700 mt-1">
              {blueprint.wordCount} words | {blueprint.pointsPossible} points
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-blue-900 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-semibold">Recommended:</span> {blueprint.stages[recommendedStage].label}
          {' '}| {blueprint.stages[recommendedStage].description}
        </div>
        <div className="text-sm text-blue-800">
          {saving ? 'Saving...' : readOnly ? 'Read-only' : session.submittedAt ? 'Submitted - editable until due date' : 'Autosave on'}
        </div>
      </div>

      <div
        className={`grid gap-6 items-start ${
          sidebarCollapsed
            ? 'xl:grid-cols-[minmax(0,1fr)_72px]'
            : 'xl:grid-cols-[minmax(0,1fr)_360px]'
        }`}
      >
        <div className="space-y-6 min-w-0">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap gap-3">
              {SOCRATIC_STAGE_ORDER.map((stage) => {
                const Icon = stageIcons[stage];
                const unlocked = isStageUnlocked(stage, session, blueprint);
                const active = selectedStage === stage;
                const status = session.stageStatuses[stage];

                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setStage(stage)}
                    disabled={!unlocked}
                    className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-base font-medium transition-colors ${
                      active
                        ? 'bg-brand-maroon text-white'
                        : unlocked
                          ? 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                          : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {blueprint.stages[stage].label}
                    {status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Circle className="w-4 h-4 opacity-60" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900">
              <span className="font-semibold">Mode:</span> {stageSummary.stageConfig.label} | {stageSummary.stageConfig.description}
            </div>
          </div>

          <WorkspaceStageContent
            allResources={allResources}
            blueprint={blueprint}
            getCoachDraft={getCoachDraft}
            handleCoachMessage={handleCoachMessage}
            handleEssayChange={handleEssayChange}
            handleExportPdf={handleExportPdf}
            handleResourceProgress={handleResourceProgress}
            handleSubmit={handleSubmit}
            readOnly={stageSummary.readOnly}
            runBuildTool={runBuildTool}
            selectedResource={selectedResource}
            selectedStage={selectedStage}
            session={session}
            setCoachDraft={setCoachDraft}
            setSelectedResourceId={setSelectedResourceId}
            setSidebarCollapsed={setSidebarCollapsed}
            setSourcesCollapsed={setSourcesCollapsed}
            sendingMessage={sendingMessage}
            sidebarCollapsed={sidebarCollapsed}
            syncResourceProgress={syncResourceProgress}
            sourcesCollapsed={sourcesCollapsed}
            submitting={submitting}
          />
        </div>

        <WorkspaceSidebar
          blueprint={blueprint}
          collapsed={sidebarCollapsed}
          handleAddNote={handleAddNote}
          handleInsertNote={handleInsertNote}
          handleUploadStudentPdf={handleUploadStudentPdf}
          newNoteDraft={newNoteDraft}
          readOnly={stageSummary.readOnly}
          selectedStage={selectedStage}
          session={session}
          setNewNoteDraft={setNewNoteDraft}
          setStudentPdfFile={setStudentPdfFile}
          setStudentPdfSummary={setStudentPdfSummary}
          setCollapsed={setSidebarCollapsed}
          studentPdfFile={studentPdfFile}
          studentPdfSummary={studentPdfSummary}
          uploadingStudentPdf={uploadingStudentPdf}
        />
      </div>
    </div>
  );
}

type WorkspaceStageContentProps = {
  allResources: SocraticResource[];
  blueprint: SocraticStudioBlueprint;
  session: SocraticStudioSession;
  selectedStage: SocraticStageKey;
  readOnly: boolean;
  selectedResource: SocraticResource | null;
  setSelectedResourceId: (id: string) => void;
  getCoachDraft: () => string;
  setCoachDraft: (value: string) => void;
  handleCoachMessage: () => void;
  handleResourceProgress: (resource: SocraticResource, action: 'open' | 'complete') => void;
  syncResourceProgress: (
    resource: SocraticResource,
    nextState: { opened?: boolean; completed?: boolean },
  ) => void;
  runBuildTool: (tool: 'thesis' | 'structure' | 'stress') => void;
  handleEssayChange: (nextHtml: string) => void;
  handleExportPdf: () => void;
  handleSubmit: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  sourcesCollapsed: boolean;
  setSourcesCollapsed: Dispatch<SetStateAction<boolean>>;
  submitting: boolean;
  sendingMessage: boolean;
};

type WorkspaceSidebarProps = {
  blueprint: SocraticStudioBlueprint;
  collapsed: boolean;
  session: SocraticStudioSession;
  readOnly: boolean;
  selectedStage: SocraticStageKey;
  newNoteDraft: string;
  setNewNoteDraft: (value: string) => void;
  handleAddNote: () => void;
  studentPdfSummary: string;
  setStudentPdfSummary: (value: string) => void;
  studentPdfFile: File | null;
  setStudentPdfFile: (value: File | null) => void;
  handleUploadStudentPdf: () => void;
  uploadingStudentPdf: boolean;
  handleInsertNote: (noteContent: string) => void;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
};

function WorkspaceStageContent({
  allResources,
  blueprint,
  session,
  selectedStage,
  readOnly,
  selectedResource,
  setSelectedResourceId,
  getCoachDraft,
  setCoachDraft,
  handleCoachMessage,
  handleResourceProgress,
  syncResourceProgress,
  runBuildTool,
  handleEssayChange,
  handleExportPdf,
  handleSubmit,
  sidebarCollapsed,
  setSidebarCollapsed,
  sourcesCollapsed,
  setSourcesCollapsed,
  submitting,
  sendingMessage,
}: WorkspaceStageContentProps) {
  const stageConfig = blueprint.stages[selectedStage];
  const stageConversation = session.ledger.filter(
    (entry) =>
      entry.stage === selectedStage &&
      (entry.entryType === 'chat_prompt' || entry.entryType === 'chat_reply'),
  );
  const [readingReachedEnd, setReadingReachedEnd] = useState<Record<string, boolean>>({});

  const getResourceProgress = (resource: SocraticResource) => session.resourceProgress[resource.id];
  const isResourceCompleted = (resource: SocraticResource) => {
    if (!resource.required) return true;
    return Boolean(getResourceProgress(resource)?.completed);
  };
  const isReadingResource = selectedResource?.type === 'reading';
  const isQuizResource = selectedResource?.type === 'quiz';
  const isLectureResource =
    selectedResource?.type === 'avatar_lecture' || selectedResource?.type === 'lecture';
  const selectedResourceProgress = selectedResource ? getResourceProgress(selectedResource) : undefined;
  const selectedReadingIsPdf = selectedResource && isReadingResource ? isPdfLikeResource(selectedResource) : false;
  const readingFocusMode = sourcesCollapsed && sidebarCollapsed;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-950">{stageConfig.label}</h2>
          <p className="text-sm text-gray-600 mt-1">{stageConfig.summary}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Clock3 className="w-4 h-4" />
          Status:{' '}
          <span className="font-semibold capitalize text-gray-900">
            {session.stageStatuses[selectedStage].replace('_', ' ')}
          </span>
        </div>
      </div>

      {selectedStage === 'research' && (
        <div className={`grid gap-5 min-w-0 ${sourcesCollapsed ? 'lg:grid-cols-[minmax(0,1fr)]' : 'lg:grid-cols-[280px_minmax(0,1fr)]'}`}>
          {!sourcesCollapsed && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-900">Sources & Materials</h3>
                <button
                  type="button"
                  onClick={() => setSourcesCollapsed(true)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Hide Sources
                </button>
              </div>
              {allResources.map((resource) => {
                const progress = getResourceProgress(resource);
                const completed = isResourceCompleted(resource);

                return (
                  <button
                    key={resource.id}
                    type="button"
                    onClick={() => setSelectedResourceId(resource.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                      selectedResource?.id === resource.id
                        ? 'border-brand-maroon bg-brand-maroon/5'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {resource.type.replace('_', ' ')}
                      </span>
                      {resource.required && (
                        <span className="rounded-full bg-yellow-100 px-2 py-1 text-[11px] font-medium text-yellow-800">
                          Required
                        </span>
                      )}
                    </div>
                    <div className="font-semibold text-gray-900">{resource.title}</div>
                    <p className="text-sm text-gray-600 mt-1">{resource.summary}</p>
                    <div className="mt-3 text-xs font-medium text-gray-500">
                      {completed ? 'Completed' : progress?.opened ? 'In progress' : 'Not started'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="rounded-2xl border border-gray-200 p-5 space-y-4 min-w-0">
            {selectedResource ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {selectedResource.type.replace('_', ' ')}
                    </p>
                    <h3 className="text-xl font-semibold text-gray-900">{selectedResource.title}</h3>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {selectedResource.required && (
                      <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
                        Required resource
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSourcesCollapsed((current) => !current)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {sourcesCollapsed ? 'Show Sources' : 'Hide Sources'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSidebarCollapsed((current) => !current)}
                      className="hidden xl:inline-flex rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {sidebarCollapsed ? 'Show Notebook' : 'Hide Notebook'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextFocused = !readingFocusMode;
                        setSourcesCollapsed(nextFocused);
                        setSidebarCollapsed(nextFocused);
                      }}
                      className="hidden xl:inline-flex rounded-lg border border-brand-maroon px-3 py-2 text-xs font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white"
                    >
                      {readingFocusMode ? 'Exit Focus' : 'Focus Reading'}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600">{selectedResource.summary}</p>

                {isReadingResource && selectedReadingIsPdf && (
                  <>
                    {selectedResource.url ? (
                      <SocraticPdfReader
                        key={selectedResource.id}
                        url={selectedResource.url}
                        title={selectedResource.title}
                        onOpened={() => {
                          if (!selectedResourceProgress?.opened) {
                            handleResourceProgress(selectedResource, 'open');
                          }
                        }}
                        onReachedEnd={() =>
                          setReadingReachedEnd((current) => ({
                            ...current,
                            [selectedResource.id]: true,
                          }))
                        }
                      />
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
                        This reading does not have a PDF attached yet.
                      </div>
                    )}

                    {selectedResource.required && !isResourceCompleted(selectedResource) && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-4 border border-amber-200">
                        <p className="text-sm text-amber-900">
                          {readingReachedEnd[selectedResource.id]
                            ? 'You reached the end of the PDF. Mark it complete to record the reading.'
                            : 'Scroll to the end of the PDF to enable completion.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleResourceProgress(selectedResource, 'complete')}
                          className="rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
                          disabled={readOnly || !readingReachedEnd[selectedResource.id]}
                        >
                          Mark Completed
                        </button>
                      </div>
                    )}
                  </>
                )}

                {isReadingResource && !selectedReadingIsPdf && (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-gray-50 px-4 py-4 text-sm text-gray-700">
                      This reading is linked as a course resource rather than a PDF file, so open it in a new tab to review it.
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {selectedResource.url ? (
                        <button
                          type="button"
                          onClick={() => {
                            handleResourceProgress(selectedResource, 'open');
                            window.open(selectedResource.url || '', '_blank', 'noopener,noreferrer');
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          disabled={readOnly}
                        >
                          <ExternalLink className="w-4 h-4" />
                          Open Reading
                        </button>
                      ) : (
                        <div className="text-sm text-gray-500">No reading link attached.</div>
                      )}
                      {selectedResource.required && !isResourceCompleted(selectedResource) && (
                        <button
                          type="button"
                          onClick={() => handleResourceProgress(selectedResource, 'complete')}
                          className="rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
                          disabled={readOnly || !selectedResourceProgress?.opened}
                        >
                          Mark Completed
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isQuizResource && (
                  selectedResource.resourceRefId ? (
                    <EmbeddedOnlineQuiz
                      courseId={blueprint.courseId}
                      quizBatchId={selectedResource.resourceRefId}
                      onProgressChange={(nextState) => syncResourceProgress(selectedResource, nextState)}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
                      This quiz is attached, but its quiz reference is missing.
                    </div>
                  )
                )}

                {isLectureResource && (
                  selectedResource.resourceRefId ? (
                    <EmbeddedLectureViewer
                      courseId={blueprint.courseId}
                      lectureId={selectedResource.resourceRefId}
                      onProgressChange={(nextState) => syncResourceProgress(selectedResource, nextState)}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
                      This lecture is attached, but its lecture reference is missing.
                    </div>
                  )
                )}

                {!isReadingResource && !isQuizResource && !isLectureResource && (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
                    This research item is attached, but its preview flow is not available here yet.
                  </div>
                )}
              </>
            ) : (
              <div className="min-h-[220px] grid place-items-center text-gray-500">
                Select a source to review.
              </div>
            )}
          </div>
        </div>
      )}

      {selectedStage === 'build' && (
        <div className="space-y-5">
          <div className="grid md:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => runBuildTool('thesis')}
              disabled={readOnly}
              className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-left hover:border-orange-300 transition-colors disabled:opacity-50"
            >
              <h3 className="text-lg font-semibold text-orange-900 mb-2">Generate Thesis</h3>
              <p className="text-sm text-orange-900/80">
                Create several thesis directions without writing the essay.
              </p>
            </button>
            <button
              type="button"
              onClick={() => runBuildTool('structure')}
              disabled={readOnly}
              className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-left hover:border-yellow-300 transition-colors disabled:opacity-50"
            >
              <h3 className="text-lg font-semibold text-yellow-900 mb-2">Structure Argument</h3>
              <p className="text-sm text-yellow-900/80">
                Map the 2 to 4 moves the essay needs and align evidence to each move.
              </p>
            </button>
            <button
              type="button"
              onClick={() => runBuildTool('stress')}
              disabled={readOnly}
              className="rounded-2xl border border-red-200 bg-red-50 p-5 text-left hover:border-red-300 transition-colors disabled:opacity-50"
            >
              <h3 className="text-lg font-semibold text-red-900 mb-2">Stress-Test</h3>
              <p className="text-sm text-red-900/80">
                Surface the strongest objections before the draft is finalized.
              </p>
            </button>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-gray-200 p-5">
              <h4 className="font-semibold text-gray-900 mb-3">Thesis Options</h4>
              <ul className="space-y-2 text-sm text-gray-700">
                {session.buildArtifacts.thesisOptions.length > 0
                  ? session.buildArtifacts.thesisOptions.map((item, index) => (
                    <li key={`thesis-${index}`} className="rounded-lg bg-gray-50 px-3 py-2">
                      {item}
                    </li>
                  ))
                  : <li className="text-gray-500">Run “Generate Thesis” to seed options.</li>}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 p-5">
              <h4 className="font-semibold text-gray-900 mb-3">Argument Structure</h4>
              <ul className="space-y-2 text-sm text-gray-700">
                {session.buildArtifacts.structurePlan.length > 0
                  ? session.buildArtifacts.structurePlan.map((item, index) => (
                    <li key={`structure-${index}`} className="rounded-lg bg-gray-50 px-3 py-2">
                      {item}
                    </li>
                  ))
                  : <li className="text-gray-500">Run “Structure Argument” to map the essay.</li>}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 p-5">
              <h4 className="font-semibold text-gray-900 mb-3">Stress-Test</h4>
              <ul className="space-y-2 text-sm text-gray-700">
                {session.buildArtifacts.stressTestQuestions.length > 0
                  ? session.buildArtifacts.stressTestQuestions.map((item, index) => (
                    <li key={`stress-${index}`} className="rounded-lg bg-gray-50 px-3 py-2">
                      {item}
                    </li>
                  ))
                  : <li className="text-gray-500">Run “Stress-Test” to pressure the argument.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {selectedStage === 'write' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-gray-900">Compose the Essay</h3>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleExportPdf}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Export PDF
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={readOnly || submitting}
                className="rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
              >
                {submitting
                  ? 'Submitting...'
                  : session.submittedAt
                    ? 'Save Resubmission'
                    : 'Submit Assignment'}
              </button>
            </div>
          </div>
          <SocraticRichTextEditor
            value={session.essayHtml}
            onChange={handleEssayChange}
            readOnly={readOnly}
          />
        </div>
      )}

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
        <div className="flex items-center gap-2 text-amber-900 font-semibold">
          <Sparkles className="w-4 h-4" />
          Claude Chat
        </div>
        {!stageConfig.aiAllowed ? (
          <div className="text-sm text-amber-900">
            Claude chat is disabled for {stageConfig.label}. Continue with notes and the stage tools instead.
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {stageConversation.length === 0 ? (
                <div className="rounded-xl bg-white px-4 py-3 text-sm text-gray-600">
                  Start the conversation with Claude for {stageConfig.label.toLowerCase()}.
                </div>
              ) : (
                stageConversation.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex ${entry.actor === 'student' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        entry.actor === 'student'
                          ? 'bg-brand-maroon text-white'
                          : 'bg-white border border-gray-200 text-gray-900'
                      }`}
                    >
                      <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${
                        entry.actor === 'student' ? 'text-white/70' : 'text-gray-500'
                      }`}>
                        {entry.actor === 'student' ? 'You' : 'Claude'}
                      </div>
                      {entry.actor === 'ai' ? (
                        <div className="socratic-chat-markdown">
                          <Markdown value={entry.content || (sendingMessage ? '...' : '')} />
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{entry.content || (sendingMessage ? '...' : '')}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-3">
              {selectedStage === 'write' && (
                <button
                  type="button"
                  onClick={() => setCoachDraft('Review the current draft and ask me one revision question at a time.')}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Let Claude read the current draft
                </button>
              )}
              <Textarea
                rows={4}
                value={getCoachDraft()}
                onChange={(event) => setCoachDraft(event.target.value)}
                placeholder={`Chat with Claude in ${stageConfig.label.toLowerCase()}...`}
                disabled={readOnly}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCoachMessage}
                  disabled={readOnly || sendingMessage || !getCoachDraft().trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {sendingMessage ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WorkspaceSidebar({
  blueprint,
  collapsed,
  session,
  readOnly,
  selectedStage,
  newNoteDraft,
  setNewNoteDraft,
  handleAddNote,
  studentPdfSummary,
  setStudentPdfSummary,
  studentPdfFile,
  setStudentPdfFile,
  handleUploadStudentPdf,
  uploadingStudentPdf,
  handleInsertNote,
  setCollapsed,
}: WorkspaceSidebarProps) {
  if (collapsed) {
    return (
      <aside className="hidden xl:block xl:sticky xl:top-8">
        <div className="flex h-[calc(100vh-8rem)] min-h-[420px] flex-col items-center justify-between rounded-2xl border border-gray-200 bg-white px-3 py-4">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Open
          </button>
          <div className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-[0.3em] text-gray-400">
            Notebook
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            aria-label="Expand notebook and ledger panel"
          >
            Open
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="space-y-6 xl:sticky xl:top-8">
      <div className="hidden xl:flex justify-end">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Minimize panel
        </button>
      </div>
      <Tabs defaultValue="notebook" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="notebook">Notebook</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="notebook" className="mt-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Shared Notebook</h3>
              <p className="text-sm text-gray-600 mt-1">
                One notebook across all stages. Each note keeps its origin badge.
              </p>
            </div>
            <Textarea
              rows={4}
              value={newNoteDraft}
              onChange={(event) => setNewNoteDraft(event.target.value)}
              placeholder={`Add a ${blueprint.stages[selectedStage].label.toLowerCase()} note...`}
              disabled={readOnly}
            />
            <button
              type="button"
              onClick={handleAddNote}
              disabled={readOnly}
              className="w-full rounded-lg border border-brand-maroon px-4 py-2 text-sm font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white disabled:opacity-50"
            >
              Add Note
            </button>
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {session.notes.map((note) => (
                <div key={note.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${getStageBadgeClasses(note.stage)}`}
                    >
                      {blueprint.stages[note.stage].label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(note.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                  {selectedStage === 'write' && (
                    <button
                      type="button"
                      onClick={() => handleInsertNote(note.content)}
                      className="mt-3 text-xs font-medium text-brand-maroon hover:text-brand-maroon-hover"
                    >
                      Insert into draft
                    </button>
                  )}
                </div>
              ))}
              {session.notes.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 text-center">
                  No notes yet. Capture questions, evidence, and argument moves as you work.
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Ledger</h3>
              <p className="text-sm text-gray-600 mt-1">
                Append-only log of prompts, AI replies, and workflow events.
              </p>
            </div>
            <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
              {session.ledger.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${getStageBadgeClasses(entry.stage)}`}
                    >
                      {blueprint.stages[entry.stage].label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    {entry.actor}
                  </div>
                  <div className="font-medium text-gray-900">{entry.title}</div>
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{entry.content}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Research Gate</h3>
          <p className="text-sm text-gray-600 mt-1">
            All four stages are open. Required resources still help track progress and readiness.
          </p>
        </div>
        <div className="space-y-3 text-sm">
          {blueprint.resources.filter((resource) => resource.required).map((resource) => {
            const progress = session.resourceProgress[resource.id];
            const done = Boolean(progress?.completed);
            return (
              <div
                key={resource.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3"
              >
                <div className="font-medium text-gray-900">{resource.title}</div>
                <div className={`text-xs font-semibold ${done ? 'text-green-600' : 'text-gray-500'}`}>
                  {done ? 'Complete' : 'Pending'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedStage === 'research' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Upload Your Own PDF</h3>
            <p className="text-sm text-gray-600 mt-1">
              Student-uploaded PDFs are tracked in the ledger and stay attached to this studio for educator review.
            </p>
          </div>
          <Input type="file" accept="application/pdf" onChange={(event) => setStudentPdfFile(event.target.files?.[0] || null)} disabled={readOnly || uploadingStudentPdf} />
          {studentPdfFile && (
            <div className="text-sm text-gray-600">
              Selected PDF: <span className="font-medium text-gray-900">{studentPdfFile.name}</span>
            </div>
          )}
          <Textarea
            rows={3}
            value={studentPdfSummary}
            onChange={(event) => setStudentPdfSummary(event.target.value)}
            placeholder="What should this PDF help with?"
            disabled={readOnly || uploadingStudentPdf}
          />
          <button
            type="button"
            onClick={handleUploadStudentPdf}
            disabled={readOnly || uploadingStudentPdf || !studentPdfFile}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {uploadingStudentPdf ? 'Uploading PDF...' : 'Attach PDF'}
          </button>
        </div>
      )}
    </aside>
  );
}
