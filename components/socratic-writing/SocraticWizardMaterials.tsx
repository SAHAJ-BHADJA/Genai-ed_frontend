'use client';

import { ChangeEvent, useState } from 'react';
import { BookOpen, FileUp, Plus, Trash2, Video } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SocraticResource, SocraticStudioBlueprint } from '@/lib/socraticWriting';
import { toast } from 'sonner';

export type SocraticWizardReadingOption = {
  id: string;
  title: string;
  summary: string;
  url?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

export type SocraticWizardLinkedOption = {
  id: string;
  title: string;
  summary: string;
};

type Props = {
  blueprint: SocraticStudioBlueprint;
  availableReadings: SocraticWizardReadingOption[];
  availableQuizzes: SocraticWizardLinkedOption[];
  availableAvatarLectures: SocraticWizardLinkedOption[];
  onChange: (blueprint: SocraticStudioBlueprint) => void;
  onUploadReading: (file: File) => Promise<void>;
  onCreateQuiz: () => void;
  onCreateAvatarLecture: () => void;
};

export default function SocraticWizardMaterials({
  blueprint,
  availableReadings,
  availableQuizzes,
  availableAvatarLectures,
  onChange,
  onUploadReading,
  onCreateQuiz,
  onCreateAvatarLecture,
}: Props) {
  const [picker, setPicker] = useState<'reading' | 'quiz' | 'avatar_lecture' | null>(null);
  const [uploading, setUploading] = useState(false);

  const addResource = (resource: SocraticResource) => {
    if (blueprint.resources.some((item) => item.id === resource.id)) return;
    onChange({ ...blueprint, resources: [...blueprint.resources, resource] });
  };

  const updateResource = (id: string, patch: Partial<SocraticResource>) => {
    onChange({
      ...blueprint,
      resources: blueprint.resources.map((resource) =>
        resource.id === id ? { ...resource, ...patch } : resource),
    });
  };

  const removeResource = (id: string) => {
    onChange({
      ...blueprint,
      resources: blueprint.resources.filter((resource) => resource.id !== id),
    });
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await onUploadReading(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload the reading.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Research Materials</h2>
          <p className="mt-1 text-sm text-gray-500">Optional materials students can use during Research.</p>
        </div>
        <button
          type="button"
          onClick={() => setPicker(picker ? null : 'reading')}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-4 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover"
        >
          <Plus className="h-4 w-4" /> Add Material
        </button>
      </div>

      {picker ? (
        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {(['reading', 'quiz', 'avatar_lecture'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setPicker(type)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  picker === type ? 'bg-brand-maroon text-white' : 'bg-white text-gray-700 border border-gray-200'
                }`}
              >
                {type === 'reading' ? 'Reading / PDF' : type === 'quiz' ? 'Online Quiz' : 'Avatar Lecture'}
              </button>
            ))}
          </div>

          {picker === 'reading' ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-maroon bg-white px-3 py-2 text-sm font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white">
                  <FileUp className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload New PDF'}
                  <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
              </div>
              {availableReadings.map((reading) => (
                <div key={reading.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
                  <div>
                    <div className="font-semibold text-gray-900">{reading.title}</div>
                    <div className="mt-1 text-sm text-gray-500">{reading.summary || 'Course reading resource'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addResource({
                      id: `reading:${reading.id}`,
                      type: 'reading',
                      title: reading.title,
                      summary: reading.summary,
                      required: false,
                      createdFrom: 'existing',
                      url: reading.url,
                      storageBucket: reading.storageBucket,
                      storagePath: reading.storagePath,
                      stage: 'research',
                    })}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Attach
                  </button>
                </div>
              ))}
              {availableReadings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No existing readings found.</div>
              ) : null}
            </div>
          ) : null}

          {picker === 'quiz' ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button type="button" onClick={onCreateQuiz} className="rounded-lg border border-brand-maroon bg-white px-3 py-2 text-sm font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white">
                  Create New Quiz
                </button>
              </div>
              {availableQuizzes.map((quiz) => (
                <div key={quiz.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
                  <div><div className="font-semibold text-gray-900">{quiz.title}</div><div className="mt-1 text-sm text-gray-500">{quiz.summary}</div></div>
                  <button
                    type="button"
                    onClick={() => addResource({
                      id: `quiz:${quiz.id}`,
                      type: 'quiz',
                      title: quiz.title,
                      summary: quiz.summary,
                      required: false,
                      createdFrom: 'existing',
                      resourceRefId: quiz.id,
                      stage: 'research',
                    })}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >Attach</button>
                </div>
              ))}
              {availableQuizzes.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No published online quizzes found.</div> : null}
            </div>
          ) : null}

          {picker === 'avatar_lecture' ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button type="button" onClick={onCreateAvatarLecture} className="rounded-lg border border-brand-maroon bg-white px-3 py-2 text-sm font-semibold text-brand-maroon hover:bg-brand-maroon hover:text-white">
                  Create New Avatar Lecture
                </button>
              </div>
              {availableAvatarLectures.map((lecture) => (
                <div key={lecture.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
                  <div><div className="font-semibold text-gray-900">{lecture.title}</div><div className="mt-1 text-sm text-gray-500">{lecture.summary}</div></div>
                  <button
                    type="button"
                    onClick={() => addResource({
                      id: `avatar-lecture:${lecture.id}`,
                      type: 'avatar_lecture',
                      title: lecture.title,
                      summary: lecture.summary,
                      required: false,
                      createdFrom: 'existing',
                      resourceRefId: lecture.id,
                      stage: 'research',
                    })}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >Attach</button>
                </div>
              ))}
              {availableAvatarLectures.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No avatar lectures found.</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {blueprint.resources.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
            <BookOpen className="mx-auto mb-3 h-7 w-7" /> No materials attached yet
          </div>
        ) : blueprint.resources.map((resource) => (
          <div key={resource.id} className="rounded-xl border border-gray-200 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase text-gray-600">
                {resource.type === 'avatar_lecture' ? <Video className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                {resource.type.replace('_', ' ')}
              </span>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
                  Required
                  <Switch checked={resource.required} onCheckedChange={(checked) => updateResource(resource.id, { required: checked })} />
                </label>
                <button type="button" onClick={() => removeResource(resource.id)} className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:text-red-600" aria-label={`Remove ${resource.title}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <Input value={resource.title} onChange={(event) => updateResource(resource.id, { title: event.target.value })} className="mb-3" />
            <Textarea rows={2} value={resource.summary} onChange={(event) => updateResource(resource.id, { summary: event.target.value })} placeholder="Material description" />
          </div>
        ))}
      </div>
    </section>
  );
}
