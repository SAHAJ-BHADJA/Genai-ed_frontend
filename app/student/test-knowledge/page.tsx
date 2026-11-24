'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, BookOpen, Check, CheckCircle2, ChevronDown, ChevronUp,
  ClipboardCheck, FileText, FolderOpen, History, Lock, Plus, RefreshCw,
  Sparkles, Trash2, Upload, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import StudentLayout from '@/components/StudentLayout';
import { hasProfileRole } from '@/lib/profileRoles';
import { Profile, supabase } from '@/lib/supabase';
import {
  deleteStudentPrivateQuiz, generateStudentPrivateQuiz, getStudentPrivateQuiz,
  listStudentPrivateQuizzes, loadStudentQuizContext, StudentPrivateQuizDetail,
  StudentPrivateQuizSummary, StudentQuizCourse, StudentQuizResult,
  submitStudentPrivateQuiz,
} from '@/lib/studentQuizApi';

type WorkspaceView = 'create' | 'library' | 'practice';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];
const STEPS = [
  { number: 1, title: 'Select Course', description: 'Choose context for your private practice quiz' },
  { number: 2, title: 'Add Source Material', description: 'Use course content, your files, or pasted text' },
  { number: 3, title: 'Quiz Settings', description: 'Configure questions and answer distribution' },
  { number: 4, title: 'Instructions', description: 'Add optional generation guidance' },
  { number: 5, title: 'Review & Generate', description: 'Confirm settings and create your private quiz' },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}
