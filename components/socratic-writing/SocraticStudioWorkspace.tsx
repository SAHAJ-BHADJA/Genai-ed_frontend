'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Maximize2,
  MessageSquareText,
  Minimize2,
  NotebookPen,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import Markdown from '@/components/Markdown';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SocraticRichTextEditor, {
  type SocraticRichTextEditorHandle,
} from '@/components/socratic-writing/SocraticRichTextEditor';
import SocraticPdfReader from '@/components/socratic-writing/SocraticPdfReader';
import EmbeddedOnlineQuiz from '@/components/socratic-writing/EmbeddedOnlineQuiz';
import EmbeddedLectureViewer from '@/components/socratic-writing/EmbeddedLectureViewer';
import {
  buildPdfHtml,
  createStudioLedgerEntry,
  createStudioNote,
  getStageBadgeClasses,
  isStageUnlocked,
  recomputeStageStatuses,
  SOCRATIC_STAGE_ORDER,
  SocraticPreviewPayload,
  SocraticFinalQuizState,
  SocraticResource,
  SocraticStageKey,
  SocraticStudioBlueprint,
  SocraticStudioSession,
} from '@/lib/socraticWriting';
import { supabase } from '@/lib/supabase';
import {
  fetchStudentSocraticWorkspace,
  isSocraticAuthExpiredError,
  prepareSocraticFinalQuiz,
  saveStudentSocraticWorkspace,
  streamSocraticCoachMessage,
  streamSocraticPreviewCoachMessage,
  submitSocraticWorkspace,
} from '@/lib/socraticWritingApi';

type SocraticStudioWorkspaceProps = {
  assignmentId: string;
  onBack: () => void;
  previewMode?: boolean;
  previewPayload?: SocraticPreviewPayload;
  onSavePreviewSession?: (session: SocraticStudioSession) => void;
};

type StudentAddedSource = SocraticResource & {
  sourceCreatedAt: string;
};

type EmbeddedQuizSubmissionDetail = {
  status?: string;
  attempt?: {
    id?: string;
    submitted_at?: string | null;
    final_score?: number | null;
    raw_score?: number | null;
  } | null;
  questions?: unknown[];
};

