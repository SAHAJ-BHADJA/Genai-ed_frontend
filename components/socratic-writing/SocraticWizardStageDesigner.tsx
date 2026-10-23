'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FlaskConical,
  MessageSquareText,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  SOCRATIC_STAGE_ORDER,
  SocraticStageKey,
  SocraticStudioBlueprint,
} from '@/lib/socraticWriting';

type Props = {
  blueprint: SocraticStudioBlueprint;
  onChange: (blueprint: SocraticStudioBlueprint) => void;
  onRegenerateStage: (stage: SocraticStageKey) => Promise<void>;
  onRegenerateMessage: (stage: SocraticStageKey) => Promise<void>;
  getReadinessSignature: (stage: SocraticStageKey) => string;
  getStarterSignature: (stage: SocraticStageKey) => string;
  researchMaterialsEditor: ReactNode;
};

const stageIcons = {
  clarify: MessageSquareText,
  research: BookOpen,
  build: FlaskConical,
  write: PencilLine,
} satisfies Record<SocraticStageKey, typeof MessageSquareText>;

export default function SocraticWizardStageDesigner({
  blueprint,
  onChange,
  onRegenerateStage,
  onRegenerateMessage,
  getReadinessSignature,
  getStarterSignature,
  researchMaterialsEditor,
}: Props) {
  const [activeStage, setActiveStage] = useState<SocraticStageKey>('clarify');
  const [generatingStage, setGeneratingStage] = useState<SocraticStageKey | null>(null);
  const [generatingMessageStage, setGeneratingMessageStage] = useState<SocraticStageKey | null>(null);
  const enabledStages = useMemo(
    () => SOCRATIC_STAGE_ORDER.filter((stageKey) => stageKey === 'write' || blueprint.stages[stageKey].enabled),
    [blueprint.stages],
  );
  const stage = blueprint.stages[activeStage];

  useEffect(() => {
    if (!enabledStages.includes(activeStage)) {
      setActiveStage(enabledStages[0] || 'write');
    }
  }, [activeStage, enabledStages]);

  const updateStage = (
    stageKey: SocraticStageKey,
    patch: Partial<SocraticStudioBlueprint['stages'][SocraticStageKey]>,
  ) => {
    onChange({
      ...blueprint,
      stages: {
        ...blueprint.stages,
        [stageKey]: {
          ...blueprint.stages[stageKey],
          ...patch,
          enabled: stageKey === 'write' ? true : patch.enabled ?? blueprint.stages[stageKey].enabled,
          aiAllowed: stageKey === 'clarify' || stageKey === 'build'
            ? true
            : patch.aiAllowed ?? blueprint.stages[stageKey].aiAllowed,
        },
      },
    });
  };

  const toggleStage = (stageKey: SocraticStageKey) => {
    if (stageKey === 'write') return;
    const enabled = blueprint.stages[stageKey].enabled;
    updateStage(stageKey, { enabled: !enabled });
    if (enabled && activeStage === stageKey) {
      const currentIndex = SOCRATIC_STAGE_ORDER.indexOf(stageKey);
      const nextStage = [
        ...SOCRATIC_STAGE_ORDER.slice(currentIndex + 1),
        ...SOCRATIC_STAGE_ORDER.slice(0, currentIndex),
      ].find((candidate) => candidate === 'write' || (
        candidate !== stageKey && blueprint.stages[candidate].enabled
      ));
      setActiveStage(nextStage || 'write');
    }
  };

  const readinessReady = stage.readinessQuestions.some((goal) => goal.trim());
  const messageReady = Boolean(stage.starterResponse.trim());
  const readinessStale = Boolean(
    readinessReady
      && blueprint.readinessGenerationSignatures?.[activeStage]
      && blueprint.readinessGenerationSignatures[activeStage] !== getReadinessSignature(activeStage),
  );
  const messageStale = Boolean(
    messageReady
      && blueprint.starterGenerationSignatures?.[activeStage]
      && blueprint.starterGenerationSignatures[activeStage] !== getStarterSignature(activeStage),
  );

  const regenerate = async () => {
    setGeneratingStage(activeStage);
    try {
      await onRegenerateStage(activeStage);
    } finally {
      setGeneratingStage(null);
    }
  };

  const regenerateMessage = async () => {
    setGeneratingMessageStage(activeStage);
    try {
      await onRegenerateMessage(activeStage);
    } finally {
      setGeneratingMessageStage(null);
    }
  };

  const generationInProgress = generatingStage !== null || generatingMessageStage !== null;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-lg font-semibold text-gray-900">Active stages</h2>
          <span className="text-sm text-gray-400">Click a stage to configure it; use ON/OFF to include it.</span>
        </div>
        <div className="flex flex-wrap gap-3">
          {SOCRATIC_STAGE_ORDER.map((stageKey) => {
            const Icon = stageIcons[stageKey];
            const config = blueprint.stages[stageKey];
            const active = activeStage === stageKey;
            const enabled = stageKey === 'write' || config.enabled;
            return (
              <div key={stageKey} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => setActiveStage(stageKey)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 font-semibold transition-colors ${
                    active
                      ? 'border-brand-maroon bg-brand-maroon text-white'
                      : !enabled
                        ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-brand-maroon'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {config.label}
                </button>
                <button
                  type="button"
                  disabled={stageKey === 'write'}
                  onClick={() => toggleStage(stageKey)}
                  title={stageKey === 'write' ? 'Write is required' : `${enabled ? 'Disable' : 'Enable'} ${config.label}`}
                  className={`rounded-xl px-3 py-3 text-xs font-bold transition-colors ${
                    enabled ? 'bg-yellow-400 text-gray-900' : 'bg-gray-400 text-white'
                  } disabled:cursor-not-allowed disabled:opacity-80`}
                >
                  {enabled ? 'ON' : 'OFF'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <nav className="flex overflow-x-auto border-b border-gray-200">
        {enabledStages.map((stageKey) => {
          const Icon = stageIcons[stageKey];
          const config = blueprint.stages[stageKey];
          return (
            <button
              key={stageKey}
              type="button"
              onClick={() => setActiveStage(stageKey)}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-6 py-4 text-sm font-semibold ${
                activeStage === stageKey
                  ? 'border-brand-maroon text-brand-maroon'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              {config.label}
            </button>
          );
        })}
      </nav>

      {activeStage === 'research' ? researchMaterialsEditor : null}

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gray-100 p-3">
              {(() => {
                const Icon = stageIcons[activeStage];
                return <Icon className="h-5 w-5 text-brand-maroon" />;
              })()}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{stage.label}</h3>
              <p className="text-sm text-gray-500">{stage.summary}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${
              readinessStale
                ? 'border-orange-200 bg-orange-50 text-orange-700'
                : readinessReady
                  ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
                  : 'border-gray-200 bg-gray-50 text-gray-600'
            }`}>
              {readinessStale ? 'Goals may be stale' : readinessReady ? 'Goals ready' : 'Goals needed'}
            </span>
            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${
              messageStale
                ? 'border-orange-200 bg-orange-50 text-orange-700'
                : messageReady
                  ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
                  : 'border-gray-200 bg-gray-50 text-gray-600'
            }`}>
              {messageStale ? 'Message may be stale' : messageReady ? 'Student message ready' : 'Message needed'}
            </span>
            {activeStage === 'research' || activeStage === 'write' ? (
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700">
                AI Chat
                <Switch
                  checked={stage.aiAllowed}
                  onCheckedChange={(checked) => updateStage(activeStage, { aiAllowed: checked })}
                />
              </label>
            ) : null}
          </div>
        </div>

        <div className="grid gap-5 p-5 xl:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-gray-900">Hidden readiness goals</h4>
                <p className="mt-1 text-sm text-gray-500">Private signals the tutor uses to recognize readiness.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updateStage(activeStage, {
                    readinessQuestions: [...stage.readinessQuestions, ''],
                  })}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Goal
                </button>
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  disabled={generationInProgress}
                  className="inline-flex items-center gap-1 rounded-lg border border-brand-maroon px-3 py-2 text-xs font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {generatingStage === activeStage ? 'Generating…' : 'Regenerate Goals & Message'}
                </button>
              </div>
            </div>

            <label className="mb-2 block text-sm font-semibold text-gray-700">Guidance for readiness goals</label>
            <Textarea
              rows={3}
              value={stage.readinessGuidance}
              onChange={(event) => updateStage(activeStage, {
                readinessGuidance: event.target.value,
                customInstructions: event.target.value,
              })}
              placeholder="Describe what students should understand before moving forward."
              className="mb-4 resize-y"
            />

            <div className="space-y-3">
              {stage.readinessQuestions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500">
                  Goals will be generated when you continue from Stage Designer.
                </div>
              ) : stage.readinessQuestions.map((goal, index) => (
                <div key={`${activeStage}-goal-${index}`} className="flex gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-bold text-blue-700">
                    {index + 1}
                  </div>
                  <Textarea
                    rows={2}
                    value={goal}
                    onChange={(event) => updateStage(activeStage, {
                      readinessQuestions: stage.readinessQuestions.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item),
                    })}
                    className="min-h-20 resize-y"
                  />
                  <button
                    type="button"
                    onClick={() => updateStage(activeStage, {
                      readinessQuestions: stage.readinessQuestions.filter((_, itemIndex) => itemIndex !== index),
                    })}
                    className="h-10 rounded-lg border border-gray-200 px-3 text-gray-500 hover:text-red-600"
                    aria-label={`Remove readiness goal ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-gray-900">Opening Message — {stage.label}</h4>
                <p className="mt-1 text-sm text-gray-500">The first tutor message shown when the student opens this stage.</p>
              </div>
              <button
                type="button"
                onClick={() => void regenerateMessage()}
                disabled={generationInProgress}
                title="Regenerate only this stage's opening message using the current goals and opening-message guidance."
                className="inline-flex items-center gap-1 rounded-lg border border-brand-maroon px-3 py-2 text-xs font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {generatingMessageStage === activeStage ? 'Generating…' : 'Regenerate Message'}
              </button>
            </div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Guidance for opening message</label>
            <Textarea
              rows={3}
              value={stage.starterGuidance}
              onChange={(event) => updateStage(activeStage, { starterGuidance: event.target.value })}
              placeholder="Describe the tone and focus of the opening message."
              className="mb-4 resize-y"
            />
            {messageStale ? (
              <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                Goals or guidance changed after this message was generated. Regenerate it before publishing.
              </div>
            ) : null}
            <Textarea
              rows={15}
              value={stage.starterResponse}
              onChange={(event) => updateStage(activeStage, { starterResponse: event.target.value })}
              placeholder="The opening message will be generated when you continue."
              className="min-h-80 resize-y"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