export default function TestKnowledge() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedQuizId = searchParams.get('quizId');
  const requestedCourseId = searchParams.get('courseId');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<WorkspaceView>(requestedQuizId ? 'practice' : 'create');
  const [courses, setCourses] = useState<StudentQuizCourse[]>([]);
  const [library, setLibrary] = useState<StudentPrivateQuizSummary[]>([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [expandedStep, setExpandedStep] = useState(1);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [quizName, setQuizName] = useState('');
  const [selectedMaterialKeys, setSelectedMaterialKeys] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [mcqCount, setMcqCount] = useState(5);
  const [shortAnswerCount, setShortAnswerCount] = useState(0);
  const [fixedAnswerKeyEnabled, setFixedAnswerKeyEnabled] = useState(false);
  const [fixedAnswerKey, setFixedAnswerKey] = useState<string[]>(Array(5).fill('A'));
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<StudentPrivateQuizDetail | null>(null);
  const [openingQuiz, setOpeningQuiz] = useState(false);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, string>>({});
  const [shortAnswers, setShortAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<StudentQuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) || null,
    [courses, selectedCourseId],
  );
  const totalUploadSize = uploadedFiles.reduce((total, file) => total + file.size, 0);
  const hasSource = selectedMaterialKeys.length > 0 || uploadedFiles.length > 0 || pastedText.trim().length > 0;

  const openQuiz = useCallback(async (quizId: string, updateUrl = true) => {
    setOpeningQuiz(true);
    try {
      const quiz = await getStudentPrivateQuiz(quizId);
      setActiveQuiz(quiz);
      setMcqAnswers(quiz.latestAttempt?.submittedAnswers.mcq || {});
      setShortAnswers(quiz.latestAttempt?.submittedAnswers.shortAnswer || {});
      setResult(quiz.latestAttempt?.result || null);
      setView('practice');
      if (updateUrl) router.replace(`/student/test-knowledge?quizId=${quizId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to open quiz');
    } finally { setOpeningQuiz(false); }
  }, [router]);

  const initialize = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/student/login'); return; }
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (!profileData || !hasProfileRole(profileData, 'student')) {
        await supabase.auth.signOut();
        router.push('/student/login');
        return;
      }
      setProfile(profileData);
      const [context, privateQuizzes] = await Promise.all([
        loadStudentQuizContext(), listStudentPrivateQuizzes(),
      ]);
      setCourses(context.courses);
      setLibrary(privateQuizzes);
      if (requestedCourseId && context.courses.some((course) => course.id === requestedCourseId)) {
        setSelectedCourseId(requestedCourseId);
      }
      if (requestedQuizId) await openQuiz(requestedQuizId, false);
    } catch (error) {
      console.error('Unable to load private quiz workspace:', error);
      toast.error(error instanceof Error ? error.message : 'Unable to load private quizzes');
    } finally { setLoading(false); }
  }, [openQuiz, requestedCourseId, requestedQuizId, router]);

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    setFixedAnswerKey((current) => Array.from({ length: mcqCount }, (_, index) => current[index] || 'A'));
  }, [mcqCount]);

  const refreshLibrary = async () => setLibrary(await listStudentPrivateQuizzes());

  const goToView = (nextView: WorkspaceView) => {
    setView(nextView);
    if (nextView !== 'practice') {
      setActiveQuiz(null);
      setResult(null);
      router.replace('/student/test-knowledge');
    }
  };

  const resetBuilder = () => {
    setCurrentStep(1); setExpandedStep(1); setSelectedCourseId(''); setQuizName('');
    setSelectedMaterialKeys([]); setUploadedFiles([]); setPastedText(''); setMcqCount(5);
    setShortAnswerCount(0); setFixedAnswerKeyEnabled(false); setFixedAnswerKey(Array(5).fill('A'));
    setAdditionalInstructions(''); goToView('create');
  };

  const completeStep = (step: number) => {
    if (step === 1 && (!selectedCourseId || !quizName.trim())) {
      toast.error('Select a course and enter a quiz name'); return;
    }
    if (step === 2 && !hasSource) {
      toast.error('Select course material, upload a file, or paste text'); return;
    }
    if (step === 3 && mcqCount + shortAnswerCount < 1) {
      toast.error('Add at least one question'); return;
    }
    setCurrentStep(Math.max(currentStep, step + 1));
    setExpandedStep(step + 1);
  };

  const toggleMaterial = (key: string) => setSelectedMaterialKeys((current) => (
    current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
  ));

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const accepted: File[] = [];
    for (const file of Array.from(event.target.files || [])) {
      if (!ALLOWED_EXTENSIONS.some((value) => file.name.toLowerCase().endsWith(value))) {
        toast.error(`${file.name}: only PDF, DOCX, and TXT files are supported`); continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: files must be 10MB or smaller`); continue;
      }
      accepted.push(file);
    }
    const combined = [...uploadedFiles, ...accepted].slice(0, 5);
    if (uploadedFiles.length + accepted.length > 5) toast.error('You can upload up to five files');
    if (combined.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_FILE_SIZE) {
      toast.error('Uploaded files must total 25MB or less');
    } else setUploadedFiles(combined);
    event.target.value = '';
  };

  const generateQuiz = async () => {
    if (!selectedCourseId || !quizName.trim() || !hasSource) {
      toast.error('Complete the course and source steps before generating'); return;
    }
    setGenerating(true);
    try {
      const quiz = await generateStudentPrivateQuiz({
        courseId: selectedCourseId, quizName: quizName.trim(), mcqCount, shortAnswerCount,
        fixedAnswerKeyEnabled, fixedAnswerKey, additionalInstructions, pastedText,
        materialKeys: selectedMaterialKeys, files: uploadedFiles,
      });
      setActiveQuiz(quiz); setResult(null); setMcqAnswers({}); setShortAnswers({});
      await refreshLibrary();
      setView('practice');
      router.replace(`/student/test-knowledge?quizId=${quiz.id}`);
      toast.success('Your private practice quiz is ready');
    } catch (error) {
      console.error('Private quiz generation failed:', error);
      toast.error(error instanceof Error ? error.message : 'Unable to generate quiz');
    } finally { setGenerating(false); }
  };

  const submitQuiz = async () => {
    if (!activeQuiz) return;
    setSubmitting(true);
    try {
      const submission = await submitStudentPrivateQuiz(activeQuiz.id, mcqAnswers, shortAnswers);
      setResult(submission);
      await refreshLibrary();
      setActiveQuiz(await getStudentPrivateQuiz(activeQuiz.id));
      toast.success('Attempt submitted');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit quiz');
    } finally { setSubmitting(false); }
  };

  const retryQuiz = () => {
    setMcqAnswers({}); setShortAnswers({}); setResult(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeQuiz = async (quizId: string) => {
    if (!window.confirm('Delete this private quiz and all of its attempts?')) return;
    try {
      await deleteStudentPrivateQuiz(quizId);
      setLibrary((current) => current.filter((quiz) => quiz.id !== quizId));
      if (activeQuiz?.id === quizId) goToView('library');
      toast.success('Private quiz deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete quiz');
    }
  };

  if (loading || !profile) return (
    <div className="min-h-screen flex items-center justify-center"><div className="text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-maroon border-t-transparent mx-auto" />
      <p className="mt-4 text-gray-600">Loading private quiz workspace...</p>
    </div></div>
  );

  return <StudentLayout profile={profile}>
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/student/dashboard')} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="Back to dashboard"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <div className="flex items-center gap-2"><h1 className="text-3xl font-bold text-gray-900">Private Quiz Studio</h1><PrivateBadge /></div>
            <p className="mt-1 text-gray-600">Create personal practice quizzes from your learning materials.</p>
          </div>
        </div>
        <div className="flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          <button onClick={resetBuilder} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${view === 'create' ? 'bg-brand-maroon text-white' : 'text-gray-600 hover:bg-gray-50'}`}><Plus className="h-4 w-4" />Create</button>
          <button onClick={() => goToView('library')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${view === 'library' ? 'bg-brand-maroon text-white' : 'text-gray-600 hover:bg-gray-50'}`}><FolderOpen className="h-4 w-4" />My Quizzes ({library.length})</button>
        </div>
      </header>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><div className="flex items-start gap-3"><Lock className="mt-0.5 h-5 w-5 flex-none" /><p><strong>Strictly private:</strong> quizzes, attempts, scores, and explanations are accessible only to the student who created them. They are never published to a course.</p></div></div>

      {view === 'create' && <div className="space-y-4">
        {STEPS.map((step) => {
          const expanded = expandedStep === step.number;
          const available = step.number <= currentStep;
          return <section key={step.number} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${expanded ? 'border-brand-maroon/30' : 'border-gray-200'}`}>
            <button type="button" disabled={!available} onClick={() => available && setExpandedStep(expanded ? 0 : step.number)} className="flex w-full items-center gap-4 p-5 text-left disabled:cursor-not-allowed disabled:opacity-50">
              <span className={`flex h-11 w-11 items-center justify-center rounded-full font-bold ${step.number < currentStep ? 'bg-green-600 text-white' : expanded ? 'bg-brand-maroon text-white' : 'bg-gray-100 text-gray-600'}`}>{step.number < currentStep ? <Check className="h-5 w-5" /> : step.number}</span>
              <span className="flex-1"><span className="block text-lg font-bold text-gray-900">{step.title}</span><span className="text-sm text-gray-500">{step.description}</span></span>
              {expanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
            </button>
            {expanded && step.number === 1 && <StepOne courses={courses} selectedCourseId={selectedCourseId} quizName={quizName} setQuizName={setQuizName} selectCourse={(id) => { setSelectedCourseId(id); setSelectedMaterialKeys([]); }} continueStep={() => completeStep(1)} />}
            {expanded && step.number === 2 && <StepTwo course={selectedCourse} selectedKeys={selectedMaterialKeys} toggleMaterial={toggleMaterial} files={uploadedFiles} addFiles={addFiles} removeFile={(index) => setUploadedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} totalSize={totalUploadSize} pastedText={pastedText} setPastedText={setPastedText} continueStep={() => completeStep(2)} />}
            {expanded && step.number === 3 && <StepThree mcqCount={mcqCount} setMcqCount={setMcqCount} shortCount={shortAnswerCount} setShortCount={setShortAnswerCount} fixedEnabled={fixedAnswerKeyEnabled} setFixedEnabled={setFixedAnswerKeyEnabled} fixedKey={fixedAnswerKey} setFixedKey={setFixedAnswerKey} continueStep={() => completeStep(3)} />}
            {expanded && step.number === 4 && <StepFour instructions={additionalInstructions} setInstructions={setAdditionalInstructions} continueStep={() => completeStep(4)} />}
            {expanded && step.number === 5 && <StepFive course={selectedCourse} mcqCount={mcqCount} shortCount={shortAnswerCount} materialCount={selectedMaterialKeys.length} personalSourceCount={uploadedFiles.length + (pastedText.trim() ? 1 : 0)} generating={generating} generate={generateQuiz} />}
          </section>;
        })}
      </div>}

      {view === 'library' && <QuizLibrary quizzes={library} opening={openingQuiz} openQuiz={openQuiz} removeQuiz={removeQuiz} newQuiz={resetBuilder} />}
      {view === 'practice' && activeQuiz && <PracticeQuiz quiz={activeQuiz} result={result} mcqAnswers={mcqAnswers} setMcqAnswers={setMcqAnswers} shortAnswers={shortAnswers} setShortAnswers={setShortAnswers} submitting={submitting} submit={submitQuiz} retry={retryQuiz} library={() => goToView('library')} remove={() => removeQuiz(activeQuiz.id)} />}
    </div>
  </StudentLayout>;
}
function PrivateBadge() {
  return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800"><Lock className="h-3.5 w-3.5" />Only you</span>;
}