type StudioView = 'brief' | SocraticStageKey;

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
  previewMode = false,
  previewPayload,
  onSavePreviewSession,
}: SocraticStudioWorkspaceProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [courseStudentId, setCourseStudentId] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<SocraticStudioBlueprint | null>(null);
  const [session, setSession] = useState<SocraticStudioSession | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preparingFinalQuiz, setPreparingFinalQuiz] = useState(false);
  const [finalQuiz, setFinalQuiz] = useState<SocraticFinalQuizState | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [newNoteDraft, setNewNoteDraft] = useState('');
  const [studentPdfSummary, setStudentPdfSummary] = useState('');
  const [studentPdfFile, setStudentPdfFile] = useState<File | null>(null);
  const [uploadingStudentPdf, setUploadingStudentPdf] = useState(false);
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<StudioView>('brief');
  const [writingCollapsed, setWritingCollapsed] = useState(false);
  const [modeCollapsed, setModeCollapsed] = useState(false);
  const [desktopSplit, setDesktopSplit] = useState<50 | 70>(50);
  const [workspaceFullscreen, setWorkspaceFullscreen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'writing' | 'mode'>('mode');
  const [notesOpen, setNotesOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [briefPdfOpen, setBriefPdfOpen] = useState(false);

  const hydratedRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSelectedResourceIdRef = useRef<string | null>(null);
  const authExpiredRef = useRef(false);
  const authExpiredToastShownRef = useRef(false);
  const essayEditorRef = useRef<SocraticRichTextEditorHandle | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.scrollX === 0) return;
    window.scrollTo({ left: 0, top: window.scrollY, behavior: 'auto' });
  }, [desktopSplit, modeCollapsed, workspaceFullscreen, writingCollapsed]);

  const handleAuthExpired = (error: unknown) => {
    if (!isSocraticAuthExpiredError(error)) return false;
    authExpiredRef.current = true;
    setReadOnly(true);
    setSaving(false);
    const message = error instanceof Error ? error.message : 'Your login session expired. Please sign in again.';
    setLoadError(message);
    if (!authExpiredToastShownRef.current) {
      authExpiredToastShownRef.current = true;
      toast.error(message);
    }
    return true;
  };

  useEffect(() => {
    authExpiredRef.current = false;
    authExpiredToastShownRef.current = false;
    setLoadError(null);
    void loadWorkspace();

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [assignmentId]);

  useEffect(() => {
    const handleVisibilityRefresh = async () => {
      if (authExpiredRef.current) return;
      if (previewMode) return;
      if (document.visibilityState !== 'visible') return;
      if (!workspaceId || !hydratedRef.current) return;

      try {
        const payload = await fetchStudentSocraticWorkspace(assignmentId);
        setBlueprint(payload.blueprint);
        setReadOnly(payload.readOnly);
        setFinalQuiz(payload.finalQuiz);
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
        if (handleAuthExpired(error)) return;
        console.error('Error refreshing Socratic resource state:', error);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    window.addEventListener('focus', handleVisibilityRefresh);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      window.removeEventListener('focus', handleVisibilityRefresh);
    };
  }, [assignmentId, previewMode, workspaceId]);

  const loadWorkspace = async (options: { silent?: boolean } = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setLoading(true);
      setLoadError(null);
      hydratedRef.current = false;
    }

    try {
      if (authExpiredRef.current) return;
      if (previewMode) {
        if (!previewPayload) {
          throw new Error('Preview setup was not found. Return to assignment setup and launch Preview as Student again.');
        }
        const nextBlueprint = previewPayload.blueprint;
        const nextSession = recomputeStageStatuses(previewPayload.session, nextBlueprint);

        setBlueprint(nextBlueprint);
        setSession(nextSession);
        setWorkspaceId('educator-preview');
        setCourseStudentId('educator-preview');
        setReadOnly(false);
        setFinalQuiz({
          enabled: false,
          status: 'disabled',
          quizBatchId: null,
          quizGeneratedId: null,
          essayHash: null,
          currentEssayHash: null,
          isStale: false,
          generationError: null,
          generatedAt: null,
          quizSubmittedAt: null,
          reportStatus: null,
          reportGeneratedAt: null,
          quizScore: null,
          quizTotal: null,
          systemIssue: null,
        });
        setSelectedResourceId((current) => current || nextBlueprint.resources[0]?.id || null);
        hydratedRef.current = true;
        return;
      }

      const payload = await fetchStudentSocraticWorkspace(assignmentId);
      const nextBlueprint = payload.blueprint;
      const nextSession = recomputeStageStatuses(payload.session, nextBlueprint);

      setBlueprint(nextBlueprint);
      setSession(nextSession);
      setWorkspaceId(payload.workspaceId);
      setCourseStudentId(payload.courseStudentId);
      setReadOnly(payload.readOnly);
      setFinalQuiz(payload.finalQuiz);
      setSelectedResourceId((current) => current || nextBlueprint.resources[0]?.id || null);
      hydratedRef.current = true;
    } catch (error) {
      if (handleAuthExpired(error)) return;
      console.error('Error loading Socratic workspace:', error);
      const message = error instanceof Error ? error.message : 'Failed to load Socratic Writing Studio.';
      setLoadError(message);
      toast.error(message);
    } finally {
      if (!silent) {
        setLoading(false);
      }
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
      }))
      .reverse();
  }, [session]);

  const allResources = useMemo(() => {
    if (!blueprint) return [] as SocraticResource[];
    return [...studentAddedSources, ...blueprint.resources];
  }, [blueprint, studentAddedSources]);

  useEffect(() => {
    const pendingResourceId = pendingSelectedResourceIdRef.current;
    if (pendingResourceId && allResources.some((resource) => resource.id === pendingResourceId)) {
      setSelectedResourceId(pendingResourceId);
      pendingSelectedResourceIdRef.current = null;
      return;
    }

    if (!selectedResourceId && allResources.length > 0) {
      setSelectedResourceId(allResources[0].id);
      return;
    }

    if (selectedResourceId && !allResources.some((resource) => resource.id === selectedResourceId)) {
      setSelectedResourceId(allResources[0]?.id || null);
    }
  }, [allResources, selectedResourceId]);

  useEffect(() => {
    if (!workspaceId || !session || !blueprint || !hydratedRef.current || authExpiredRef.current) return;

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        if (previewMode) {
          onSavePreviewSession?.(session);
        } else {
          await saveStudentSocraticWorkspace(workspaceId, session);
        }
      } catch (error) {
        if (handleAuthExpired(error)) return;
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
  }, [blueprint, onSavePreviewSession, previewMode, session, workspaceId]);

  const selectedStage = session?.activeStage || 'clarify';
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

  const essayWordCount = useMemo(() => {
    if (!session) return 0;
    const text = session.essayHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? text.split(' ').length : 0;
  }, [session]);

  const openResourceFromBrief = (resource: SocraticResource) => {
    setSelectedResourceId(resource.id);
    setStage('research');
  };

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
    setActiveView(stage);
    setMobilePane('mode');
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
      toast.error(`AI chat is disabled for ${stageConfig.label}.`);
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
              title: 'AI tutor',
              content: '',
              createdAt: now,
              entryType: 'chat_reply',
              metadata: { model: 'gpt-5.6-sol' },
            },
          ],
        };
      });

      const streamHandlers = {
        onDelta: (chunk: string) => {
          updateSession((current) => ({
            ...current,
            ledger: current.ledger.map((entry) =>
              entry.id === replyClientId
                ? { ...entry, content: `${entry.content}${chunk}` }
                : entry,
            ),
          }));
        },
        onDone: (response: { reply: string; entries: SocraticStudioSession['ledger'] }) => {
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
        onError: (message: string) => {
          throw new Error(message);
        },
      };

      if (previewMode) {
        await streamSocraticPreviewCoachMessage(
          blueprint,
          session,
          selectedStage,
          draft,
          draftExcerpt || undefined,
          promptClientId,
          replyClientId,
          streamHandlers,
        );
      } else {
        await streamSocraticCoachMessage(
          workspaceId,
          selectedStage,
          draft,
          draftExcerpt || undefined,
          promptClientId,
          replyClientId,
          streamHandlers,
        );
      }
    } catch (error) {
      if (handleAuthExpired(error)) return;
      console.error('Error sending Socratic coach message:', error);
      updateSession((current) => ({
        ...current,
        ledger: current.ledger.filter((entry) => entry.id !== replyClientId),
      }));
      toast.error(error instanceof Error ? error.message : 'Failed to reach the AI tutor.');
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

    setFinalQuiz((current) => {
      if (!current?.enabled) return current;
      if (!['ready', 'submitted', 'report_ready'].includes(current.status)) return current;
      return {
        ...current,
        status: 'stale',
        isStale: true,
      };
    });

    updateSession((current) => ({
      ...current,
      essayHtml: nextHtml,
      essayJson: JSON.stringify({ type: 'doc', version: 1, html: nextHtml }),
    }));
  };

  const handleInsertNote = (noteContent: string) => {
    if (readOnly) return;
    handleEssayChange(`${session?.essayHtml || ''}<p>${noteContent}</p>`);
  };

  const handleUploadStudentPdf = async () => {
    if (readOnly || !studentPdfFile || !workspaceId || !courseStudentId || !blueprint) return;
    if (studentPdfFile.type !== 'application/pdf' && !studentPdfFile.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Please upload a PDF file.');
      return;
    }

    try {
      setUploadingStudentPdf(true);
      const safeName = studentPdfFile.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
      let storageBucket: string | null = previewMode ? 'course-files' : 'socratic-writing';
      let storagePath: string | null = previewMode
        ? `${blueprint.courseId}/socratic-preview/${Date.now()}-${safeName}`
        : `${assignmentId}/${courseStudentId}/student-research/${Date.now()}-${safeName}`;
      let publicUrl: string;
      let previewOnlyLocal = false;

      const uploadToStorage = async (bucket: string, path: string) => {
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(path, studentPdfFile, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'application/pdf',
          });

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: { publicUrl: uploadedUrl },
        } = supabase.storage.from(bucket).getPublicUrl(path);
        return uploadedUrl;
      };

      try {
        publicUrl = await uploadToStorage(storageBucket, storagePath);
      } catch (uploadError) {
        if (!previewMode) {
          throw uploadError;
        }

        console.warn('Preview PDF upload failed; attaching a local preview URL instead.', uploadError);
        publicUrl = URL.createObjectURL(studentPdfFile);
        storageBucket = null;
        storagePath = null;
        previewOnlyLocal = true;
      }

      const sourceId = `upload-${Math.random().toString(36).slice(2, 10)}`;
      const title = studentPdfFile.name;
      const summary =
        studentPdfSummary.trim() || 'Student-uploaded research PDF attached inside Socratic Writing.';

      pendingSelectedResourceIdRef.current = sourceId;
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
              storageBucket,
              storagePath,
              previewOnlyLocal,
            },
          },
        ],
      }));
      setStudentPdfFile(null);
      setStudentPdfSummary('');
      toast.success('PDF attached to Sources & Materials.');
      if (previewOnlyLocal) {
        toast.warning('Preview attached locally. The AI tutor can read it only after it is uploaded by a real student.');
      }
    } catch (error) {
      if (handleAuthExpired(error)) return;
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

  const handlePrepareFinalQuiz = async (currentEssayHtml?: string) => {
    if (!workspaceId || !session) return;
    if (previewMode) {
      toast.info('Final quiz generation is available in real student workspaces after publishing.');
      return;
    }

    try {
      setPreparingFinalQuiz(true);
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
      const sessionToSave =
        currentEssayHtml !== undefined
          ? {
              ...session,
              essayHtml: currentEssayHtml,
              essayJson: JSON.stringify({ type: 'doc', version: 1, html: currentEssayHtml }),
            }
          : session;
      const liveEssayText = sessionToSave.essayHtml
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (liveEssayText.length < 50) {
        toast.error('Write more of the essay before generating the final quiz.');
        return;
      }

      const savedPayload = await saveStudentSocraticWorkspace(workspaceId, sessionToSave);
      const preparedPayload = await prepareSocraticFinalQuiz(savedPayload.workspaceId, sessionToSave);
      setBlueprint(preparedPayload.blueprint);
      setSession(recomputeStageStatuses(preparedPayload.session, preparedPayload.blueprint));
      setReadOnly(preparedPayload.readOnly);
      setFinalQuiz(preparedPayload.finalQuiz);
      toast.success('Final quiz is ready.');
    } catch (error) {
      if (handleAuthExpired(error)) return;
      console.error('Error preparing Socratic final quiz:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to prepare the final quiz.');
      try {
        const refreshed = await fetchStudentSocraticWorkspace(assignmentId);
        setFinalQuiz(refreshed.finalQuiz);
      } catch {
        // Keep the visible error from the prepare request.
      }
    } finally {
      setPreparingFinalQuiz(false);
    }
  };

  const handleFinalQuizSubmitted = (quizDetail?: EmbeddedQuizSubmissionDetail) => {
    if (previewMode) return;
    setFinalQuiz((current) => {
      if (!current) return current;
      const submittedAt = quizDetail?.attempt?.submitted_at || current.quizSubmittedAt || new Date().toISOString();
      const score =
        quizDetail?.attempt?.final_score !== null && quizDetail?.attempt?.final_score !== undefined
          ? quizDetail.attempt.final_score
          : quizDetail?.attempt?.raw_score !== null && quizDetail?.attempt?.raw_score !== undefined
            ? quizDetail.attempt.raw_score
            : current.quizScore;

      return {
        ...current,
        status: current.reportStatus === 'ready' ? 'report_ready' : 'submitted',
        quizSubmittedAt: submittedAt,
        quizScore: score,
        quizTotal: quizDetail?.questions?.length || current.quizTotal,
      };
    });
    toast.success('Final quiz submitted. You can now submit the final package.');
  };

  const handleSubmit = async () => {
    if (!workspaceId) return;
    if (previewMode) {
      toast.info('Preview mode does not submit. Return to assignment setup to publish when ready.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = await submitSocraticWorkspace(workspaceId);
      setBlueprint(payload.blueprint);
      setSession(recomputeStageStatuses(payload.session, payload.blueprint));
      setReadOnly(payload.readOnly);
      setFinalQuiz(payload.finalQuiz);
      toast.success('Socratic submission saved.');
    } catch (error) {
      if (handleAuthExpired(error)) return;
      console.error('Error submitting Socratic workspace:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit the Socratic assignment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!loading && loadError && (!blueprint || !session || !stageSummary)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-900">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-700" />
          <h2 className="text-xl font-semibold">Socratic Studio could not load</h2>
          <p className="mt-2 text-sm">{loadError}</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-5 rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover"
          >
            Back to assignment
          </button>
        </div>
      </div>
    );
  }

  if (loading || !blueprint || !session || !stageSummary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading Socratic Writing Studio...</div>
      </div>
    );
  }

  const assignmentDocument = blueprint.assignmentDocument;
  const targetProgress = blueprint.wordCount > 0
    ? Math.min(100, Math.round((essayWordCount / blueprint.wordCount) * 100))
    : 0;

  return (
    <div className={workspaceFullscreen
      ? 'fixed inset-0 z-50 h-dvh w-full min-w-0 max-w-full overflow-x-hidden bg-gray-100 p-2 sm:p-4'
      : 'mx-auto h-[calc(100dvh-9rem)] min-h-[640px] w-full min-w-0 max-w-[1800px] overflow-x-hidden'}>
      <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              aria-label={previewMode ? 'Back to assignment setup' : 'Back to assignment'}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-gray-950 sm:text-xl">Socratic Writing Studio</h1>
              </div>
              <p className="truncate text-xs text-gray-500 sm:text-sm">
                <span className="font-semibold text-brand-maroon">{blueprint.courseCode}</span>
                {' · '}{blueprint.assignmentTitle}{previewMode ? ' · Student preview' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNotesOpen((current) => !current)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${notesOpen ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              <NotebookPen className="h-4 w-4" />
              <span className="hidden sm:inline">Notes</span>
              <span className="text-xs">{session.notes.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setLedgerOpen((current) => !current)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${ledgerOpen ? 'bg-brand-maroon text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Ledger</span>
              <span className="text-xs">{session.ledger.length}</span>
            </button>
            <span className="rounded-full bg-blue-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
              Student
            </span>
          </div>
        </header>

        <nav className="flex items-center gap-1 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => {
              setActiveView('brief');
              setMobilePane('mode');
            }}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${activeView === 'brief' ? 'bg-brand-maroon text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <FileText className="h-4 w-4" /> Brief
          </button>
          <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" />
          {SOCRATIC_STAGE_ORDER.map((stage) => {
            const Icon = stageIcons[stage];
            const active = activeView === stage;
            const status = session.stageStatuses[stage];
            return (
              <button
                key={stage}
                type="button"
                onClick={() => setStage(stage)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${active ? 'bg-brand-maroon text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <Icon className="h-4 w-4" />
                {blueprint.stages[stage].label}
                {status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </nav>

        <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50 p-1 lg:hidden">
          <button
            type="button"
            onClick={() => setMobilePane('writing')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${mobilePane === 'writing' ? 'bg-white text-brand-maroon shadow-sm' : 'text-gray-500'}`}
          >
            Writing
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('mode')}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${mobilePane === 'mode' ? 'bg-white text-brand-maroon shadow-sm' : 'text-gray-500'}`}
          >
            {activeView === 'brief' ? 'Brief' : blueprint.stages[selectedStage].label}
          </button>
        </div>

        <div className="flex min-h-0 min-w-0 max-w-full flex-1 items-stretch overflow-hidden bg-gray-50">
          {writingCollapsed ? (
            <button
              type="button"
              onClick={() => setWritingCollapsed(false)}
              className="hidden w-12 shrink-0 flex-col items-center justify-between border-r border-gray-200 bg-white py-4 text-gray-500 hover:text-brand-maroon lg:flex"
            >
              <ChevronRight className="h-4 w-4" />
              <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-[0.2em]">Writing</span>
              <NotebookPen className="h-4 w-4" />
            </button>
          ) : (
            <section
              className={`${mobilePane === 'writing' ? 'flex' : 'hidden'} w-full min-w-0 max-w-full flex-col border-r border-gray-200 bg-gray-100 lg:flex lg:w-0`}
              style={{ flex: desktopSplit === 70 ? '7 1 0%' : '1 1 0%' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <NotebookPen className="h-4 w-4 text-brand-maroon" />
                  <span className="font-semibold text-gray-900">Writing</span>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{essayWordCount} / {blueprint.wordCount} words</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleExportPdf} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100">
                    <Download className="h-4 w-4" /> Export
                  </button>
                  <div className="hidden items-center rounded-lg border border-gray-200 p-0.5 lg:flex">
                    <button type="button" onClick={() => setDesktopSplit(50)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${desktopSplit === 50 ? 'bg-brand-maroon text-white' : 'text-gray-500 hover:bg-gray-100'}`}>50%</button>
                    <button type="button" onClick={() => setDesktopSplit(70)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${desktopSplit === 70 ? 'bg-brand-maroon text-white' : 'text-gray-500 hover:bg-gray-100'}`}>70%</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWorkspaceFullscreen((current) => !current)}
                    className="hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:inline-flex"
                    aria-label={workspaceFullscreen ? 'Exit focus view' : 'Open focus view'}
                  >
                    {workspaceFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => setWritingCollapsed(true)} className="hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:inline-flex" aria-label="Collapse writing panel">
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 sm:p-6">
                <div className="mx-auto max-w-[900px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <SocraticRichTextEditor
                    ref={essayEditorRef}
                    value={session.essayHtml}
                    onChange={handleEssayChange}
                    readOnly={stageSummary.readOnly}
                    editorClassName="min-h-[620px] sm:min-h-[720px]"
                  />
                </div>
              </div>
              <div className="border-t border-gray-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-4 text-xs text-gray-500">
                  <span>{essayWordCount} words / {blueprint.wordCount} target</span>
                  <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-brand-maroon transition-all" style={{ width: `${targetProgress}%` }} />
                  </div>
                </div>
              </div>
            </section>
          )}

          {modeCollapsed ? (
            <button
              type="button"
              onClick={() => setModeCollapsed(false)}
              className="hidden w-12 shrink-0 flex-col items-center justify-between border-r border-gray-200 bg-white py-4 text-gray-500 hover:text-brand-maroon lg:flex"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-[0.2em]">{activeView === 'brief' ? 'Brief' : blueprint.stages[selectedStage].label}</span>
              <Sparkles className="h-4 w-4" />
            </button>
          ) : (
            <section
              className={`${mobilePane === 'mode' ? 'flex' : 'hidden'} w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-white lg:flex lg:w-0`}
              style={{ flex: desktopSplit === 70 ? '3 1 0%' : '1 1 0%' }}
            >
              <div className="hidden items-center border-b border-gray-200 bg-white px-3 py-2 lg:flex">
                <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setActiveView('brief')}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${activeView === 'brief' ? 'bg-brand-maroon text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    <FileText className="h-4 w-4" /> Brief
                  </button>
                  {SOCRATIC_STAGE_ORDER.map((stage) => {
                    const Icon = stageIcons[stage];
                    const active = activeView === stage;
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => setStage(stage)}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${active ? 'bg-brand-maroon text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >
                        <Icon className="h-4 w-4" /> {blueprint.stages[stage].label}
                      </button>
                    );
                  })}
                </nav>
                <button type="button" onClick={() => setModeCollapsed(true)} className="ml-2 hidden shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:inline-flex" aria-label="Collapse mode panel">
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </div>
              <div className={`min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden ${activeView === 'brief' ? 'overflow-y-auto' : 'overflow-y-hidden'}`}>
                {activeView === 'brief' ? (
                  <BriefPanel
                    assignmentDocument={assignmentDocument}
                    blueprint={blueprint}
                    briefPdfOpen={briefPdfOpen}
                    onOpenResource={openResourceFromBrief}
                    session={session}
                    setBriefPdfOpen={setBriefPdfOpen}
                  />
                ) : (
                  <WorkspaceStageContent
                    allResources={allResources}
                    blueprint={blueprint}
                    getCoachDraft={getCoachDraft}
                    handleCoachMessage={handleCoachMessage}
                    handleFinalQuizSubmitted={handleFinalQuizSubmitted}
                    handlePrepareFinalQuiz={() => handlePrepareFinalQuiz(essayEditorRef.current?.getHtml())}
                    handleResourceProgress={handleResourceProgress}
                    handleSubmit={handleSubmit}
                    finalQuiz={finalQuiz}
                    readOnly={stageSummary.readOnly}
                    previewMode={previewMode}
                    preparingFinalQuiz={preparingFinalQuiz}
                    runBuildTool={runBuildTool}
                    selectedResource={selectedResource}
                    selectedStage={selectedStage}
                    session={session}
                    setCoachDraft={setCoachDraft}
                    setSelectedResourceId={setSelectedResourceId}
                    setSourcesCollapsed={setSourcesCollapsed}
                    sendingMessage={sendingMessage}
                    syncResourceProgress={syncResourceProgress}
                    sourcesCollapsed={sourcesCollapsed}
                    submitting={submitting}
                    studentPdfSummary={studentPdfSummary}
                    setStudentPdfSummary={setStudentPdfSummary}
                    studentPdfFile={studentPdfFile}
                    setStudentPdfFile={setStudentPdfFile}
                    handleUploadStudentPdf={handleUploadStudentPdf}
                    uploadingStudentPdf={uploadingStudentPdf}
                  />
                )}
              </div>
            </section>
          )}

          {notesOpen && (
            <WorkspaceDock
              kind="notes"
              blueprint={blueprint}
              session={session}
              selectedStage={selectedStage}
              readOnly={stageSummary.readOnly}
              newNoteDraft={newNoteDraft}
              setNewNoteDraft={setNewNoteDraft}
              handleAddNote={handleAddNote}
              handleInsertNote={handleInsertNote}
              onClose={() => setNotesOpen(false)}
              paired={notesOpen && ledgerOpen}
            />
          )}
          {ledgerOpen && (
            <WorkspaceDock
              kind="ledger"
              blueprint={blueprint}
              session={session}
              selectedStage={selectedStage}
              readOnly={stageSummary.readOnly}
              newNoteDraft={newNoteDraft}
              setNewNoteDraft={setNewNoteDraft}
              handleAddNote={handleAddNote}
              handleInsertNote={handleInsertNote}
              onClose={() => setLedgerOpen(false)}
              paired={notesOpen && ledgerOpen}
            />
          )}
        </div>
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
  previewMode: boolean;
  finalQuiz: SocraticFinalQuizState | null;
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
  handlePrepareFinalQuiz: () => void;
  handleFinalQuizSubmitted: (quizDetail?: EmbeddedQuizSubmissionDetail) => void;
  handleSubmit: () => void;
  sourcesCollapsed: boolean;
  setSourcesCollapsed: Dispatch<SetStateAction<boolean>>;
  submitting: boolean;
  preparingFinalQuiz: boolean;
  sendingMessage: boolean;
  studentPdfSummary: string;
  setStudentPdfSummary: (value: string) => void;
  studentPdfFile: File | null;
  setStudentPdfFile: (value: File | null) => void;
  handleUploadStudentPdf: () => void;
  uploadingStudentPdf: boolean;
};

function WorkspaceStageContent({
  allResources,
  blueprint,
  session,
  selectedStage,
  readOnly,
  previewMode,
  finalQuiz,
  selectedResource,
  setSelectedResourceId,
  getCoachDraft,
  setCoachDraft,
  handleCoachMessage,
  handleResourceProgress,
  syncResourceProgress,
  runBuildTool,
  handlePrepareFinalQuiz,
  handleFinalQuizSubmitted,
  handleSubmit,
  sourcesCollapsed,
  setSourcesCollapsed,
  submitting,
  preparingFinalQuiz,
  sendingMessage,
  studentPdfSummary,
  setStudentPdfSummary,
  studentPdfFile,
  setStudentPdfFile,
  handleUploadStudentPdf,
  uploadingStudentPdf,
}: WorkspaceStageContentProps) {
  const stageConfig = blueprint.stages[selectedStage];
  const stageConversation = session.ledger.filter(
    (entry) =>
      entry.stage === selectedStage &&
      (entry.entryType === 'chat_prompt' || entry.entryType === 'chat_reply'),
  );
  const [readingReachedEnd, setReadingReachedEnd] = useState<Record<string, boolean>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sendingMessage) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [sendingMessage, stageConversation.at(-1)?.content]);

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
  const readingFocusMode = sourcesCollapsed;
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      <div className="min-h-0 min-w-0 max-w-full flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-4 sm:p-5">
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
        <div className="space-y-5">
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
                    className={`w-full min-w-0 rounded-2xl border px-4 py-4 text-left transition-colors ${
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
                    <div className="font-semibold text-gray-900 [overflow-wrap:anywhere]">{resource.title}</div>
                    <p className="text-sm text-gray-600 mt-1 [overflow-wrap:anywhere]">{resource.summary}</p>
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {selectedResource.type.replace('_', ' ')}
                    </p>
                    <h3 className="text-xl font-semibold text-gray-900 [overflow-wrap:anywhere]">{selectedResource.title}</h3>
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
                      onClick={() => {
                        const nextFocused = !readingFocusMode;
                        setSourcesCollapsed(nextFocused);
                      }}
                      className="hidden xl:inline-flex rounded-lg border border-brand-maroon px-3 py-2 text-xs font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white"
                    >
                      {readingFocusMode ? 'Exit Focus' : 'Focus Reading'}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 [overflow-wrap:anywhere]">{selectedResource.summary}</p>

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
                      previewMode={previewMode}
                      onProgressChange={
                        previewMode
                          ? undefined
                          : (nextState) => syncResourceProgress(selectedResource, nextState)
                      }
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
                      previewMode={previewMode}
                      onProgressChange={
                        previewMode
                          ? undefined
                          : (nextState) => syncResourceProgress(selectedResource, nextState)
                      }
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
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900">Add your own research PDF</h3>
                <p className="mt-1 text-sm text-gray-600">The source stays attached to this studio and is recorded in the ledger.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                <Upload className="h-4 w-4" /> Choose PDF
                <Input className="sr-only" type="file" accept="application/pdf" onChange={(event) => setStudentPdfFile(event.target.files?.[0] || null)} disabled={readOnly || uploadingStudentPdf} />
              </label>
            </div>
            {studentPdfFile && (
              <div className="mt-4 space-y-3">
                <div className="text-sm font-medium text-gray-800">{studentPdfFile.name}</div>
                <Textarea rows={2} value={studentPdfSummary} onChange={(event) => setStudentPdfSummary(event.target.value)} placeholder="What should this PDF help you investigate?" disabled={readOnly || uploadingStudentPdf} />
                <button type="button" onClick={handleUploadStudentPdf} disabled={readOnly || uploadingStudentPdf} className="rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {uploadingStudentPdf ? 'Attaching…' : 'Attach PDF'}
                </button>
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
          <div className="rounded-2xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">AI writing tools</h3>
            <div className="mt-4 grid gap-3">
              {[
                ['Check Clarity & Style', 'Analyze readability and tone without rewriting the draft.'],
                ['Review Argument Flow', 'Check logical structure and transitions.'],
                ['Identify Weak Points', 'Find claims that need stronger support.'],
                ['Suggest Transitions', 'Get ideas for connecting paragraphs.'],
              ].map(([title, description]) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => setCoachDraft(`${title}: Review my current draft and guide me with questions and specific feedback. Do not rewrite it for me.`)}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-colors hover:border-purple-300 hover:bg-purple-50"
                >
                  <div className="font-semibold text-gray-900">{title}</div>
                  <div className="mt-1 text-sm text-gray-600">{description}</div>
                </button>
              ))}
            </div>
          </div>
          <FinalSocraticSubmissionCard
            blueprint={blueprint}
            finalQuiz={finalQuiz}
            onFinalQuizSubmitted={handleFinalQuizSubmitted}
            onPrepareFinalQuiz={handlePrepareFinalQuiz}
            onSubmit={handleSubmit}
            preparingFinalQuiz={preparingFinalQuiz}
            previewMode={previewMode}
            readOnly={readOnly}
            session={session}
            submitting={submitting}
          />
        </div>
      )}

      <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden rounded-2xl border border-amber-200 bg-amber-50 p-5">
        {!stageConfig.aiAllowed ? (
          <div className="text-sm text-amber-900">
            AI chat is disabled for {stageConfig.label}. Continue with notes and the stage tools instead.
          </div>
        ) : (
          <div className="space-y-3">
            {stageConversation.length === 0 ? (
              <div className="rounded-xl bg-white px-4 py-3 text-sm text-gray-600">
                Start the conversation with the AI tutor for {stageConfig.label.toLowerCase()}.
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
                      {entry.actor === 'student' ? 'You' : 'AI tutor'}
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
        )}
        <div ref={chatEndRef} />
      </div>
      </div>
      {stageConfig.aiAllowed && (
        <div className="min-w-0 max-w-full shrink-0 overflow-x-hidden border-t border-amber-200 bg-amber-50/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:p-4">
          {selectedStage === 'write' && (
            <button
              type="button"
              onClick={() => setCoachDraft('Review the current draft and ask me one revision question at a time.')}
              className="mb-2 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs font-medium text-purple-800 hover:bg-purple-50"
            >
              Let the AI tutor read the current draft
            </button>
          )}
          <div className="flex min-w-0 max-w-full items-end gap-2">
            <Textarea
              rows={2}
              value={getCoachDraft()}
              onChange={(event) => setCoachDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (!readOnly && !sendingMessage && getCoachDraft().trim()) {
                    handleCoachMessage();
                  }
                }
              }}
              placeholder={`Ask the AI tutor in ${stageConfig.label.toLowerCase()}…`}
              disabled={readOnly}
              className="min-h-[64px] resize-none bg-white"
            />
            <button
              type="button"
              onClick={handleCoachMessage}
              disabled={readOnly || sendingMessage || !getCoachDraft().trim()}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-brand-maroon px-4 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">{sendingMessage ? 'Sending…' : 'Send'}</span>
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-amber-800/70">Enter to send · Shift+Enter for a new line</p>
        </div>
      )}
    </div>
  );
}

function FinalSocraticSubmissionCard({
  blueprint,
  finalQuiz,
  onFinalQuizSubmitted,
  onPrepareFinalQuiz,
  onSubmit,
  preparingFinalQuiz,
  previewMode,
  readOnly,
  session,
  submitting,
}: {
  blueprint: SocraticStudioBlueprint;
  finalQuiz: SocraticFinalQuizState | null;
  onFinalQuizSubmitted: (quizDetail?: EmbeddedQuizSubmissionDetail) => void;
  onPrepareFinalQuiz: () => void;
  onSubmit: () => void;
  preparingFinalQuiz: boolean;
  previewMode: boolean;
  readOnly: boolean;
  session: SocraticStudioSession;
  submitting: boolean;
}) {
  const essayText = session.essayHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const hasEnoughEssay = essayText.length >= 50;
  const status = finalQuiz?.status || 'disabled';
  const finalQuizEnabled = Boolean(finalQuiz?.enabled);
  const quizSubmitted = status === 'submitted' || status === 'report_ready' || status === 'system_failed';
  const canSubmitWithSystemIssue = status === 'generation_failed';
  const canSubmit = !finalQuizEnabled || quizSubmitted || canSubmitWithSystemIssue;
  const generationError =
    finalQuiz?.systemIssue || finalQuiz?.generationError || 'The final quiz could not be generated because of a system issue.';

  if (previewMode) {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 text-blue-700" />
          <div>
            <h3 className="font-semibold text-blue-950">Final quiz and submission preview</h3>
            <p className="mt-1 text-sm text-blue-900">
              Real final quiz generation appears for student workspaces after the assignment is published. Preview mode keeps this disabled so it does not create quiz attempts or submissions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!finalQuizEnabled) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-950">Final Submission</h3>
            <p className="mt-1 text-sm text-gray-600">
              This assignment uses the original Socratic submission flow without a final quiz.
            </p>
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={readOnly || submitting}
            className="rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : session.submittedAt ? 'Save Resubmission' : 'Submit Assignment'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-brand-maroon/20 bg-brand-maroon/5 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-maroon ring-1 ring-brand-maroon/20">
            <ShieldCheck className="h-4 w-4" />
            Final step
          </div>
          <h3 className="mt-3 text-xl font-semibold text-gray-950">Final quiz and submission</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-700">
            When your essay feels nearly final, generate a short MCQ quiz from your essay, ledger, notes, chats, and assignment materials. Submit the quiz first, then submit the final Socratic package.
          </p>
        </div>
        <div className="rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-gray-200">
          <div className="font-semibold capitalize text-gray-950">{status.replace('_', ' ')}</div>
          {finalQuiz?.quizScore !== null && finalQuiz?.quizScore !== undefined && (
            <div className="text-gray-600">
              Quiz score: {finalQuiz.quizScore}
              {finalQuiz.quizTotal ? ` / ${finalQuiz.quizTotal}` : ''}
            </div>
          )}
        </div>
      </div>

      {!hasEnoughEssay && !session.submittedAt && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Write more of the essay before generating the final quiz. This prevents the AI tutor from creating a weak quiz from an empty draft.
        </div>
      )}

      {status === 'stale' && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
          Your essay changed after the final quiz was generated. Regenerate and submit the quiz again before final submission.
        </div>
      )}

      {status === 'generation_failed' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {generationError} You can retry generation, or submit with this system issue recorded for the educator.
        </div>
      )}

      {finalQuiz?.quizBatchId && ['ready', 'submitted', 'report_ready'].includes(status) && !finalQuiz.isStale && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <EmbeddedOnlineQuiz
            courseId={blueprint.courseId}
            quizBatchId={finalQuiz.quizBatchId}
            onQuizSubmitted={onFinalQuizSubmitted}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-4 ring-1 ring-gray-200">
        <div className="text-sm text-gray-700">
          {session.submittedAt
            ? `Final package submitted ${new Date(session.submittedAt).toLocaleString()}.`
            : canSubmit
              ? 'Ready for final Socratic submission.'
              : 'Generate and submit the final quiz before final submission.'}
        </div>
        <div className="flex flex-wrap gap-3">
          {!quizSubmitted && (
            <button
              type="button"
              onClick={onPrepareFinalQuiz}
              disabled={readOnly || preparingFinalQuiz || !hasEnoughEssay || status === 'generating'}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-maroon px-4 py-2 text-sm font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${preparingFinalQuiz || status === 'generating' ? 'animate-spin' : ''}`} />
              {status === 'stale'
                ? 'Regenerate Final Quiz'
                : status === 'generation_failed'
                  ? 'Retry Final Quiz'
                  : 'Generate Final Quiz'}
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={readOnly || submitting || !canSubmit}
            className="rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
          >
            {submitting
              ? 'Submitting...'
              : canSubmitWithSystemIssue
                ? 'Submit With System Issue'
                : session.submittedAt
                  ? 'Save Final Submission'
                  : 'Submit Final Package'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BriefPanel({
  assignmentDocument,
  blueprint,
  briefPdfOpen,
  onOpenResource,
  session,
  setBriefPdfOpen,
}: {
  assignmentDocument: SocraticStudioBlueprint['assignmentDocument'];
  blueprint: SocraticStudioBlueprint;
  briefPdfOpen: boolean;
  onOpenResource: (resource: SocraticResource) => void;
  session: SocraticStudioSession;
  setBriefPdfOpen: (open: boolean) => void;
}) {
  const requiredResources = blueprint.resources.filter((resource) => resource.required);

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden p-4 sm:p-6">
      <section className="overflow-hidden rounded-2xl border border-red-200 bg-white">
        <div className="bg-brand-maroon px-5 py-4 text-white">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
            {blueprint.courseCode} · Assignment brief
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight">{blueprint.assignmentTitle}</h2>
        </div>
        <div className="space-y-4 p-5">
          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{blueprint.assignmentBrief}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-gray-100 pt-4 text-sm text-gray-600">
            <span><strong className="text-gray-900">{blueprint.wordCount}</strong> words</span>
            <span><strong className="text-gray-900">{blueprint.pointsPossible}</strong> points</span>
            <span>Due <strong className="text-gray-900">{blueprint.dueAt ? new Date(blueprint.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'not set'}</strong></span>
          </div>
        </div>
      </section>

      {assignmentDocument?.url && (
        <section className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <button type="button" onClick={() => setBriefPdfOpen(!briefPdfOpen)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-gray-50">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600"><FileText className="h-5 w-5" /></span>
              <div className="min-w-0"><div className="truncate font-semibold text-gray-900">{assignmentDocument.name}</div><div className="text-xs text-gray-500">Posted by educator · assignment document</div></div>
            </div>
            <span className="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">{briefPdfOpen ? 'Hide PDF' : 'View PDF'}</span>
          </button>
          {briefPdfOpen && <div className="min-w-0 max-w-full overflow-hidden border-t border-gray-200 p-3"><SocraticPdfReader url={assignmentDocument.url} title={assignmentDocument.name} /></div>}
        </section>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-gray-400" /><h3 className="font-semibold text-gray-900">Required before submitting</h3></div>
        <div className="mt-4 space-y-2">
          {requiredResources.map((resource) => {
            const progress = session.resourceProgress[resource.id];
            const complete = Boolean(progress?.completed);
            return (
              <button key={resource.id} type="button" onClick={() => onOpenResource(resource)} className="flex w-full items-center gap-3 rounded-xl bg-gray-50 px-3 py-3 text-left transition-colors hover:bg-amber-50">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${complete ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300 bg-white'}`}>{complete && <CheckCircle2 className="h-3.5 w-3.5" />}</span>
                <BookOpen className="h-4 w-4 shrink-0 text-blue-500" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{resource.title}</span>
                <span className="text-xs text-gray-400">{resource.type.replace('_', ' ')}</span>
              </button>
            );
          })}
          {requiredResources.length === 0 && <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No required research materials were attached to this assignment.</div>}
        </div>
        {requiredResources.length > 0 && <p className="mt-3 text-xs text-gray-500">Open any item to continue in Research. Progress updates automatically.</p>}
      </section>
    </div>
  );
}

function WorkspaceDock({
  kind,
  blueprint,
  session,
  selectedStage,
  readOnly,
  newNoteDraft,
  setNewNoteDraft,
  handleAddNote,
  handleInsertNote,
  onClose,
  paired,
}: {
  kind: 'notes' | 'ledger';
  blueprint: SocraticStudioBlueprint;
  session: SocraticStudioSession;
  selectedStage: SocraticStageKey;
  readOnly: boolean;
  newNoteDraft: string;
  setNewNoteDraft: (value: string) => void;
  handleAddNote: () => void;
  handleInsertNote: (noteContent: string) => void;
  onClose: () => void;
  paired: boolean;
}) {
  const isNotes = kind === 'notes';
  return (
    <aside className={`fixed inset-y-0 z-[60] flex min-w-0 flex-col border-l border-gray-200 bg-white shadow-2xl lg:static lg:z-auto lg:w-[320px] lg:shrink-0 lg:shadow-none ${paired ? `w-1/2 ${isNotes ? 'left-0 lg:left-auto' : 'right-0'}` : 'right-0 w-full max-w-sm'}`}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2 font-semibold text-gray-900">{isNotes ? <NotebookPen className="h-4 w-4 text-amber-600" /> : <FileText className="h-4 w-4 text-brand-maroon" />}{isNotes ? 'My Notes' : 'Contribution Ledger'}</div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={`Close ${kind}`}><X className="h-4 w-4" /></button>
      </div>
      {!isNotes && <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">Transparent record of AI interactions and learning activity across all four stages.</div>}
      {isNotes && (
        <div className="space-y-3 border-b border-gray-200 p-4">
          <Textarea rows={3} value={newNoteDraft} onChange={(event) => setNewNoteDraft(event.target.value)} placeholder={`Add a ${blueprint.stages[selectedStage].label.toLowerCase()} note…`} disabled={readOnly} />
          <button type="button" onClick={handleAddNote} disabled={readOnly || !newNoteDraft.trim()} className="w-full rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-amber-500 disabled:opacity-50">Add note</button>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {isNotes ? session.notes.slice().reverse().map((note) => (
          <div key={note.id} className="rounded-xl border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${getStageBadgeClasses(note.stage)}`}>{blueprint.stages[note.stage].label}</span><span className="text-[10px] text-gray-400">{new Date(note.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
            <p className="whitespace-pre-wrap text-sm leading-5 text-gray-700">{note.content}</p>
            <button type="button" onClick={() => handleInsertNote(note.content)} disabled={readOnly} className="mt-2 text-xs font-semibold text-brand-maroon hover:underline disabled:opacity-50">Insert into draft</button>
          </div>
        )) : session.ledger.slice().reverse().map((entry) => (
          <div key={entry.id} className="rounded-xl border border-gray-200 p-3">
            <div className="mb-2 flex items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${getStageBadgeClasses(entry.stage)}`}>{blueprint.stages[entry.stage].label}</span><span className="text-[10px] text-gray-400">{new Date(entry.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
            <div className="text-sm font-semibold text-gray-900">{entry.title}</div>
            <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-gray-600">{entry.content}</p>
          </div>
        ))}
        {(isNotes ? session.notes : session.ledger).length === 0 && <div className="rounded-xl border border-dashed border-gray-200 p-5 text-center text-sm text-gray-500">{isNotes ? 'Your notes will stay available across every stage.' : 'Activity will appear here as you work.'}</div>}
      </div>
    </aside>
  );
}

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
                <div className="min-w-0 flex-1 font-medium text-gray-900 [overflow-wrap:anywhere]">{resource.title}</div>
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
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Selected PDF: <span className="font-medium [overflow-wrap:anywhere]">{studentPdfFile.name}</span>
              <span className="block text-xs mt-1">
                Click Attach PDF to add it to Sources & Materials and open it in the reader.
              </span>
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
