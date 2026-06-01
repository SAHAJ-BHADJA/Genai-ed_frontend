'use client';

import { ChangeEvent, useState } from 'react';
import {
  BookOpen,
  Bot,
  Brain,
  FileUp,
  FlaskConical,
  MessageSquareText,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  SOCRATIC_STAGE_ORDER,
  SocraticResource,
  SocraticStudioBlueprint,
  SocraticStageKey,
} from '@/lib/socraticWriting';

type ExistingReadingOption = {
  id: string;
  title: string;
  summary: string;
  url?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

type ExistingLinkedOption = {
  id: string;
  title: string;
  summary: string;
};

interface SocraticStudioConfiguratorProps {
  blueprint: SocraticStudioBlueprint;
  availableResources: {
    readings: ExistingReadingOption[];
    quizzes: ExistingLinkedOption[];
    avatarLectures: ExistingLinkedOption[];
  };
  onChange: (nextBlueprint: SocraticStudioBlueprint) => void;
  onUploadReading: (file: File) => Promise<void>;
  onCreateQuiz: () => void;
  onCreateAvatarLecture: () => void;
  onGenerateReadinessQuestions: () => Promise<void>;
  onGenerateStarterResponse: (stage: SocraticStageKey) => Promise<void>;
}

const stageIcons = {
  clarify: MessageSquareText,
  research: BookOpen,
  build: FlaskConical,
  write: PencilLine,
} satisfies Record<SocraticStageKey, typeof MessageSquareText>;

const resourceLabels = {
  reading: 'Reading',
  quiz: 'Quiz',
  avatar_lecture: 'Avatar Lecture',
  lecture: 'Lecture',
  source: 'Source',
} satisfies Record<SocraticResource['type'], string>;

export default function SocraticStudioConfigurator({
  blueprint,
  availableResources,
  onChange,
  onUploadReading,
  onCreateQuiz,
  onCreateAvatarLecture,
  onGenerateReadinessQuestions,
  onGenerateStarterResponse,
}: SocraticStudioConfiguratorProps) {
  const [activePicker, setActivePicker] = useState<'reading' | 'quiz' | 'avatar_lecture' | null>(null);
  const [uploadingReading, setUploadingReading] = useState(false);
  const [generatingReadinessQuestions, setGeneratingReadinessQuestions] = useState(false);
  const [generatingStage, setGeneratingStage] = useState<SocraticStageKey | null>(null);
  const [starterSourceSignatures, setStarterSourceSignatures] = useState<Partial<Record<SocraticStageKey, string>>>(
    () =>
      SOCRATIC_STAGE_ORDER.reduce((signatures, stage) => {
        if (blueprint.stages[stage].starterResponse?.trim()) {
          signatures[stage] = JSON.stringify({
            customInstructions: blueprint.stages[stage].customInstructions || '',
            readinessQuestions: blueprint.stages[stage].readinessQuestions || [],
          });
        }
        return signatures;
      }, {} as Partial<Record<SocraticStageKey, string>>),
  );

  const updateStage = (stage: SocraticStageKey, patch: Partial<SocraticStudioBlueprint['stages'][SocraticStageKey]>) => {
    onChange({
      ...blueprint,
      stages: {
        ...blueprint.stages,
        [stage]: {
          ...blueprint.stages[stage],
          ...patch,
        },
      },
    });
  };

  const upsertResource = (resource: SocraticResource) => {
    const existingIndex = blueprint.resources.findIndex((entry) => entry.id === resource.id);
    if (existingIndex >= 0) {
      const nextResources = [...blueprint.resources];
      nextResources[existingIndex] = {
        ...nextResources[existingIndex],
        ...resource,
      };
      onChange({
        ...blueprint,
        resources: nextResources,
      });
      return;
    }

    onChange({
      ...blueprint,
      resources: [...blueprint.resources, resource],
    });
  };

  const updateResource = (resourceId: string, patch: Partial<SocraticResource>) => {
    onChange({
      ...blueprint,
      resources: blueprint.resources.map((resource) =>
        resource.id === resourceId ? { ...resource, ...patch } : resource,
      ),
    });
  };

  const removeResource = (resourceId: string) => {
    onChange({
      ...blueprint,
      resources: blueprint.resources.filter((resource) => resource.id !== resourceId),
    });
  };

  const attachExistingReading = (reading: ExistingReadingOption) => {
    upsertResource({
      id: reading.id,
      type: 'reading',
      title: reading.title,
      summary: reading.summary,
      required: false,
      createdFrom: 'existing',
      url: reading.url || null,
      storageBucket: reading.storageBucket || null,
      storagePath: reading.storagePath || null,
      stage: 'research',
    });
    setActivePicker(null);
  };

  const attachExistingQuiz = (quiz: ExistingLinkedOption) => {
    upsertResource({
      id: `quiz-${quiz.id}`,
      type: 'quiz',
      title: quiz.title,
      summary: quiz.summary,
      required: false,
      createdFrom: 'existing',
      resourceRefId: quiz.id,
      stage: 'research',
    });
    setActivePicker(null);
  };

  const attachExistingAvatarLecture = (lecture: ExistingLinkedOption) => {
    upsertResource({
      id: `avatar-${lecture.id}`,
      type: 'avatar_lecture',
      title: lecture.title,
      summary: lecture.summary,
      required: false,
      createdFrom: 'existing',
      resourceRefId: lecture.id,
      stage: 'research',
    });
    setActivePicker(null);
  };

  const handleWordCountChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...blueprint,
      wordCount: Number(event.target.value) || 0,
    });
  };

  const handleReadingUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingReading(true);
      await onUploadReading(file);
      setActivePicker(null);
      event.target.value = '';
    } finally {
      setUploadingReading(false);
    }
  };

  const handleGenerateStarterResponse = async (stage: SocraticStageKey) => {
    try {
      setGeneratingStage(stage);
      await onGenerateStarterResponse(stage);
      setStarterSourceSignatures((current) => ({
        ...current,
        [stage]: JSON.stringify({
          customInstructions: blueprint.stages[stage].customInstructions || '',
          readinessQuestions: blueprint.stages[stage].readinessQuestions || [],
        }),
      }));
    } finally {
      setGeneratingStage(null);
    }
  };

  const handleGenerateReadinessQuestions = async () => {
    try {
      setGeneratingReadinessQuestions(true);
      await onGenerateReadinessQuestions();
    } finally {
      setGeneratingReadinessQuestions(false);
    }
  };

  const updateReadinessQuestion = (stage: SocraticStageKey, index: number, value: string) => {
    const currentQuestions = blueprint.stages[stage].readinessQuestions || [];
    updateStage(stage, {
      readinessQuestions: currentQuestions.map((question, questionIndex) =>
        questionIndex === index ? value : question,
      ),
    });
  };

  const addReadinessQuestion = (stage: SocraticStageKey) => {
    updateStage(stage, {
      readinessQuestions: [...(blueprint.stages[stage].readinessQuestions || []), ''],
    });
  };

  const removeReadinessQuestion = (stage: SocraticStageKey, index: number) => {
    updateStage(stage, {
      readinessQuestions: (blueprint.stages[stage].readinessQuestions || []).filter(
        (_question, questionIndex) => questionIndex !== index,
      ),
    });
  };

  const readinessQuestionsReady = SOCRATIC_STAGE_ORDER.filter((stage) =>
    (blueprint.stages[stage].readinessQuestions || []).some((question) => question.trim()),
  ).length;

  const starterResponsesReady = SOCRATIC_STAGE_ORDER.filter(
    (stage) => blueprint.stages[stage].starterResponse?.trim(),
  ).length;

  const getStageSignature = (stage: SocraticStageKey) =>
    JSON.stringify({
      customInstructions: blueprint.stages[stage].customInstructions || '',
      readinessQuestions: blueprint.stages[stage].readinessQuestions || [],
    });

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="bg-purple-50 p-3 rounded-xl">
          <Brain className="w-6 h-6 text-purple-700" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Socratic Writing Studio</h2>
          <p className="text-sm text-gray-600 mt-1">
            Configure the four-stage Socratic writing flow, then attach only the research resources
            you actually want students to use.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Workflow</p>
          <p className="text-sm font-medium text-gray-900">Clarify - Research - Build - Write</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Model</p>
          <p className="text-sm font-medium text-gray-900 inline-flex items-center gap-2">
            <Bot className="w-4 h-4 text-brand-maroon" />
            Claude
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Word Count Target
          </label>
          <Input type="number" min={250} value={blueprint.wordCount} onChange={handleWordCountChange} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Research Resources</h3>
            <p className="text-sm text-gray-600">
              Start empty, then attach course readings, quizzes, and avatar lectures only where they
              belong. Students can still upload their own PDFs during Research.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActivePicker(activePicker === 'reading' ? null : 'reading')}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="w-4 h-4" />
              Add Reading
            </button>
            <button
              type="button"
              onClick={() => setActivePicker(activePicker === 'quiz' ? null : 'quiz')}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="w-4 h-4" />
              Add Quiz
            </button>
            <button
              type="button"
              onClick={() => setActivePicker(activePicker === 'avatar_lecture' ? null : 'avatar_lecture')}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="w-4 h-4" />
              Add Avatar Lecture
            </button>
          </div>
        </div>

        {activePicker === 'reading' && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900">Attach Reading</h4>
                <p className="text-sm text-gray-600">
                  Choose from course readings, uploaded PDFs, and lecture PDFs, or upload a new one.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-maroon px-3 py-2 text-sm font-medium text-brand-maroon hover:bg-brand-maroon hover:text-white">
                <FileUp className="w-4 h-4" />
                {uploadingReading ? 'Uploading...' : 'Upload New PDF'}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleReadingUpload}
                  disabled={uploadingReading}
                />
              </label>
            </div>
            <div className="grid gap-3">
              {availableResources.readings.map((reading) => (
                <div key={reading.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{reading.title}</div>
                      <div className="mt-1 text-sm text-gray-600">{reading.summary || 'Course reading resource.'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => attachExistingReading(reading)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Attach
                    </button>
                  </div>
                </div>
              ))}
              {availableResources.readings.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500 text-center">
                  No course reading resources found yet.
                </div>
              )}
            </div>
          </div>
        )}

        {activePicker === 'quiz' && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900">Attach Quiz</h4>
                <p className="text-sm text-gray-600">Attach an existing course quiz or create a new online quiz.</p>
              </div>
              <button
                type="button"
                onClick={onCreateQuiz}
                className="rounded-lg border border-brand-maroon px-3 py-2 text-sm font-medium text-brand-maroon hover:bg-brand-maroon hover:text-white"
              >
                Create New Quiz
              </button>
            </div>
            <div className="grid gap-3">
              {availableResources.quizzes.map((quiz) => (
                <div key={quiz.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{quiz.title}</div>
                      <div className="mt-1 text-sm text-gray-600">{quiz.summary || 'Course quiz.'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => attachExistingQuiz(quiz)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Attach
                    </button>
                  </div>
                </div>
              ))}
              {availableResources.quizzes.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500 text-center">
                  No existing course quizzes yet.
                </div>
              )}
            </div>
          </div>
        )}

        {activePicker === 'avatar_lecture' && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900">Attach Avatar Lecture</h4>
                <p className="text-sm text-gray-600">
                  Attach an existing course lecture or create a new one and return here automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={onCreateAvatarLecture}
                className="rounded-lg border border-brand-maroon px-3 py-2 text-sm font-medium text-brand-maroon hover:bg-brand-maroon hover:text-white"
              >
                Create New Avatar Lecture
              </button>
            </div>
            <div className="grid gap-3">
              {availableResources.avatarLectures.map((lecture) => (
                <div key={lecture.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{lecture.title}</div>
                      <div className="mt-1 text-sm text-gray-600">{lecture.summary || 'Course lecture.'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => attachExistingAvatarLecture(lecture)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Attach
                    </button>
                  </div>
                </div>
              ))}
              {availableResources.avatarLectures.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500 text-center">
                  No existing avatar lectures yet.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {blueprint.resources.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center text-sm text-gray-500">
              No research resources attached yet. Add readings, quizzes, or avatar lectures when the assignment is ready.
            </div>
          ) : (
            blueprint.resources.map((resource) => (
              <div key={resource.id} className="rounded-2xl border border-gray-200 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-yellow-50 border border-yellow-200 px-3 py-1 text-xs font-medium text-yellow-700">
                      {resource.type === 'avatar_lecture' ? (
                        <span className="inline-flex items-center gap-1">
                          <Video className="w-3.5 h-3.5" />
                          Avatar Lecture
                        </span>
                      ) : (
                        resourceLabels[resource.type]
                      )}
                    </div>
                    <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      {resource.createdFrom === 'existing'
                        ? 'Existing'
                        : resource.createdFrom === 'upload'
                          ? 'Uploaded'
                          : 'Newly created'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-3 text-sm font-medium text-gray-700">
                      Required
                      <Switch
                        checked={resource.required}
                        onCheckedChange={(checked) => updateResource(resource.id, { required: checked })}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeResource(resource.id)}
                      className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
                      aria-label={`Remove ${resource.title}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <Input
                  value={resource.title}
                  onChange={(event) => updateResource(resource.id, { title: event.target.value })}
                />
                <Textarea
                  rows={3}
                  value={resource.summary}
                  onChange={(event) => updateResource(resource.id, { summary: event.target.value })}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Stage Policies & Starter Responses</h3>
            <p className="text-sm text-gray-600">
              Default prompts are locked. Generate editable hidden readiness goals, add assignment-specific
              guidance, then generate the first Claude message students will see in each stage.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleGenerateReadinessQuestions()}
              disabled={generatingReadinessQuestions}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-maroon px-3 py-2 text-sm font-medium text-brand-maroon hover:bg-brand-maroon hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              {generatingReadinessQuestions ? 'Generating...' : 'Generate Readiness Questions'}
            </button>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              <Sparkles className="w-3.5 h-3.5" />
              {readinessQuestionsReady}/4 readiness goals ready
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
              <Sparkles className="w-3.5 h-3.5" />
              {starterResponsesReady}/4 starter responses ready
            </div>
          </div>
        </div>

        {SOCRATIC_STAGE_ORDER.map((stage) => {
          const Icon = stageIcons[stage];
          const stageConfig = blueprint.stages[stage];
          const hasStarterResponse = Boolean(stageConfig.starterResponse?.trim());
          const hasReadinessQuestions = (stageConfig.readinessQuestions || []).some((question) => question.trim());
          const sourceSignature = getStageSignature(stage);
          const starterMayBeStale = Boolean(
            hasStarterResponse &&
              starterSourceSignatures[stage] &&
              starterSourceSignatures[stage] !== sourceSignature,
          );
          const isGenerating = generatingStage === stage;

          return (
            <div key={stage} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3 p-5">
                  <div className="bg-brand-maroon/10 p-3 rounded-xl shrink-0">
                    <Icon className="w-5 h-5 text-brand-maroon" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900">{stageConfig.label}</h4>
                    <p className="text-sm text-gray-600">{stageConfig.summary}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 p-5">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      hasReadinessQuestions
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-gray-50 text-gray-600 border border-gray-200'
                    }`}
                  >
                    {hasReadinessQuestions ? 'Goals ready' : 'Needs goals'}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      starterMayBeStale
                        ? 'bg-orange-50 text-orange-700 border border-orange-200'
                        : hasStarterResponse
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                    }`}
                  >
                    {starterMayBeStale ? 'Starter may be stale' : hasStarterResponse ? 'Starter ready' : 'Starter required'}
                  </span>
                  <label className="inline-flex items-center gap-3 rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">
                    AI Chat
                    <Switch
                      checked={stageConfig.aiAllowed}
                      onCheckedChange={(checked) => updateStage(stage, { aiAllowed: checked })}
                    />
                  </label>
                </div>
              </div>

              <div className="border-t border-gray-100 bg-gray-50/40 p-5">
                <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="mb-3 flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                          1
                        </div>
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900">Educator guidance</h5>
                          <p className="text-xs text-gray-500">
                            Add anything Claude should emphasize for this assignment and stage.
                          </p>
                        </div>
                      </div>
                      <Textarea
                        value={stageConfig.customInstructions || ''}
                        onChange={(event) => updateStage(stage, { customInstructions: event.target.value })}
                        rows={5}
                        placeholder={`Optional guidance for ${stageConfig.label}. Example: gently connect website development to mobile app design where useful.`}
                        className="resize-none"
                      />
                      <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-700">
                          View locked default stage behavior
                        </summary>
                        <Textarea
                          value={stageConfig.systemPrompt}
                          readOnly
                          rows={7}
                          className="mt-1 resize-none border-0 bg-gray-50 text-xs text-gray-600 focus-visible:ring-0"
                        />
                      </details>
                    </div>

                    <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-semibold text-white">
                            2
                          </div>
                          <div>
                            <h5 className="text-sm font-semibold text-gray-900">Hidden readiness goals</h5>
                            <p className="text-xs text-gray-600">
                              Students do not see these. Claude guides toward them naturally and suggests the next stage only when ready.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addReadinessQuestion(stage)}
                          className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Goal
                        </button>
                      </div>

                      {(stageConfig.readinessQuestions || []).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-blue-200 bg-white p-4 text-sm text-gray-500">
                          Generate readiness questions above, or add your own goals for this stage.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {(stageConfig.readinessQuestions || []).map((question, index) => (
                            <div key={`${stage}-readiness-${index}`} className="flex gap-2">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-white text-sm font-semibold text-blue-700">
                                {index + 1}
                              </div>
                              <Textarea
                                rows={3}
                                value={question}
                                onChange={(event) => updateReadinessQuestion(stage, index, event.target.value)}
                                placeholder={`Hidden ${stageConfig.label} readiness goal ${index + 1}`}
                                className="min-h-[84px] resize-y bg-white leading-relaxed"
                              />
                              <button
                                type="button"
                                onClick={() => removeReadinessQuestion(stage, index)}
                                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-gray-500 hover:border-red-200 hover:text-red-600"
                                aria-label={`Remove readiness goal ${index + 1}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-brand-maroon/10 bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-maroon text-xs font-semibold text-white">
                          3
                        </div>
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900">Student opening message</h5>
                          <p className="text-xs text-gray-500">
                            This exact message appears first when the student opens {stageConfig.label}.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleGenerateStarterResponse(stage)}
                        disabled={isGenerating || !hasReadinessQuestions}
                        className="inline-flex items-center gap-2 rounded-lg border border-brand-maroon px-3 py-2 text-sm font-medium text-brand-maroon hover:bg-brand-maroon hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Sparkles className="w-4 h-4" />
                        {isGenerating
                          ? 'Generating...'
                          : hasStarterResponse
                            ? 'Regenerate from goals'
                            : 'Generate from goals'}
                      </button>
                    </div>

                    {starterMayBeStale && (
                      <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                        Goals or instructions changed after this starter was generated. Regenerate if the opening message should reflect the latest edits.
                      </div>
                    )}

                    <Textarea
                      rows={20}
                      value={stageConfig.starterResponse || ''}
                      onChange={(event) => {
                        updateStage(stage, { starterResponse: event.target.value });
                        setStarterSourceSignatures((current) => ({
                          ...current,
                          [stage]: sourceSignature,
                        }));
                      }}
                      placeholder={`Generate or write the first Claude message for ${stageConfig.label}.`}
                      className="min-h-[420px] resize-y text-sm leading-relaxed"
                    />
                    <p className="mt-3 text-xs text-gray-500">
                      Uses assignment context, resources, educator guidance, and hidden readiness goals. Publish is blocked until every stage has goals and a starter message.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
