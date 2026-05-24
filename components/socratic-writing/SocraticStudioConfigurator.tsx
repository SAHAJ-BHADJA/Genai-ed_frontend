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
  onGenerateStarterResponse,
}: SocraticStudioConfiguratorProps) {
  const [activePicker, setActivePicker] = useState<'reading' | 'quiz' | 'avatar_lecture' | null>(null);
  const [uploadingReading, setUploadingReading] = useState(false);
  const [generatingStage, setGeneratingStage] = useState<SocraticStageKey | null>(null);

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
    } finally {
      setGeneratingStage(null);
    }
  };

  const starterResponsesReady = SOCRATIC_STAGE_ORDER.filter(
    (stage) => blueprint.stages[stage].starterResponse?.trim(),
  ).length;

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
              Default prompts are locked. Add assignment-specific guidance, then generate the first Claude
              message students will see in each stage.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
            <Sparkles className="w-3.5 h-3.5" />
            {starterResponsesReady}/4 starter responses ready
          </div>
        </div>

        {SOCRATIC_STAGE_ORDER.map((stage) => {
          const Icon = stageIcons[stage];
          const stageConfig = blueprint.stages[stage];
          const hasStarterResponse = Boolean(stageConfig.starterResponse?.trim());
          const isGenerating = generatingStage === stage;

          return (
            <div key={stage} className="rounded-2xl border border-gray-200 p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="bg-brand-maroon/10 p-3 rounded-xl">
                    <Icon className="w-5 h-5 text-brand-maroon" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900">{stageConfig.label}</h4>
                    <p className="text-sm text-gray-600">{stageConfig.summary}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      hasStarterResponse
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                    }`}
                  >
                    {hasStarterResponse ? 'Starter ready' : 'Starter required'}
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

              <div className="grid xl:grid-cols-[1fr,1fr] gap-4">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Locked Default Hidden Prompt
                    </label>
                    <Textarea
                      value={stageConfig.systemPrompt}
                      readOnly
                      rows={8}
                      className="resize-none bg-gray-50 text-gray-700"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      This is the backend stage behavior. Educators can add guidance below without changing the base policy.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Assignment-Specific Instructions
                    </label>
                    <Textarea
                      value={stageConfig.customInstructions || ''}
                      onChange={(event) => updateStage(stage, { customInstructions: event.target.value })}
                      rows={5}
                      placeholder={`Optional guidance for ${stageConfig.label}. Example: gently connect website development to mobile app design where useful.`}
                      className="resize-none"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="text-sm font-medium text-gray-900">Student Starter Response</label>
                    <button
                      type="button"
                      onClick={() => void handleGenerateStarterResponse(stage)}
                      disabled={isGenerating}
                      className="inline-flex items-center gap-2 rounded-lg border border-brand-maroon px-3 py-2 text-sm font-medium text-brand-maroon hover:bg-brand-maroon hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Sparkles className="w-4 h-4" />
                      {isGenerating
                        ? 'Generating...'
                        : hasStarterResponse
                          ? 'Regenerate'
                          : 'Generate'}
                    </button>
                  </div>
                  <Textarea
                    rows={14}
                    value={stageConfig.starterResponse || ''}
                    onChange={(event) => updateStage(stage, { starterResponse: event.target.value })}
                    placeholder={`Generate or write the first Claude message for ${stageConfig.label}. This exact message appears to students when they open the studio.`}
                    className="resize-none"
                  />
                  <p className="text-xs text-gray-500">
                    Publish is blocked until Clarify, Research, Build, and Write all have starter responses.
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
