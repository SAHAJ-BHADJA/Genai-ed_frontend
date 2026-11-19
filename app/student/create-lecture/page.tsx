'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, Profile, Course } from '@/lib/supabase';
import StudentLayout from '@/components/StudentLayout';
import { ArrowLeft, Upload, File, Check, ChevronDown, ChevronUp, Info, Video, Mic, FileText, Sparkles, CheckCircle, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { getBackendBase } from '@/lib/backend';
import { validateFileSize } from '@/lib/fileUpload';
import { hasProfileRole } from '@/lib/profileRoles';
import { AvatarName, AvatarVoiceMap } from '@/lib/avatarVoiceMap';

type MaterialWithType = {
  url: string;
  name: string;
  type: 'main' | 'background';
  sourceCourseId?: string;
  courseTitle?: string;
  courseCode?: string;
};

type AvatarType = AvatarName;

type PrivateArtifact = {
  id: string;
  artifactType: 'video_avatar' | 'video_avatar_mp4' | 'audio' | 'audio_mp3' | 'pptx' | 'ppt';
  url: string;
  expiresIn: number;
  createdAt: string;
};

type GenerationStatus = {
  state: 'running' | 'succeeded' | 'failed';
  complete: boolean;
  errors?: Array<{ job_type?: string; message?: string }>;
};

const BACKEND_URL = getBackendBase().replace(/\/$/, '');

export default function CreateLecture() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lectureId = searchParams.get('lectureId');
  const requestedCourseId = searchParams.get('courseId');
  const requestedPrompt = searchParams.get('prompt');
  const requestedVideoLength = Number(searchParams.get('videoLength'));

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [expandedStep, setExpandedStep] = useState(1);

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);

  const [preloadedMaterials, setPreloadedMaterials] = useState<Array<{ url: string; name: string; courseTitle: string; courseCode: string; sourceCourseId: string }>>([]);
  const [selectedPreloadedMaterialUrls, setSelectedPreloadedMaterialUrls] = useState<string[]>([]);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
  const [allMaterials, setAllMaterials] = useState<MaterialWithType[]>([]);

  const [contentStyles, setContentStyles] = useState<string[]>([]);

  const [scriptMode, setScriptMode] = useState<'direct' | 'ai'>('ai');
  const [scriptDirect, setScriptDirect] = useState('');
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [aiPrompt, setAiPrompt] = useState(requestedPrompt || '');
  const [videoLength, setVideoLength] = useState(
    Number.isFinite(requestedVideoLength) && requestedVideoLength >= 1 && requestedVideoLength <= 5
      ? requestedVideoLength
      : 1,
  );
  const [generatedScript, setGeneratedScript] = useState('');
  const [scriptGenerated, setScriptGenerated] = useState(false);

  const [selectedAvatar, setSelectedAvatar] = useState<AvatarType | null>(null);
  const [selectedAvatarStyle, setSelectedAvatarStyle] = useState<string>('');

  const [contentGenerated, setContentGenerated] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [privateArtifacts, setPrivateArtifacts] = useState<PrivateArtifact[]>([]);

  const additionalFilesInputRef = useRef<HTMLInputElement>(null);
  const scriptFileInputRef = useRef<HTMLInputElement>(null);
  const isCreatingDraftRef = useRef(false);

  const loadPrivateArtifacts = async (accessToken: string) => {
    if (!lectureId) return [] as PrivateArtifact[];
    const response = await fetch(`${BACKEND_URL}/api/lectures/${lectureId}/private-artifacts`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('Generation completed, but the secure preview could not be loaded.');
    }
    const payload = await response.json();
    const artifacts = (payload.artifacts || []) as PrivateArtifact[];
    setPrivateArtifacts(artifacts);
    return artifacts;
  };

  const waitForGeneration = async (accessToken: string): Promise<GenerationStatus> => {
    if (!lectureId) throw new Error('No lecture draft found');
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await fetch(`${BACKEND_URL}/api/lectures/${lectureId}/generation-status`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(payload?.detail || 'Unable to check generation progress.');
      }
      const status = await response.json() as GenerationStatus;
      if (status.complete && status.state === 'succeeded') return status;
      if (status.state === 'failed') {
        const details = (status.errors || [])
          .map((error) => `${error.job_type || 'media'}: ${error.message || 'generation failed'}`)
          .join('; ');
        throw new Error(details || 'One or more requested files could not be generated.');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
    }
    throw new Error('Generation is still running. You can safely leave this page and return later.');
  };

  const resumeGeneration = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    setIsGenerating(true);
    try {
      await waitForGeneration(session.access_token);
      await loadPrivateArtifacts(session.access_token);
      setContentGenerated(true);
      setCurrentStep(6);
      setExpandedStep(6);
      toast.success('Private avatar lecture generated successfully!');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to monitor private lecture generation');
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (selectedCourseIds.length > 0) {
      loadCourseMaterials();
    } else {
      setPreloadedMaterials([]);
      setSelectedPreloadedMaterialUrls([]);
    }
  }, [selectedCourseIds]);

  useEffect(() => {
    if (!lectureId || !contentGenerated || privateArtifacts.length > 0) return;
    let cancelled = false;

    const loadGeneratedPreview = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const response = await fetch(`${BACKEND_URL}/api/lectures/${lectureId}/private-artifacts`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      if (!response.ok || cancelled) return;

      const payload = await response.json();
      if (!cancelled) {
        setPrivateArtifacts((payload.artifacts || []) as PrivateArtifact[]);
      }
    };

    void loadGeneratedPreview();
    return () => {
      cancelled = true;
    };
  }, [contentGenerated, lectureId, privateArtifacts.length]);

  const checkAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/student/login');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || !hasProfileRole(profileData, 'student')) {
        await supabase.auth.signOut();
        router.push('/student/login');
        return;
      }

      setProfile(profileData);

      const { data: enrollmentsData } = await supabase
        .from('course_students')
        .select('course_id')
        .eq('email', user.email!);

      if (enrollmentsData && enrollmentsData.length > 0) {
        const courseIds = enrollmentsData.map(e => e.course_id);
        const { data: coursesData } = await supabase
          .from('courses')
          .select('*')
          .in('id', courseIds)
          .order('created_at', { ascending: false });

        if (coursesData) {
          setCourses(coursesData);

          if (lectureId) {
            const { data: draftLecture } = await supabase
              .from('lectures')
              .select('title,course_id,selected_course_ids,content_style,script_mode,script_text,script_prompt,video_length,avatar_character,avatar_style,status')
              .eq('id', lectureId)
              .eq('creator_role', 'student')
              .eq('creator_user_id', user.id)
              .maybeSingle();

            if (!draftLecture) {
              toast.error('Private lecture not found');
              router.push('/student/dashboard');
              return;
            }

            const draftCourseIds = Array.isArray(draftLecture.selected_course_ids)
              ? draftLecture.selected_course_ids
              : draftLecture.course_id
                ? [draftLecture.course_id]
                : [];
            setSelectedCourseIds(draftCourseIds);
            setContentStyles(Array.isArray(draftLecture.content_style) ? draftLecture.content_style : []);
            setScriptMode(draftLecture.script_mode === 'direct' ? 'direct' : 'ai');
            setAiPrompt(draftLecture.script_prompt || '');
            setVideoLength(draftLecture.video_length || 1);
            setGeneratedScript(draftLecture.script_text || '');
            setScriptGenerated(Boolean(draftLecture.script_text));
            setSelectedAvatar((draftLecture.avatar_character as AvatarType) || null);
            setSelectedAvatarStyle(draftLecture.avatar_style || '');
            setContentGenerated(draftLecture.status === 'completed');
            if (draftLecture.status === 'completed') {
              setCurrentStep(7);
              setExpandedStep(7);
            } else if (draftLecture.status === 'generating') {
              setCurrentStep(6);
              setExpandedStep(6);
              void resumeGeneration();
            } else if (draftLecture.avatar_character && draftLecture.avatar_style) {
              setCurrentStep(6);
              setExpandedStep(6);
            } else if (draftLecture.script_text) {
              setCurrentStep(5);
              setExpandedStep(5);
            } else if (Array.isArray(draftLecture.content_style) && draftLecture.content_style.length > 0) {
              setCurrentStep(4);
              setExpandedStep(4);
            } else {
              setCurrentStep(2);
              setExpandedStep(2);
            }
          } else if (requestedCourseId && courseIds.includes(requestedCourseId)) {
            setSelectedCourseIds([requestedCourseId]);
          }
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCourseMaterials = () => {
    const materials: Array<{ url: string; name: string; courseTitle: string; courseCode: string; sourceCourseId: string }> = [];

    selectedCourseIds.forEach(courseId => {
      const course = courses.find(c => c.id === courseId);
      if (course) {
        const courseMaterials = course.course_materials_data ||
          (course.course_materials_urls?.map(url => ({
            url,
            displayName: url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Material',
            fileName: url.split('/').pop() || 'file'
          })) || []);

        courseMaterials.forEach((material) => {
          materials.push({
            url: material.url,
            name: material.displayName,
            courseTitle: course.title,
            courseCode: course.course_number,
            sourceCourseId: course.id
          });
        });

        const backgroundMaterials = course.background_materials_data ||
          (course.background_materials_urls?.map(url => ({
            url,
            displayName: url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Material',
            fileName: url.split('/').pop() || 'file'
          })) || []);

        backgroundMaterials.forEach((material) => {
          materials.push({
            url: material.url,
            name: material.displayName,
            courseTitle: course.title,
            courseCode: course.course_number,
            sourceCourseId: course.id
          });
        });
      }
    });

    setPreloadedMaterials(materials);
  };

  const toggleCourse = (courseId: string) => {
    setSelectedCourseIds(prev =>
      prev.includes(courseId)
        ? prev.filter(id => id !== courseId)
        : [...prev, courseId]
    );
  };

  const togglePreloadedMaterial = (url: string) => {
    const isCurrentlySelected = selectedPreloadedMaterialUrls.includes(url);

    if (isCurrentlySelected) {
      setSelectedPreloadedMaterialUrls(prev => prev.filter(u => u !== url));
      setAllMaterials(prev => prev.filter(m => m.url !== url));
    } else {
      setSelectedPreloadedMaterialUrls(prev => [...prev, url]);

      const material = preloadedMaterials.find(m => m.url === url);
      if (material) {
        setAllMaterials(prev => [...prev, {
          url: material.url,
          name: material.name,
          type: 'main',
          sourceCourseId: material.sourceCourseId,
          courseTitle: material.courseTitle,
          courseCode: material.courseCode
        }]);
      }
    }
  };

  const handleAdditionalFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    const newMaterials: MaterialWithType[] = [];

    Array.from(files).forEach(file => {
      if (!validateFileSize(file, 10)) {
        toast.error(`${file.name} exceeds 10MB limit`);
        return;
      }
      validFiles.push(file);

      newMaterials.push({
        url: `temp-${file.name}-${Date.now()}`,
        name: file.name,
        type: 'main'
      });
    });

    setAdditionalFiles(prev => [...prev, ...validFiles]);
    setAllMaterials(prev => [...prev, ...newMaterials]);
  };

  const removeAdditionalFile = (index: number) => {
    const fileToRemove = additionalFiles[index];
    if (fileToRemove) {
      setAllMaterials(prev => prev.filter(m => !m.url.includes(fileToRemove.name)));
    }
    setAdditionalFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleScriptFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFileSize(file, 5)) {
      toast.error('Script file exceeds 5MB limit');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.txt')) {
      toast.error('Direct script upload currently supports TXT files');
      return;
    }

    const text = await file.text();
    if (!text.trim()) {
      toast.error('The script file is empty');
      return;
    }

    setScriptFile(file);
    setScriptDirect(text);
  };

  const handleContinueToMaterials = async () => {
    if (selectedCourseIds.length === 0) {
      toast.error('Please select at least one course');
      return;
    }

    if (!lectureId) {
      if (isCreatingDraftRef.current) return;
      isCreatingDraftRef.current = true;
      setIsSavingDraft(true);
      const releaseDraftLock = () => {
        isCreatingDraftRef.current = false;
        setIsSavingDraft(false);
      };

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        releaseDraftLock();
        toast.error('You must be logged in');
        return;
      }

      const primaryCourseId = selectedCourseIds[0];
      if (!primaryCourseId) {
        releaseDraftLock();
        toast.error('Please select at least one course');
        return;
      }

      const { data: existingDrafts, error: existingDraftError } = await supabase
        .from('lectures')
        .select('id')
        .eq('creator_role', 'student')
        .eq('creator_user_id', user.id)
        .eq('course_id', primaryCourseId)
        .in('status', ['draft', 'failed'])
        .order('updated_at', { ascending: false })
        .limit(1);

      if (existingDraftError) {
        releaseDraftLock();
        console.error('Error checking existing private draft:', existingDraftError);
        toast.error('Failed to check existing private drafts');
        return;
      }

      if (existingDrafts && existingDrafts.length > 0) {
        router.push(`/student/create-lecture?lectureId=${existingDrafts[0].id}&courseId=${primaryCourseId}`);
        return;
      }

      const { data: draftLecture, error } = await supabase
        .from('lectures')
        .insert({
          creator_role: 'student',
          creator_user_id: user.id,
          educator_id: user.id,
          course_id: primaryCourseId,
          selected_course_ids: selectedCourseIds,
          title: aiPrompt.trim().slice(0, 100) || 'Private Avatar Lecture',
          content_style: [],
          script_prompt: aiPrompt.trim() || null,
          video_length: videoLength,
          status: 'draft'
        })
        .select()
        .single();

      if (error) {
        releaseDraftLock();
        console.error('Error creating draft:', error);
        toast.error('Failed to save draft');
        return;
      }

      if (draftLecture) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          await supabase.from('lectures').delete().eq('id', draftLecture.id);
          releaseDraftLock();
          toast.error('Session expired. Please log in again.');
          return;
        }

        const courseLinkResponse = await fetch(
          `${BACKEND_URL}/api/lectures/${draftLecture.id}/private-course-links`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ courseIds: selectedCourseIds }),
          },
        );

        if (!courseLinkResponse.ok) {
          const courseLinkError = await courseLinkResponse.text();
          await supabase.from('lectures').delete().eq('id', draftLecture.id);
          releaseDraftLock();
          console.error('Error linking private lecture to course:', courseLinkError);
          toast.error('Failed to link the lecture to your course');
          return;
        }

        router.push(`/student/create-lecture?lectureId=${draftLecture.id}&courseId=${primaryCourseId}`);
        return;
      }

      releaseDraftLock();
    }

    setCurrentStep(2);
    setExpandedStep(2);
  };

  const handleContinueToContentStyle = async () => {
    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    const selectedCourseMaterials = allMaterials.filter((material) => material.sourceCourseId);
    const { error: deleteError } = await supabase
      .from('lecture_materials')
      .delete()
      .eq('lecture_id', lectureId);

    if (deleteError) {
      console.error('Error resetting lecture materials:', deleteError);
      toast.error('Failed to save selected materials');
      return;
    }

    if (selectedCourseMaterials.length > 0) {
      const { error: materialError } = await supabase
        .from('lecture_materials')
        .insert(selectedCourseMaterials.map((material) => ({
          lecture_id: lectureId,
          material_url: material.url,
          material_name: material.name,
          material_type: material.type,
          source_type: 'course_preloaded',
          source_course_id: material.sourceCourseId,
        })));

      if (materialError) {
        console.error('Error saving lecture materials:', materialError);
        toast.error('Failed to save selected materials');
        return;
      }
    }

    setCurrentStep(3);
    setExpandedStep(3);
  };

  const changeMaterialType = (url: string, type: 'main' | 'background') => {
    setAllMaterials(prev =>
      prev.map(m => (m.url === url ? { ...m, type } : m))
    );
  };

  const toggleContentStyle = (style: string) => {
    setContentStyles(prev =>
      prev.includes(style)
        ? prev.filter(s => s !== style)
        : [...prev, style]
    );
  };

  const handleContinueToScriptPrompt = async () => {
    if (contentStyles.length === 0) {
      toast.error('Please select at least one content style');
      return;
    }

    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    const { error } = await supabase
      .from('lectures')
      .update({ content_style: contentStyles })
      .eq('id', lectureId)
      .eq('creator_role', 'student');

    if (error) {
      console.error('Error saving content styles:', error);
      toast.error('Failed to save content styles');
      return;
    }

    setCurrentStep(4);
    setExpandedStep(4);
  };

  const handleGenerateScript = async () => {
    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    if (!aiPrompt.trim()) {
      toast.error('Please enter an AI prompt');
      return;
    }

    setIsGenerating(true);
    toast.info('Generating script...');

    try {
      const { error: updateError } = await supabase
        .from('lectures')
        .update({
          script_mode: 'ai',
          script_prompt: aiPrompt,
          video_length: videoLength,
          title: aiPrompt.trim().slice(0, 100) || 'Private Avatar Lecture',
          content_style: contentStyles,
        })
        .eq('id', lectureId);

      if (updateError) throw updateError;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expired. Please log in again.');

      const resp = await fetch(`${BACKEND_URL}/api/lectures/${lectureId}/generate-script`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        }
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Backend error (${resp.status}): ${errText}`);
      }

      const result = await resp.json();
      const realScript = result?.script;

      if (!realScript || typeof realScript !== 'string') {
        throw new Error('Backend returned an invalid script payload');
      }

      const { error: scriptSaveError } = await supabase
        .from('lectures')
        .update({
          script_text: realScript,
          script_mode: 'ai'
        })
        .eq('id', lectureId);

      if (scriptSaveError) throw scriptSaveError;

      setGeneratedScript(realScript);
      setScriptGenerated(true);
      toast.success('Script generated successfully!');
    } catch (error) {
      console.error('Error generating script:', error);
      toast.error('Failed to generate script');

    } finally {
      setIsGenerating(false);
    }
  };

  const handleContinueToAvatarSelection = async () => {
    if (scriptMode === 'direct' && !scriptDirect && !scriptFile) {
      toast.error('Please enter a script or upload a script file');
      return;
    }

    if (scriptMode === 'ai' && !scriptGenerated) {
      toast.error('Please generate a script first');
      return;
    }

    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    let scriptText = generatedScript;
    if (scriptMode === 'direct') {
      const directText = scriptDirect.trim();
      scriptText = `TITLE:\nPrivate Avatar Lecture\n\nVIDEO SCRIPT:\n${directText}\n\nAUDIO SCRIPT:\n${directText}\n\nPPT SCRIPT:\nSLIDE 1: Private Avatar Lecture\n- ${directText.slice(0, 300)}`;
    }

    const { error } = await supabase
      .from('lectures')
      .update({
        script_mode: scriptMode,
        script_text: scriptText,
        content_style: contentStyles,
        video_length: videoLength,
        title: aiPrompt.trim().slice(0, 100) || 'Private Avatar Lecture',
      })
      .eq('id', lectureId)
      .eq('creator_role', 'student');

    if (error) {
      console.error('Error saving private lecture script:', error);
      toast.error('Failed to save the script');
      return;
    }

    setGeneratedScript(scriptText);
    setScriptGenerated(true);
    setCurrentStep(5);
    setExpandedStep(5);
  };

  const handleContinueToGenerateContent = async () => {
    if (!selectedAvatar) {
      toast.error('Please select an avatar');
      return;
    }

    if (!selectedAvatarStyle) {
      toast.error('Please select an avatar style');
      return;
    }

    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    const { error } = await supabase
      .from('lectures')
      .update({
        avatar_character: selectedAvatar,
        avatar_style: selectedAvatarStyle,
        avatar_voice_id: AvatarVoiceMap[selectedAvatar].voiceId,
        content_style: contentStyles,
      })
      .eq('id', lectureId)
      .eq('creator_role', 'student');

    if (error) {
      console.error('Error saving avatar selection:', error);
      toast.error('Failed to save avatar selection');
      return;
    }

    setCurrentStep(6);
    setExpandedStep(6);
  };

  const handleGenerateContent = async () => {
    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    setIsGenerating(true);
    toast.info('Generating your private content. This may take several minutes...');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expired. Please log in again.');

      const response = await fetch(`${BACKEND_URL}/api/lectures/${lectureId}/generate-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(errorPayload?.detail || 'Private lecture generation failed. Please try again.');
      }

      await response.json();
      toast.info('Generation queued. You may leave this page while it finishes.');
      await waitForGeneration(session.access_token);
      await loadPrivateArtifacts(session.access_token);

      setContentGenerated(true);
      setCurrentStep(6);
      setExpandedStep(6);
      toast.success('Private avatar lecture generated successfully!');
    } catch (error) {
      console.error('Error generating private lecture:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate private lecture');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGoToPublish = () => {
    setCurrentStep(7);
    setExpandedStep(7);
  };

  const handlePublishContent = () => {
    if (!lectureId) return;
    const courseId = selectedCourseIds[0] || requestedCourseId;
    if (courseId) {
      router.push(`/student/course/${courseId}/my/lecture/${lectureId}`);
    } else {
      router.push('/student/dashboard');
    }
  };

  const getFileExtension = (filename: string) => {
    const ext = filename.split('.').pop()?.toUpperCase();
    return ext || 'FILE';
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const steps = [
    { number: 1, title: 'Select Course', subtitle: 'Choose the course context for your private lecture' },
    { number: 2, title: 'Select Materials', subtitle: 'Add any additional materials for the lecture' },
    { number: 3, title: 'Select Content Style', subtitle: 'Choose one or more content formats' },
    { number: 4, title: 'Script or Prompt Engineering', subtitle: 'Add your script or generate with AI' },
    { number: 5, title: 'Select Avatar', subtitle: 'Choose an AI presenter' },
    { number: 6, title: 'Generate Content', subtitle: 'Review and regenerate if needed' },
    { number: 7, title: 'My Private Lecture', subtitle: 'View the result in your private library' }
  ];

  const avatarOptions = [
    { id: 'lisa' as AvatarType, label: 'Lisa', file: 'Lisa.png' },
    { id: 'harry' as AvatarType, label: 'Harry', file: 'Harry.png' },
  ].map((avatar) => {
    const { data } = supabase.storage.from('media').getPublicUrl(`Images/${avatar.file}`);
    return { ...avatar, imageUrl: data.publicUrl };
  });

  const characterStyles: Record<AvatarType, { styles: string[]; default: string }> = {
    lisa: {
      styles: ['casual-sitting', 'graceful-sitting', 'graceful-standing', 'technical-sitting', 'technical-standing'],
      default: 'graceful-sitting',
    },
    lori: { styles: ['casual', 'graceful', 'formal'], default: 'graceful' },
    meg: { styles: ['formal', 'casual', 'business'], default: 'formal' },
    jeff: { styles: ['formal', 'business'], default: 'formal' },
    max: { styles: ['business', 'casual', 'formal'], default: 'business' },
    harry: { styles: ['business', 'casual', 'youthful'], default: 'business' },
  };

  const previewVideo = privateArtifacts.find(
    (artifact) => artifact.artifactType === 'video_avatar' || artifact.artifactType === 'video_avatar_mp4',
  );
  const previewAudio = privateArtifacts.find(
    (artifact) => artifact.artifactType === 'audio' || artifact.artifactType === 'audio_mp3',
  );
  const previewPresentation = privateArtifacts.find(
    (artifact) => artifact.artifactType === 'pptx' || artifact.artifactType === 'ppt',
  );

  return (
    <StudentLayout profile={profile}>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Private to you</p>
            <p className="text-sm">This lecture and its generated files are not shared with classmates or educators.</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/student/dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors px-4 py-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Back</span>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Create Mini-Lecture</h1>
            <p className="text-gray-600 mt-1">Follow the steps below to create your AI-powered lecture content</p>
          </div>
        </div>

        <div className="bg-brand-maroon text-white rounded-2xl p-8">
          <h2 className="text-2xl font-bold mb-2">Create New Mini-Lecture</h2>
          <p className="text-white/90">Follow the steps below to create AI-powered educational content</p>
        </div>

        <div className="space-y-4">
          {steps.map((step) => {
            const isCompleted = currentStep > step.number;
            const isCurrent = currentStep === step.number;
            const isExpanded = expandedStep === step.number;

            return (
              <div key={step.number} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setExpandedStep(isExpanded ? 0 : step.number)}
                  className="w-full flex items-center gap-4 p-6 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                    isCompleted ? 'bg-green-600' : isCurrent ? 'bg-brand-maroon' : 'bg-gray-300'
                  }`}>
                    {isCompleted ? <Check className="w-6 h-6" /> : step.number}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900">{step.title}</h3>
                    <p className="text-sm text-gray-600">{step.subtitle}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-6 h-6 text-gray-400" /> : <ChevronDown className="w-6 h-6 text-gray-400" />}
                </button>

                {isExpanded && step.number === 1 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-4">Select Course(s)</h4>
                      <div className="space-y-2">
                        {courses.map(course => (
                          <label key={course.id} className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedCourseIds.includes(course.id)}
                              onChange={() => toggleCourse(course.id)}
                              className="w-5 h-5 text-brand-maroon rounded focus:ring-brand-maroon"
                            />
                            <span className="font-medium text-gray-900">{course.course_number} - {course.title}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950">
                      <Lock className="mt-0.5 h-5 w-5 shrink-0" />
                      <p className="text-sm">The selected course provides context only. Your generated lecture will remain in your private library.</p>
                    </div>

                    <button
                      onClick={handleContinueToMaterials}
                      disabled={isSavingDraft}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingDraft ? 'Saving Private Draft...' : 'Continue to Materials Selection'}
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 2 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-gray-900">Add Materials for Your Lecture</h4>
                      <button className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm">
                        <Info className="w-4 h-4" />
                        What&apos;s the difference?
                      </button>
                    </div>

                    {preloadedMaterials.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-4">Preloaded Course Materials</h4>
                        <p className="text-sm text-gray-600 mb-4">Select materials from your courses:</p>
                        <div className="space-y-2">
                          {preloadedMaterials.map((material, index) => (
                            <label key={index} className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedPreloadedMaterialUrls.includes(material.url)}
                                onChange={() => togglePreloadedMaterial(material.url)}
                                className="w-5 h-5 text-brand-maroon rounded focus:ring-brand-maroon"
                              />
                              <File className="w-5 h-5 text-gray-400" />
                              <div className="flex-1">
                                <p className="font-medium text-gray-900">{material.name}</p>
                                <p className="text-sm text-gray-600">{material.courseCode}</p>
                              </div>
                              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                {getFileExtension(material.url)}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="font-semibold text-gray-900 mb-4">Upload Additional Files</h4>
                      <input
                        ref={additionalFilesInputRef}
                        type="file"
                        multiple
                        onChange={handleAdditionalFilesSelect}
                        className="hidden"
                      />
                      <button
                        onClick={() => additionalFilesInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-gray-400 transition-colors"
                      >
                        <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-700 font-medium mb-1">Click to upload files</p>
                        <p className="text-gray-500 text-sm">PDF, DOCX, TXT, XLSX, PPTX, JPG, PNG</p>
                      </button>

                      {additionalFiles.length > 0 && (
                        <div className="mt-4 space-y-2">
                          {additionalFiles.map((file, index) => (
                            <div key={index} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
                              <div className="flex items-center gap-3">
                                <File className="w-5 h-5 text-gray-400" />
                                <div>
                                  <p className="font-medium text-gray-900">{file.name}</p>
                                  <p className="text-sm text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                              </div>
                              <button
                                onClick={() => removeAdditionalFile(index)}
                                className="text-red-600 hover:text-red-700 font-medium text-sm"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {allMaterials.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-4">All Added Materials</h4>
                        <div className="space-y-2">
                          {allMaterials.map((material, index) => (
                            <div key={index} className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg">
                              <File className="w-5 h-5 text-gray-400" />
                              <div className="flex-1">
                                <p className="font-medium text-gray-900">{material.name}</p>
                                {material.courseCode && (
                                  <p className="text-sm text-gray-600">{material.courseCode}</p>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => changeMaterialType(material.url, 'main')}
                                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                                    material.type === 'main'
                                      ? 'bg-brand-maroon text-white'
                                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  }`}
                                >
                                  Main
                                </button>
                                <button
                                  onClick={() => changeMaterialType(material.url, 'background')}
                                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                                    material.type === 'background'
                                      ? 'bg-brand-yellow text-black'
                                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  }`}
                                >
                                  Background
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleContinueToContentStyle}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors"
                    >
                      Continue to Content Style
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 3 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      <button
                        onClick={() => toggleContentStyle('video')}
                        className={`p-8 border-2 rounded-xl text-center transition-all ${
                          contentStyles.includes('video')
                            ? 'border-brand-maroon bg-red-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Video className={`w-12 h-12 mx-auto mb-4 ${contentStyles.includes('video') ? 'text-brand-maroon' : 'text-gray-400'}`} />
                        <h4 className="font-bold text-gray-900 mb-1">Video</h4>
                        <p className="text-sm text-gray-600">AI Avatar with voice</p>
                      </button>

                      <button
                        onClick={() => toggleContentStyle('audio')}
                        className={`p-8 border-2 rounded-xl text-center transition-all ${
                          contentStyles.includes('audio')
                            ? 'border-brand-maroon bg-red-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Mic className={`w-12 h-12 mx-auto mb-4 ${contentStyles.includes('audio') ? 'text-brand-maroon' : 'text-gray-400'}`} />
                        <h4 className="font-bold text-gray-900 mb-1">Audio</h4>
                        <p className="text-sm text-gray-600">Voice narration only</p>
                      </button>

                      <button
                        onClick={() => toggleContentStyle('powerpoint')}
                        className={`p-8 border-2 rounded-xl text-center transition-all ${
                          contentStyles.includes('powerpoint')
                            ? 'border-brand-maroon bg-red-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <FileText className={`w-12 h-12 mx-auto mb-4 ${contentStyles.includes('powerpoint') ? 'text-brand-maroon' : 'text-gray-400'}`} />
                        <h4 className="font-bold text-gray-900 mb-1">PowerPoint</h4>
                        <p className="text-sm text-gray-600">Slides only</p>
                      </button>
                    </div>

                    {contentStyles.length > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-900">
                          <span className="font-semibold">Selected: </span>
                          {contentStyles.map(s => s.toUpperCase()).join(', ')}
                        </p>
                      </div>
                    )}

                    <button
                      onClick={handleContinueToScriptPrompt}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors"
                    >
                      Continue to Script & Prompt
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 4 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setScriptMode('direct')}
                        className={`p-6 border-2 rounded-xl text-center transition-all ${
                          scriptMode === 'direct'
                            ? 'border-brand-maroon bg-red-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <FileText className={`w-8 h-8 mx-auto mb-3 ${scriptMode === 'direct' ? 'text-brand-maroon' : 'text-gray-400'}`} />
                        <h4 className="font-bold text-gray-900">Add Script Directly</h4>
                      </button>

                      <button
                        onClick={() => setScriptMode('ai')}
                        className={`p-6 border-2 rounded-xl text-center transition-all ${
                          scriptMode === 'ai'
                            ? 'border-brand-maroon bg-red-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Sparkles className={`w-8 h-8 mx-auto mb-3 ${scriptMode === 'ai' ? 'text-brand-maroon' : 'text-gray-400'}`} />
                        <h4 className="font-bold text-gray-900">Generate with AI Prompt</h4>
                      </button>
                    </div>

                    {scriptMode === 'direct' && (
                      <div className="space-y-4">
                        <div>
                          <h4 className="font-semibold text-gray-900 mb-3">Enter Script</h4>
                          <textarea
                            value={scriptDirect}
                            onChange={(e) => setScriptDirect(e.target.value)}
                            placeholder="Type your script here..."
                            className="w-full h-40 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                          />
                        </div>

                        <div className="text-center">
                          <p className="text-gray-600 mb-4">or</p>
                          <input
                            ref={scriptFileInputRef}
                            type="file"
                            accept=".txt,text/plain"
                            onChange={handleScriptFileSelect}
                            className="hidden"
                          />
                          <button
                            onClick={() => scriptFileInputRef.current?.click()}
                            className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors"
                          >
                            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-700 font-medium">Upload Script File</p>
                            <p className="text-gray-500 text-sm">TXT up to 5 MB</p>
                          </button>

                          {scriptFile && (
                            <div className="mt-4 bg-gray-50 p-4 rounded-lg flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <File className="w-5 h-5 text-gray-400" />
                                <span className="font-medium text-gray-900">{scriptFile.name}</span>
                              </div>
                              <button
                                onClick={() => setScriptFile(null)}
                                className="text-red-600 hover:text-red-700 text-sm font-medium"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {scriptMode === 'ai' && (
                      <div className="space-y-4">
                        <div>
                          <h4 className="font-semibold text-gray-900 mb-3">AI Prompt</h4>
                          <textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="Describe what you want the AI to create. Leave blank to use default prompt..."
                            className="w-full h-32 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                          />
                          <p className="text-sm text-gray-500 mt-2">
                            Default: &quot;Create an engaging educational video script about the topic&quot;
                          </p>
                        </div>

                        <div>
                          <label className="block font-semibold text-gray-900 mb-3">Video Length (minutes)</label>
                          <select
                            value={videoLength}
                            onChange={(e) => setVideoLength(Number(e.target.value))}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                          >
                            <option value={1}>1 minutes</option>
                            <option value={2}>2 minutes</option>
                            <option value={3}>3 minutes</option>
                            <option value={4}>4 minutes</option>
                            <option value={5}>5 minutes</option>
                          </select>
                        </div>

                        <button
                          onClick={handleGenerateScript}
                          disabled={isGenerating}
                          className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 px-8 rounded-lg transition-colors flex items-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-5 h-5" />
                          {isGenerating ? 'Generating...' : 'Generate Script with AI'}
                        </button>

                        {scriptGenerated && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-3">Generated Script (You can edit)</h4>
                            <textarea
                              value={generatedScript}
                              onChange={(e) => setGeneratedScript(e.target.value)}
                              className="w-full h-48 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-gray-50"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={handleContinueToAvatarSelection}
                      disabled={scriptMode === 'direct' ? (!scriptDirect && !scriptFile) : !scriptGenerated}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Continue to Avatar Selection
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 5 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {avatarOptions.map((avatar) => (
                        <button
                          key={avatar.id}
                          onClick={() => {
                            setSelectedAvatar(avatar.id);
                            setSelectedAvatarStyle(characterStyles[avatar.id].default);
                          }}
                          className={`p-6 border-2 rounded-xl text-center transition-all ${
                            selectedAvatar === avatar.id
                              ? 'border-brand-maroon bg-red-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <img
                            src={avatar.imageUrl}
                            alt={avatar.label}
                            className="mx-auto mb-3 h-32 w-32 rounded-xl object-cover"
                          />
                          <h4 className="font-bold text-gray-900 text-sm">{avatar.label}</h4>
                        </button>
                      ))}
                    </div>

                    {selectedAvatar && (
                      <div>
                        <label className="mb-2 block font-semibold text-gray-900">Presentation style</label>
                        <select
                          value={selectedAvatarStyle}
                          onChange={(event) => setSelectedAvatarStyle(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 p-3 focus:border-transparent focus:ring-2 focus:ring-brand-maroon"
                        >
                          {characterStyles[selectedAvatar].styles.map((style) => (
                            <option key={style} value={style}>
                              {style.replaceAll('-', ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      onClick={handleContinueToGenerateContent}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors"
                    >
                      Continue to Generate Content
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 6 && (
                  <div className="p-6 pt-0 space-y-6">
                    {!contentGenerated ? (
                      <>
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                          <Sparkles className="w-16 h-16 text-brand-maroon mx-auto mb-4" />
                          <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Generate!</h3>
                          <p className="text-gray-600 mb-6">
                            Your lecture is configured and ready. Click the button below to start generating your AI-powered content.
                          </p>
                          <button
                            onClick={handleGenerateContent}
                            disabled={isGenerating}
                            className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-4 px-12 rounded-lg transition-colors text-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
                          >
                            {isGenerating ? 'Generating...' : 'Generate Content'}
                          </button>
                        </div>

                        <div className="border border-gray-200 rounded-xl p-6">
                          <h4 className="font-bold text-gray-900 mb-4">Summary</h4>
                          <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Courses Selected:</span>
                              <span className="font-medium text-gray-900">{selectedCourseIds.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Materials Added:</span>
                              <span className="font-medium text-gray-900">{allMaterials.length + additionalFiles.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Content Styles:</span>
                              <span className="font-medium text-gray-900">{contentStyles.join(', ').toUpperCase()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Avatar:</span>
                              <span className="font-medium text-gray-900">
                                {avatarOptions.find(a => a.id === selectedAvatar)?.label || 'None'}
                              </span>
                            </div>
                            {scriptMode === 'ai' && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Video Length:</span>
                                <span className="font-medium text-gray-900">{videoLength} minutes</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-6">
                        {previewVideo && (
                          <div>
                            <h4 className="mb-4 font-semibold text-gray-900">Avatar Video Preview</h4>
                            <video
                              key={previewVideo.url}
                              controls
                              className="aspect-video w-full rounded-xl bg-black"
                              src={previewVideo.url}
                            >
                              Your browser does not support the video tag.
                            </video>
                          </div>
                        )}

                        {previewAudio && (
                          <div>
                            <h4 className="mb-4 font-semibold text-gray-900">Audio Preview</h4>
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
                              <audio key={previewAudio.url} controls className="w-full" src={previewAudio.url} />
                            </div>
                          </div>
                        )}

                        {previewPresentation && (
                          <div>
                            <h4 className="mb-4 font-semibold text-gray-900">PowerPoint</h4>
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
                              <FileText className="mx-auto mb-3 h-12 w-12 text-brand-maroon" />
                              <a
                                href={previewPresentation.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-brand-maroon hover:underline"
                              >
                                Open generated presentation
                              </a>
                            </div>
                          </div>
                        )}

                        {privateArtifacts.length === 0 && (
                          <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 text-center text-blue-900">
                            The lecture was generated successfully. Open the private lecture to refresh its secure preview links.
                          </div>
                        )}

                        <button
                          onClick={handleGoToPublish}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-maroon px-8 py-4 font-bold text-white transition-colors hover:bg-brand-maroon-hover"
                        >
                          <CheckCircle className="h-5 w-5" />
                          Continue to My Private Lecture
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isExpanded && step.number === 7 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-5 text-green-950">
                      <Lock className="mt-0.5 h-6 w-6 shrink-0" />
                      <div>
                        <h4 className="font-semibold">Saved to My Private Avatar Lectures</h4>
                        <p className="mt-1 text-sm">Only your account can open the generated files. This lecture is not published to the course.</p>
                      </div>
                    </div>

                    <div className="flex">
                      <button
                        onClick={handlePublishContent}
                        className="flex-1 bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-4 px-8 rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <CheckCircle className="h-5 w-5" />
                        View My Private Lecture
                      </button>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm text-blue-900 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Access is provided with short-lived secure links after your identity is verified.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </StudentLayout>
  );
}
