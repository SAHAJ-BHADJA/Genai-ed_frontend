'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Clock3,
  Download,
  FileCheck,
  MessageSquareText,
  NotebookPen,
  Save,
  ShieldCheck,
  FlaskConical,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  buildPdfHtml,
  createInitialReviewState,
  getStageBadgeClasses,
  SOCRATIC_STAGE_ORDER,
  SocraticReviewState,
  SocraticStudioSession,
  socraticHtmlToPlainText,
} from '@/lib/socraticWriting';
import {
  fetchSocraticAssignmentReview,
  gradeSocraticWorkspace,
  retrySocraticProcessReport,
  SocraticReviewPayload,
  SocraticReviewStudent,
} from '@/lib/socraticWritingApi';

type SocraticStudioReviewProps = {
  assignmentId: string;
  onBack: () => void;
};

const asString = (value: unknown) =>
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

const asReportList = (value: unknown) => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const ratingClasses = (rating: string) => {
  if (rating === 'strong' || rating === 'process-consistent') return 'bg-green-100 text-green-800';
  if (rating === 'weak' || rating === 'process-inconsistent') return 'bg-red-100 text-red-800';
  if (rating === 'mixed' || rating === 'needs-clarification') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
};

export default function SocraticStudioReview({
  assignmentId,
  onBack,
}: SocraticStudioReviewProps) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<SocraticReviewPayload | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<SocraticReviewState>(createInitialReviewState());
  const [saving, setSaving] = useState(false);
  const [retryingReport, setRetryingReport] = useState(false);

  useEffect(() => {
    void loadReview();
  }, [assignmentId]);

  const loadReview = async () => {
    setLoading(true);
    try {
      const nextPayload = await fetchSocraticAssignmentReview(assignmentId);
      setPayload(nextPayload);
      setSelectedWorkspaceId((current) => current || nextPayload.students[0]?.workspaceId || null);
      setReviewState(nextPayload.students[0]?.review || createInitialReviewState());
    } catch (error) {
      console.error('Error loading Socratic review:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load Socratic review.');
    } finally {
      setLoading(false);
    }
  };

  const selectedStudent = useMemo(() => {
    if (!payload || !selectedWorkspaceId) return null;
    return payload.students.find((student) => student.workspaceId === selectedWorkspaceId) || null;
  }, [payload, selectedWorkspaceId]);

  const finalQuiz = selectedStudent?.finalQuiz;
  const processReport = asRecord(finalQuiz?.reportJson);
  const sourceFidelity = asRecord(processReport.source_fidelity);
  const processConsistency = asRecord(processReport.process_consistency);
  const demonstratedUnderstanding = asRecord(processReport.demonstrated_understanding);
  const overallReview = asRecord(processReport.overall_review);
  const structuredClarificationItems = [
    ...asReportList(sourceFidelity.unsupported_or_unclear_claims),
    ...asReportList(processConsistency.clarification_items),
  ];
  const clarificationItems = structuredClarificationItems.length
    ? structuredClarificationItems
    : asReportList(processReport.ai_generated_red_flags);
  const legacyAssessment = asString(processReport.ai_authenticity_assessment);

  useEffect(() => {
    setReviewState(selectedStudent?.review || createInitialReviewState());
  }, [selectedStudent]);

  const completedStages = useMemo(() => {
    if (!selectedStudent) return 0;
    return SOCRATIC_STAGE_ORDER.filter(
      (stage) => selectedStudent.stageStatuses[stage] === 'completed',
    ).length;
  }, [selectedStudent]);

  const reviewResources = useMemo(() => {
    if (!selectedStudent) return [];

    const uploadedResources = selectedStudent.ledger
      .filter((entry) => entry.entryType === 'resource_added')
      .map((entry) => ({
        id: entry.id,
        type:
          typeof entry.metadata?.resourceType === 'string'
            ? entry.metadata.resourceType
            : 'reading',
        title:
          typeof entry.metadata?.sourceTitle === 'string' && entry.metadata.sourceTitle.trim()
            ? entry.metadata.sourceTitle
            : entry.title,
        summary:
          typeof entry.metadata?.sourceSummary === 'string'
            ? entry.metadata.sourceSummary
            : entry.content,
        required: false,
        url: typeof entry.metadata?.resourceUrl === 'string' ? entry.metadata.resourceUrl : null,
        storageBucket:
          typeof entry.metadata?.storageBucket === 'string' ? entry.metadata.storageBucket : null,
        storagePath:
          typeof entry.metadata?.storagePath === 'string' ? entry.metadata.storagePath : null,
        progress: {
          opened: true,
          completed: true,
          manuallyReviewed: false,
        },
      }));

    return [...selectedStudent.resources, ...uploadedResources];
  }, [selectedStudent]);

  const handleSaveReview = async () => {
    if (!selectedStudent) return;

    try {
      setSaving(true);
      const normalizedScore =
        reviewState.score.trim() === '' ? null : Number(reviewState.score.trim());

      if (normalizedScore !== null && Number.isNaN(normalizedScore)) {
        throw new Error('Score must be a valid number.');
      }

      const result = await gradeSocraticWorkspace(
        selectedStudent.workspaceId,
        normalizedScore,
        reviewState.feedback,
        selectedStudent.currentSubmissionSnapshotId,
      );

      setPayload((current) => {
        if (!current) return current;
        return {
          ...current,
          students: current.students.map((student) =>
            student.workspaceId === selectedStudent.workspaceId
              ? {
                  ...student,
                  status: 'graded',
                  review: {
                    score: result.score === null ? '' : String(result.score),
                    feedback: result.feedback || '',
                    gradedAt: result.gradedAt,
                  },
                }
              : student,
          ),
        };
      });
      setReviewState({
        score: result.score === null ? '' : String(result.score),
        feedback: result.feedback || '',
        gradedAt: result.gradedAt,
      });
      toast.success('Socratic review saved.');
    } catch (error) {
      console.error('Error saving Socratic review:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save Socratic review.');
    } finally {
      setSaving(false);
    }
  };

  const handleRetryReport = async () => {
    if (!selectedStudent?.currentSubmissionSnapshotId) return;
    try {
      setRetryingReport(true);
      await retrySocraticProcessReport(
        selectedStudent.workspaceId,
        selectedStudent.currentSubmissionSnapshotId,
      );
      await loadReview();
      toast.success('Process Consistency Review regenerated.');
    } catch (error) {
      console.error('Error retrying Socratic process report:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to regenerate the process review.');
    } finally {
      setRetryingReport(false);
    }
  };

  const handleExportEssay = () => {
    if (!payload || !selectedStudent) return;

    const exportWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!exportWindow) return;

    const reviewSession: SocraticStudioSession = {
      activeStage: 'write',
      stageStatuses: selectedStudent.stageStatuses,
      notes: selectedStudent.notes,
      ledger: selectedStudent.ledger,
      resourceProgress: Object.fromEntries(
        selectedStudent.resources.map((resource) => [
          resource.id,
          {
            resourceId: resource.id,
            opened: resource.progress.opened,
            completed: resource.progress.completed,
            manuallyReviewed: resource.progress.manuallyReviewed,
          },
        ]),
      ),
      clarifyDraft: '',
      researchCoachDraft: '',
      buildCoachDraft: '',
      writeCoachDraft: '',
      buildArtifacts: selectedStudent.buildArtifacts,
      essayHtml: selectedStudent.essayHtml,
      essayJson: selectedStudent.essayJson,
      submittedAt: selectedStudent.submittedAt,
    };

    exportWindow.document.open();
    exportWindow.document.write(buildPdfHtml(payload.blueprint, reviewSession));
    exportWindow.document.close();
    exportWindow.focus();
    exportWindow.print();
  };

  if (loading || !payload) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading studio review...</div>
      </div>
    );
  }

  if (payload.students.length === 0 || !selectedStudent) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-3xl border border-gray-200 bg-white px-8 py-7 shadow-sm">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Assignment
          </button>
          <h1 className="text-4xl font-bold text-gray-950">{payload.assignment.assignmentTitle}</h1>
          <p className="text-gray-600 mt-3">
            No Socratic student workspaces exist for this assignment yet.
          </p>
        </div>
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
              {payload.assignment.courseCode} | Socratic review
            </p>
            <h1 className="text-4xl font-bold text-gray-950">{payload.assignment.assignmentTitle}</h1>
            <p className="text-gray-600 mt-3">
              Reviewing {selectedStudent.studentName}&rsquo;s final essay, notebook, ledger, and attached resources.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void loadReview()}
              disabled={loading}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh Review'}
            </button>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 min-w-[240px]">
              <div className="text-sm font-medium text-blue-700">Submission status</div>
              <div className="text-lg font-semibold text-blue-900 capitalize">{selectedStudent.status}</div>
              <div className="text-sm text-blue-700 mt-1">{completedStages}/4 stages completed</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-950">Student Workspace</h2>
              <p className="text-sm text-gray-600 mt-1">
                Switch between assigned students to review their studio output.
              </p>
            </div>
            <select
              value={selectedWorkspaceId || ''}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
              className="min-w-[260px] rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-maroon focus:outline-none focus:ring-2 focus:ring-brand-maroon"
            >
              {payload.students.map((student) => (
                <option key={student.workspaceId} value={student.workspaceId}>
                  {student.studentName} | {student.studentEmail || 'No email'}
                </option>
              ))}
            </select>
          </div>

          <Tabs defaultValue="essay" className="w-full">
            <div className="mb-4 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assignment context</div>
              <h3 className="mt-2 text-lg font-semibold text-gray-950">{payload.assignment.assignmentTitle}</h3>
              <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                {payload.assignment.assignmentBrief || 'No assignment description provided.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
                <span>{payload.assignment.courseCode} - {payload.assignment.courseTitle}</span>
                <span>Points: {payload.assignment.pointsPossible}</span>
                <span>
                  Due:{' '}
                  {payload.assignment.dueAt
                    ? new Date(payload.assignment.dueAt).toLocaleString()
                    : 'No due date'}
                </span>
                <span>
                  Submitted:{' '}
                  {selectedStudent.submittedAt
                    ? new Date(selectedStudent.submittedAt).toLocaleString()
                    : 'Not submitted'}
                </span>
              </div>
            </div>

            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="essay">Essay</TabsTrigger>
              <TabsTrigger value="final-report">Final Report</TabsTrigger>
              <TabsTrigger value="notes">Notebook</TabsTrigger>
              <TabsTrigger value="ledger">Ledger</TabsTrigger>
              <TabsTrigger value="resources">Resources</TabsTrigger>
            </TabsList>

            <TabsContent value="essay" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-950">Final Essay</h2>
                    <p className="text-sm text-gray-600">
                      Stored in both rich editor JSON and HTML.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportEssay}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Download className="w-4 h-4" />
                    Export PDF
                  </button>
                </div>
                <div className="whitespace-pre-wrap rounded-2xl border border-gray-200 bg-gray-50 px-6 py-5 text-sm leading-7 text-gray-800">
                  {socraticHtmlToPlainText(selectedStudent.essayHtml) || 'No submitted essay.'}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="final-report" className="mt-4">
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-950">Process Consistency Review</h2>
                  <p className="text-sm text-gray-600">
                    Evidence-based review of the submitted essay, sources, documented writing process, and demonstrated understanding.
                  </p>
                </div>
                {!selectedStudent.currentSubmissionSnapshotId && finalQuiz?.reportStatus !== 'ready' ? (
                  <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500">
                    The Process Consistency Review will be generated after the student submits the assignment.
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
                      This review evaluates consistency between the submitted work and the documented learning process. It does not determine whether AI authored the submission.
                    </div>

                    {finalQuiz?.reportStatus !== 'ready' && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        <div className="flex items-start gap-3">
                          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            Process review is {finalQuiz?.reportStatus === 'failed' ? 'unavailable' : 'being generated'} for submission version {selectedStudent.currentSubmissionVersion || '—'}.
                            {finalQuiz?.reportError ? ` ${finalQuiz.reportError}` : ''}
                          </span>
                        </div>
                        {finalQuiz?.reportStatus !== 'processing' && (
                          <button
                            type="button"
                            onClick={() => void handleRetryReport()}
                            disabled={retryingReport || !selectedStudent.currentSubmissionSnapshotId}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold text-amber-900 disabled:opacity-50"
                          >
                            {retryingReport ? 'Regenerating…' : 'Retry review'}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="rounded-xl bg-gray-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Submission</div>
                        <div className="mt-2 text-lg font-semibold capitalize text-gray-950">
                          Version {selectedStudent.currentSubmissionVersion || '—'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quiz evidence</div>
                        <div className="mt-2 text-lg font-semibold text-gray-950">
                          {(finalQuiz?.quizKind || 'disabled').replaceAll('_', ' ')}
                        </div>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quiz score</div>
                        <div className="mt-2 text-lg font-semibold text-gray-950">
                          {finalQuiz?.quizScore !== null && finalQuiz?.quizScore !== undefined
                            ? `${finalQuiz.quizScore}${finalQuiz.quizTotal ? ` / ${finalQuiz.quizTotal}` : ''}`
                            : 'Not available'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Review</div>
                        <div className="mt-2 text-lg font-semibold capitalize text-gray-950">
                          {(finalQuiz?.reportStatus || 'pending').replace('_', ' ')}
                        </div>
                      </div>
                    </div>

                    {finalQuiz?.reportStatus === 'ready' && (
                      <>
                        <div className="rounded-2xl border border-gray-200 bg-white p-5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="font-semibold text-gray-950">Overall Review</h3>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${ratingClasses(asString(overallReview.status))}`}>
                              {asString(overallReview.status).replaceAll('-', ' ') || 'Inconclusive'}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-gray-800">{asString(overallReview.rationale) || legacyAssessment}</p>
                          <p className="mt-2 text-xs text-gray-600">Confidence: {asString(overallReview.confidence) || 'low'}</p>
                          {asString(overallReview.limitations) && <p className="mt-3 text-sm leading-6 text-gray-600"><span className="font-semibold">Limitations:</span> {asString(overallReview.limitations)}</p>}
                        </div>

                        <div className="grid gap-4 lg:grid-cols-3">
                          {[
                            ['Source Fidelity', sourceFidelity],
                            ['Process Consistency', processConsistency],
                            ['Demonstrated Understanding', demonstratedUnderstanding],
                          ].map(([label, section]) => {
                            const record = section as Record<string, unknown>;
                            const rating = asString(record.rating) || 'inconclusive';
                            return (
                              <div key={label as string} className="rounded-2xl border border-gray-200 bg-white p-5">
                                <div className="flex items-center justify-between gap-2">
                                  <h3 className="font-semibold text-gray-950">{label as string}</h3>
                                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${ratingClasses(rating)}`}>{rating}</span>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-gray-700">{asString(record.rationale)}</p>
                                <p className="mt-3 text-xs text-gray-500">Confidence: {asString(record.confidence) || 'low'}</p>
                                {asString(record.quiz_interpretation) && <p className="mt-3 text-sm leading-6 text-gray-600">{asString(record.quiz_interpretation)}</p>}
                              </div>
                            );
                          })}
                        </div>

                        {asReportList(sourceFidelity.supported_claims).length > 0 && (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                            <h3 className="font-semibold text-emerald-950">Validated Source Support</h3>
                            <div className="mt-3 space-y-3">
                              {asReportList(sourceFidelity.supported_claims).map((item, index) => {
                                const record = asRecord(item);
                                return (
                                  <div key={index} className="rounded-xl bg-white/80 p-4 text-sm text-emerald-950">
                                    <blockquote className="border-l-4 border-emerald-300 pl-3 italic">{asString(record.essay_excerpt)}</blockquote>
                                    <p className="mt-2"><span className="font-semibold capitalize">{asString(record.source_type).replaceAll('_', ' ')}:</span> {asString(record.source_excerpt)}</p>
                                    <p className="mt-2 leading-6">{asString(record.explanation)}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                          <h3 className="font-semibold text-amber-950">Items Requiring Clarification</h3>
                          {clarificationItems.length ? (
                            <div className="mt-3 space-y-3">
                              {clarificationItems.map((item, index) => {
                                const record = asRecord(item);
                                const excerpt = asString(record.essay_excerpt || record.excerpt);
                                return (
                                  <div key={index} className="rounded-xl bg-white/80 p-4 text-sm text-amber-950">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Severity: {asString(record.severity)}</div>
                                    {excerpt && <blockquote className="border-l-4 border-amber-300 pl-3 italic">{excerpt}</blockquote>}
                                    <p className="mt-2 leading-6">{asString(record.reason)}</p>
                                  </div>
                                );
                              })}
                            </div>
                          ) : <p className="mt-2 text-sm text-amber-900">No evidence-based clarification items were identified.</p>}
                        </div>

                        <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
                          <h3 className="font-semibold text-green-950">Evidence of Student Development</h3>
                          {(asReportList(processConsistency.development_signals).length
                            ? asReportList(processConsistency.development_signals)
                            : asReportList(processReport.human_authorship_signals)).length ? (
                            <div className="mt-3 space-y-3">
                              {(asReportList(processConsistency.development_signals).length
                                ? asReportList(processConsistency.development_signals)
                                : asReportList(processReport.human_authorship_signals)).map((item, index) => {
                                const record = asRecord(item);
                                const finalExcerpt = asString(record.final_excerpt || record.excerpt);
                                return (
                                  <div key={index} className="rounded-xl bg-white/80 p-4 text-sm text-green-950">
                                    {finalExcerpt && <blockquote className="border-l-4 border-green-300 pl-3 italic">{finalExcerpt}</blockquote>}
                                    {asString(record.earlier_evidence) && <p className="mt-2"><span className="font-semibold">Earlier evidence:</span> {asString(record.earlier_evidence)}</p>}
                                    <p className="mt-2 leading-6">{asString(record.explanation || record.reason)}</p>
                                  </div>
                                );
                              })}
                            </div>
                          ) : <p className="mt-2 text-sm text-green-900">No validated development excerpts were returned.</p>}
                        </div>

                        {asReportList(processReport.recommended_educator_actions).length > 0 && (
                          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                            <h3 className="font-semibold text-blue-950">Recommended Educator Actions</h3>
                            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-blue-900">
                              {asReportList(processReport.recommended_educator_actions).map((item, index) => <li key={index}>{asString(item)}</li>)}
                            </ul>
                          </div>
                        )}

                        {asString(processReport.system_notes) && (
                          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                            <h3 className="font-semibold text-gray-950">System Notes</h3>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{asString(processReport.system_notes)}</p>
                          </div>
                        )}
                      </>
                    )}

                    {finalQuiz?.systemIssue && (
                      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {finalQuiz.systemIssue}
                      </div>
                    )}

                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <div className="space-y-3">
                {selectedStudent.notes.map((note) => (
                  <div key={note.id} className="rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${getStageBadgeClasses(note.stage)}`}>
                        {payload.blueprint.stages[note.stage].label}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(note.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
                {selectedStudent.notes.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 text-center">
                    No notebook entries yet.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="ledger" className="mt-4">
              <div className="space-y-3">
                {selectedStudent.ledger.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${getStageBadgeClasses(entry.stage)}`}>
                        {payload.blueprint.stages[entry.stage].label}
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
            </TabsContent>

            <TabsContent value="resources" className="mt-4">
              <div className="space-y-3">
                {reviewResources.map((resource) => {
                  const complete = resource.required ? resource.progress.completed : true;

                  return (
                    <div key={resource.id} className="rounded-2xl border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {resource.type.replace('_', ' ')}
                          </p>
                          <h3 className="text-lg font-semibold text-gray-900 [overflow-wrap:anywhere]">{resource.title}</h3>
                          <p className="text-sm text-gray-600 mt-1 [overflow-wrap:anywhere]">{resource.summary}</p>
                          {resource.url && (
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex mt-3 text-sm font-medium text-brand-maroon hover:text-brand-maroon-hover"
                            >
                              Open attached file
                            </a>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {resource.required && (
                            <div className="rounded-full bg-yellow-100 px-2 py-1 text-[11px] font-medium text-yellow-800 mb-2">
                              Required
                            </div>
                          )}
                          <div className={`text-sm font-semibold ${complete ? 'text-green-600' : 'text-gray-500'}`}>
                            {complete ? 'Completed' : 'Pending'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="rounded-2xl border border-gray-200 bg-white p-6 space-y-5 xl:sticky xl:top-8">
          <div>
            <h2 className="text-xl font-semibold text-gray-950">Review & Grade</h2>
            <p className="text-sm text-gray-600 mt-1">
              V1 review target: final essay, notebook, ledger, attached resources, score, and feedback.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                <FileCheck className="w-4 h-4" />
                Submission
              </div>
              <div className="text-lg font-semibold text-gray-900 capitalize">{selectedStudent.status}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                <Clock3 className="w-4 h-4" />
                Due
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {payload.assignment.dueAt
                  ? new Date(payload.assignment.dueAt).toLocaleString()
                  : 'No due date'}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {SOCRATIC_STAGE_ORDER.map((stage) => (
              <div key={stage} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-gray-900">
                  {stage === 'clarify' && <MessageSquareText className="w-4 h-4 text-brand-maroon" />}
                  {stage === 'research' && <BookOpen className="w-4 h-4 text-brand-maroon" />}
                  {stage === 'build' && <FlaskConical className="w-4 h-4 text-brand-maroon" />}
                  {stage === 'write' && <NotebookPen className="w-4 h-4 text-brand-maroon" />}
                  {payload.blueprint.stages[stage].label}
                </div>
                <span className="text-sm font-semibold capitalize text-gray-600">
                  {selectedStudent.stageStatuses[stage].replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>

          {finalQuiz?.enabled && (
            <div className="rounded-xl border border-brand-maroon/20 bg-brand-maroon/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-brand-maroon">
                <ShieldCheck className="h-4 w-4" />
                Final Quiz
              </div>
              <div className="mt-2 text-sm capitalize text-gray-700">
                Status: {finalQuiz.status.replace('_', ' ')}
              </div>
              {finalQuiz.quizScore !== null && finalQuiz.quizScore !== undefined && (
                <div className="mt-1 text-sm text-gray-700">
                  Score: {finalQuiz.quizScore}
                  {finalQuiz.quizTotal ? ` / ${finalQuiz.quizTotal}` : ''}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Score</label>
            <Input
              type="number"
              min={0}
              max={payload.assignment.pointsPossible}
              value={reviewState.score}
              onChange={(event) => setReviewState((current) => ({ ...current, score: event.target.value }))}
              placeholder={`Out of ${payload.assignment.pointsPossible}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Feedback</label>
            <Textarea
              rows={7}
              value={reviewState.feedback}
              onChange={(event) => setReviewState((current) => ({ ...current, feedback: event.target.value }))}
              placeholder="Summarize the student's thinking, note where the argument is strong, and identify the next revision target."
            />
          </div>
          <button
            type="button"
            onClick={handleSaveReview}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-maroon px-4 py-3 text-sm font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving Review...' : 'Save Review'}
          </button>
          {reviewState.gradedAt && (
            <div className="text-xs text-gray-500">
              Last saved {new Date(reviewState.gradedAt).toLocaleString()}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