function StepOne({ courses, selectedCourseId, quizName, setQuizName, selectCourse, continueStep }: { courses: StudentQuizCourse[]; selectedCourseId: string; quizName: string; setQuizName: (value: string) => void; selectCourse: (id: string) => void; continueStep: () => void }) {
  return <div className="space-y-5 border-t border-gray-100 p-5">
    <label className="block"><span className="mb-2 block text-sm font-semibold text-gray-800">Quiz name</span><input value={quizName} onChange={(e) => setQuizName(e.target.value)} maxLength={120} placeholder="Example: Midterm concepts practice" className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-brand-maroon focus:outline-none focus:ring-2 focus:ring-brand-maroon/20" /></label>
    <div><p className="mb-2 text-sm font-semibold text-gray-800">Select one enrolled course</p>{courses.length === 0 ? <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">You must be enrolled in a course before creating a course-based quiz.</p> : <div className="grid gap-3 md:grid-cols-2">{courses.map((course) => <button type="button" key={course.id} onClick={() => selectCourse(course.id)} className={`rounded-xl border p-4 text-left transition ${selectedCourseId === course.id ? 'border-brand-maroon bg-red-50 ring-2 ring-brand-maroon/10' : 'border-gray-200 hover:border-gray-300'}`}><div className="flex items-start gap-3"><BookOpen className="mt-0.5 h-5 w-5 text-brand-maroon" /><div><p className="font-semibold text-gray-900">{course.courseNumber} — {course.title}</p><p className="mt-1 text-xs text-gray-500">{course.instructorName || course.semester}</p></div></div></button>)}</div>}</div>
    <PrimaryButton onClick={continueStep}>Continue to sources</PrimaryButton>
  </div>;
}

function StepTwo({ course, selectedKeys, toggleMaterial, files, addFiles, removeFile, totalSize, pastedText, setPastedText, continueStep }: { course: StudentQuizCourse | null; selectedKeys: string[]; toggleMaterial: (key: string) => void; files: File[]; addFiles: (e: ChangeEvent<HTMLInputElement>) => void; removeFile: (index: number) => void; totalSize: number; pastedText: string; setPastedText: (value: string) => void; continueStep: () => void }) {
  return <div className="space-y-6 border-t border-gray-100 p-5">
    <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-gray-900">Course materials</h3><p className="text-sm text-gray-500">Select accessible material from {course?.courseNumber || 'your course'}.</p></div><span className="text-xs font-medium text-gray-500">{selectedKeys.length} selected</span></div>
      {course?.materials.length ? <div className="grid gap-2 md:grid-cols-2">{course.materials.map((material) => <label key={material.key} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50"><input type="checkbox" checked={selectedKeys.includes(material.key)} onChange={() => toggleMaterial(material.key)} className="h-4 w-4 accent-brand-maroon" /><FileText className="h-4 w-4 flex-none text-gray-500" /><span className="min-w-0 truncate text-sm text-gray-800">{material.name}</span></label>)}</div> : <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">No reusable course materials are available. Upload or paste content below.</p>}
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-dashed border-gray-300 p-5"><div className="flex items-center gap-2"><Upload className="h-5 w-5 text-brand-maroon" /><h3 className="font-semibold text-gray-900">Upload your files</h3></div><p className="mt-1 text-sm text-gray-500">PDF, DOCX, or TXT. Up to 5 files, 10MB each, 25MB total.</p><label className="mt-4 inline-flex cursor-pointer rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Choose files<input type="file" multiple accept=".pdf,.docx,.txt" onChange={addFiles} className="hidden" /></label>
        {files.length > 0 && <div className="mt-4 space-y-2">{files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-lg bg-gray-50 p-2 text-sm"><FileText className="h-4 w-4 text-gray-500" /><span className="min-w-0 flex-1 truncate">{file.name}</span><button onClick={() => removeFile(index)} className="rounded p-1 text-gray-500 hover:bg-gray-200" aria-label={`Remove ${file.name}`}><X className="h-4 w-4" /></button></div>)}<p className="text-xs text-gray-500">Total: {(totalSize / 1024 / 1024).toFixed(1)}MB</p></div>}
      </div>
      <div className="rounded-xl border border-gray-200 p-5"><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-brand-maroon" /><h3 className="font-semibold text-gray-900">Paste source text</h3></div><p className="mt-1 text-sm text-gray-500">Paste notes, a reading excerpt, or other study material.</p><textarea value={pastedText} onChange={(e) => setPastedText(e.target.value.slice(0, 50000))} rows={7} placeholder="Paste the content you want the quiz to cover..." className="mt-4 w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-brand-maroon focus:outline-none focus:ring-2 focus:ring-brand-maroon/20" /><p className="mt-1 text-right text-xs text-gray-400">{pastedText.length.toLocaleString()} / 50,000</p></div>
    </div><PrimaryButton onClick={continueStep}>Continue to settings</PrimaryButton>
  </div>;
}

function StepThree({ mcqCount, setMcqCount, shortCount, setShortCount, fixedEnabled, setFixedEnabled, fixedKey, setFixedKey, continueStep }: { mcqCount: number; setMcqCount: (value: number) => void; shortCount: number; setShortCount: (value: number) => void; fixedEnabled: boolean; setFixedEnabled: (value: boolean) => void; fixedKey: string[]; setFixedKey: (value: string[]) => void; continueStep: () => void }) {
  return <div className="space-y-6 border-t border-gray-100 p-5">
    <div className="grid gap-5 md:grid-cols-2"><NumberField label="Multiple-choice questions" value={mcqCount} max={30} setValue={setMcqCount} /><NumberField label="Short-answer questions" value={shortCount} max={20} setValue={setShortCount} /></div>
    <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-4"><input type="checkbox" checked={fixedEnabled} onChange={(e) => setFixedEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-maroon" /><span><span className="block font-semibold text-gray-900">Use a fixed MCQ answer pattern</span><span className="text-sm text-gray-500">Control which option letter is correct for each question.</span></span></label>
    {fixedEnabled && mcqCount > 0 && <div><p className="mb-3 text-sm font-semibold text-gray-800">Correct answer letters</p><div className="flex flex-wrap gap-3">{fixedKey.map((answer, index) => <label key={index} className="rounded-lg border border-gray-200 p-2 text-center"><span className="mb-1 block text-xs text-gray-500">Q{index + 1}</span><select value={answer} onChange={(e) => setFixedKey(fixedKey.map((value, itemIndex) => itemIndex === index ? e.target.value : value))} className="rounded border border-gray-300 px-2 py-1">{['A', 'B', 'C', 'D'].map((letter) => <option key={letter}>{letter}</option>)}</select></label>)}</div></div>}
    <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">Instant percentage scoring applies to MCQs. Short answers include model answers for self-review.</p><PrimaryButton onClick={continueStep}>Continue to instructions</PrimaryButton>
  </div>;
}

function NumberField({ label, value, max, setValue }: { label: string; value: number; max: number; setValue: (value: number) => void }) {
  return <label className="block"><span className="mb-2 block text-sm font-semibold text-gray-800">{label}</span><input type="number" min={0} max={max} value={value} onChange={(e) => setValue(Math.max(0, Math.min(max, Number(e.target.value))))} className="w-full rounded-lg border border-gray-300 px-4 py-3" /></label>;
}

function StepFour({ instructions, setInstructions, continueStep }: { instructions: string; setInstructions: (value: string) => void; continueStep: () => void }) {
  return <div className="space-y-4 border-t border-gray-100 p-5"><label className="block"><span className="mb-2 block text-sm font-semibold text-gray-800">Additional instructions (optional)</span><textarea value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 5000))} rows={6} placeholder="Example: Focus on applying the main concepts to realistic scenarios." className="w-full rounded-lg border border-gray-300 p-3 focus:border-brand-maroon focus:outline-none focus:ring-2 focus:ring-brand-maroon/20" /><span className="mt-1 block text-right text-xs text-gray-400">{instructions.length} / 5,000</span></label><div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">The student quiz prompt is stored separately from the educator prompt. Future student prompt changes will not affect educator generation.</div><PrimaryButton onClick={continueStep}>Review quiz</PrimaryButton></div>;
}

function StepFive({ course, mcqCount, shortCount, materialCount, personalSourceCount, generating, generate }: { course: StudentQuizCourse | null; mcqCount: number; shortCount: number; materialCount: number; personalSourceCount: number; generating: boolean; generate: () => void }) {
  const items = [['Course', `${course?.courseNumber || ''} ${course?.title || ''}`], ['Questions', `${mcqCount} MCQ + ${shortCount} short answer`], ['Course sources', String(materialCount)], ['Your sources', String(personalSourceCount)]];
  return <div className="space-y-5 border-t border-gray-100 p-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map(([label, value]) => <div key={label} className="rounded-xl bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 font-semibold text-gray-900">{value}</p></div>)}</div><div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><div className="flex gap-3"><Lock className="h-5 w-5 flex-none" /><p>This quiz will be saved only in your private library. It will not be assigned or published.</p></div></div><button onClick={generate} disabled={generating} className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-6 py-3 font-semibold text-white hover:bg-brand-maroon-hover disabled:cursor-not-allowed disabled:opacity-60">{generating ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}{generating ? 'Generating your private quiz...' : 'Generate Private Quiz'}</button>{generating && <p className="text-sm text-gray-500">Reading the selected sources and creating questions. This may take up to a minute.</p>}</div>;
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="rounded-lg bg-brand-maroon px-5 py-2.5 font-semibold text-white hover:bg-brand-maroon-hover">{children}</button>;
}

function QuizLibrary({ quizzes, opening, openQuiz, removeQuiz, newQuiz }: { quizzes: StudentPrivateQuizSummary[]; opening: boolean; openQuiz: (id: string) => void; removeQuiz: (id: string) => void; newQuiz: () => void }) {
  return <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-2xl font-bold text-gray-900">My Private Quizzes</h2><p className="text-sm text-gray-500">Only you can access these quizzes and attempts.</p></div><button onClick={newQuiz} className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-4 py-2 font-semibold text-white"><Plus className="h-4 w-4" />New quiz</button></div>
    {quizzes.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center"><ClipboardCheck className="mx-auto h-12 w-12 text-gray-300" /><h3 className="mt-3 font-semibold text-gray-900">No private quizzes yet</h3><p className="mt-1 text-sm text-gray-500">Generate your first personal practice quiz.</p></div> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{quizzes.map((quiz) => <article key={quiz.id} className="rounded-xl border border-gray-200 p-5 transition hover:shadow-md"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-lg font-bold text-gray-900">{quiz.quizName}</h3><p className="mt-1 text-sm text-gray-500">{quiz.courseNumber} — {quiz.courseTitle}</p></div><PrivateBadge /></div><div className="mt-4 grid grid-cols-2 gap-2 text-sm text-gray-600"><span>{quiz.questionCount} questions</span><span>{quiz.attemptCount} attempt{quiz.attemptCount === 1 ? '' : 's'}</span><span>{quiz.lastScorePercent === null ? 'Not attempted' : `Last score: ${quiz.lastScorePercent}%`}</span><span>{formatDate(quiz.createdAt)}</span></div><div className="mt-5 flex gap-2 border-t border-gray-100 pt-4"><button disabled={opening} onClick={() => openQuiz(quiz.id)} className="flex-1 rounded-lg bg-brand-maroon px-3 py-2 text-sm font-semibold text-white hover:bg-brand-maroon-hover">Open quiz</button><button onClick={() => removeQuiz(quiz.id)} className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${quiz.quizName}`}><Trash2 className="h-4 w-4" /></button></div></article>)}</div>}
  </section>;
}
function PracticeQuiz({ quiz, result, mcqAnswers, setMcqAnswers, shortAnswers, setShortAnswers, submitting, submit, retry, library, remove }: { quiz: StudentPrivateQuizDetail; result: StudentQuizResult | null; mcqAnswers: Record<string, string>; setMcqAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>; shortAnswers: Record<string, string>; setShortAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>; submitting: boolean; submit: () => void; retry: () => void; library: () => void; remove: () => void }) {
  return <section className="space-y-5"><div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="text-2xl font-bold text-gray-900">{quiz.quizName}</h2><PrivateBadge /></div><p className="mt-1 text-gray-500">{quiz.courseNumber} — {quiz.courseTitle}</p><div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500"><span>{quiz.questionCount} questions</span><span className="inline-flex items-center gap-1"><History className="h-4 w-4" />{quiz.attemptCount} attempt{quiz.attemptCount === 1 ? '' : 's'}</span></div></div><div className="flex gap-2"><button onClick={library} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">My quizzes</button><button onClick={remove} className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50" aria-label="Delete private quiz"><Trash2 className="h-5 w-5" /></button></div></div></div>
    {result && <div className="rounded-2xl border border-green-200 bg-green-50 p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-wide text-green-700">Latest submission · Attempt {result.attemptNumber}</p><h3 className="mt-1 text-3xl font-bold text-green-900">{result.scorePercent === null ? 'Review ready' : `${result.scorePercent}%`}</h3><p className="mt-1 text-sm text-green-800">{result.correctCount} of {result.mcqTotal ?? result.totalScoredQuestions} MCQs correct. {result.scoreNote}</p>{quiz.latestAttempt?.submittedAt && <p className="mt-1 text-xs text-green-700">Submitted {formatDateTime(quiz.latestAttempt.submittedAt)}</p>}{result.overallFeedback && <p className="mt-3 rounded-lg bg-white/70 p-3 text-sm text-green-900"><strong>Gemini feedback:</strong> {result.overallFeedback}</p>}{result.evaluationFallback && <p className="mt-2 text-xs text-amber-700">Live Gemini evaluation was temporarily unavailable; saved Gemini-generated reference feedback is shown.</p>}</div><button onClick={retry} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-5 py-2.5 font-semibold text-white hover:bg-green-800"><RefreshCw className="h-4 w-4" />Retry same quiz</button></div></div>}
    <div className="space-y-4">{quiz.quiz.mcq.map((question, questionIndex) => {
      const questionResult = result?.mcq.find((item) => item.questionIndex === questionIndex);
      return <article key={`mcq-${questionIndex}`} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div className="flex gap-3"><span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-maroon text-sm font-bold text-white">{questionIndex + 1}</span><h3 className="pt-1 font-semibold text-gray-900">{question.question}</h3></div><div className="mt-5 space-y-2">{(['A', 'B', 'C', 'D'] as const).map((letter) => {
        const selected = mcqAnswers[String(questionIndex)] === letter;
        const correct = questionResult?.correct === letter;
        const wrongSelected = Boolean(questionResult && selected && !questionResult.isCorrect);
        return <label key={letter} className={`flex items-start gap-3 rounded-xl border p-3 ${correct ? 'border-green-300 bg-green-50' : wrongSelected ? 'border-red-300 bg-red-50' : selected ? 'border-brand-maroon bg-red-50/50' : 'border-gray-200 hover:bg-gray-50'} ${result ? 'cursor-default' : 'cursor-pointer'}`}><input type="radio" name={`mcq-${questionIndex}`} disabled={Boolean(result)} checked={selected} onChange={() => setMcqAnswers((current) => ({ ...current, [String(questionIndex)]: letter }))} className="mt-1 accent-brand-maroon" /><span className="flex-1 text-sm text-gray-800"><strong>{letter}.</strong> {question.options[letter]}</span>{correct && <CheckCircle2 className="h-5 w-5 flex-none text-green-600" />}{wrongSelected && <XCircle className="h-5 w-5 flex-none text-red-600" />}</label>;
      })}</div>{questionResult && <div className={`mt-4 rounded-lg p-4 text-sm ${questionResult.isCorrect ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}><p className="font-semibold">{questionResult.isCorrect ? 'Correct' : `Correct answer: ${questionResult.correct}`}</p><p className="mt-1">{questionResult.explanation}</p></div>}</article>;
    })}
    {quiz.quiz.short_answer.map((question, questionIndex) => {
      const shortResult = result?.shortAnswer.find((item) => item.questionIndex === questionIndex);
      return <article key={`short-${questionIndex}`} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div className="flex gap-3"><span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">S{questionIndex + 1}</span><h3 className="pt-1 font-semibold text-gray-900">{question.question}</h3></div><textarea disabled={Boolean(result)} value={shortAnswers[String(questionIndex)] || ''} onChange={(e) => setShortAnswers((current) => ({ ...current, [String(questionIndex)]: e.target.value }))} rows={5} placeholder="Write your answer..." className="mt-4 w-full rounded-lg border border-gray-300 p-3 disabled:bg-gray-50" />{shortResult && <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-900"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Gemini evaluation: {(shortResult.rating || 'not evaluated').replace('_', ' ')}</p>{shortResult.scorePercent !== null && shortResult.scorePercent !== undefined && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800">{shortResult.scorePercent}%</span>}</div><p className="mt-2"><strong>Your answer:</strong> {shortResult.submitted || 'No answer provided'}</p>{shortResult.feedback && <p className="mt-2"><strong>Feedback:</strong> {shortResult.feedback}</p>}<p className="mt-2"><strong>Model answer:</strong> {shortResult.modelAnswer}</p></div>}</article>;
    })}</div>
    {!result && <div className="sticky bottom-4 rounded-xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-gray-600">Answered {Object.keys(mcqAnswers).length} of {quiz.mcqCount} MCQs. Unanswered questions are scored as incorrect.</p><button disabled={submitting} onClick={submit} className="rounded-lg bg-brand-maroon px-6 py-3 font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-60">{submitting ? 'Submitting...' : 'Submit Attempt'}</button></div></div>}
  </section>;
}
