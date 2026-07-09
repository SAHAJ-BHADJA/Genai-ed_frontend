'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, Profile, Course } from '@/lib/supabase';
import EducatorLayout from '@/components/EducatorLayout';
import { ArrowLeft, Upload, Check, ChevronDown, ChevronUp, Info, Video, Mic, FileText, Sparkles, Download, Eye, CheckCircle, File } from 'lucide-react';
import { toast } from 'sonner';
import { getBackendBase } from '@/lib/backend';
import { validateFileSize } from '@/lib/fileUpload';
import { AvatarName, AvatarVoiceMap } from "@/lib/avatarVoiceMap";
import { savePendingSocraticCreatedResource } from '@/lib/socraticWriting';

type MaterialWithType = {
  url: string;
  name: string;
  displayName: string;
  type: 'main' | 'background';
  sourceCourseId?: string;
  courseTitle?: string;
  courseCode?: string;
  materialId?: string;
  storagePath?: string;
  sourceType?: 'course_preloaded' | 'uploaded';
};


type AvatarCharacter = AvatarName;


type AvatarStyles = {
  lisa: 'casual-sitting' | 'graceful-sitting' | 'graceful-standing' | 'technical-sitting' | 'technical-standing';
  lori: 'casual' | 'graceful' | 'formal';
  meg: 'formal' | 'casual' | 'business';
  jeff: 'formal' | 'business';
  max: 'business' | 'casual' | 'formal';
  harry: 'business' | 'casual' | 'youthful';
};

const BACKEND_URL = getBackendBase().replace(/\/$/, '');

const STYLE_TO_JOB: Record<string, string> = {
  audio: 'audio',
  powerpoint: 'pptx',
  video: 'video_avatar'
};

const JOB_TO_ARTIFACT: Record<string, string> = {
  audio: 'audio',
  pptx: 'pptx',
  video_avatar: 'video_avatar'
};

export default function CreateLecture() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedCourseId = searchParams.get('courseId');
  const socraticAttach = searchParams.get('socraticAttach');
  const returnTo = searchParams.get('returnTo');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [expandedStep, setExpandedStep] = useState(1);

  const [lectureId, setLectureId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [addToPersonalLibrary, setAddToPersonalLibrary] = useState(false);
  const [addToUSCLibrary, setAddToUSCLibrary] = useState(false);
  const [lectureTitle, setLectureTitle] = useState('');

  const [preloadedMaterials, setPreloadedMaterials] = useState<Array<{ url: string; name: string; courseTitle: string; courseCode: string; sourceCourseId: string; defaultType: 'main' | 'background' }>>([]);
  const [selectedPreloadedMaterialUrls, setSelectedPreloadedMaterialUrls] = useState<string[]>([]);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
  const [allMaterials, setAllMaterials] = useState<MaterialWithType[]>([]);

  const [contentStyles, setContentStyles] = useState<string[]>([]);

  const [scriptMode, setScriptMode] = useState<'direct' | 'ai'>('ai');
  const [scriptDirect, setScriptDirect] = useState('');
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [videoLength, setVideoLength] = useState(1);
  const [generatedScript, setGeneratedScript] = useState('');
  const [scriptGenerated, setScriptGenerated] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);

  const [selectedCharacter, setSelectedCharacter] = useState<AvatarCharacter | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string>('');

  const [contentGenerated, setContentGenerated] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobsByType, setJobsByType] = useState<Record<string, { status: string; progress: number; error?: string }>>({});
  const [artifactsByType, setArtifactsByType] = useState<Record<string, string>>({});
  const [generationBlocked, setGenerationBlocked] = useState(false);
  const [generationBlockReason, setGenerationBlockReason] = useState('');
  const [existingJobs, setExistingJobs] = useState<any[]>([]);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');

  const additionalFilesInputRef = useRef<HTMLInputElement>(null);
  const scriptFileInputRef = useRef<HTMLInputElement>(null);
  const scriptSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const jobIdsRef = useRef<string[]>([]);
  const finishedAtRef = useRef<number | null>(null);
  const materialNameDebounceRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const isMountedRef = useRef(true);
  const isStartingGenerationRef = useRef(false);
  const voice = selectedCharacter ? AvatarVoiceMap[selectedCharacter].voiceId : null;

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const idFromUrl = searchParams.get('id');
    const modeFromUrl = searchParams.get('mode');
    if (idFromUrl) {
      setLectureId(idFromUrl);
      setIsEditMode(modeFromUrl === 'edit');
    }
  }, [searchParams]);

  useEffect(() => {
    if (preselectedCourseId && selectedCourseIds.length === 0) {
      setSelectedCourseIds([preselectedCourseId]);
    }
  }, [preselectedCourseId, selectedCourseIds.length]);

  useEffect(() => {
    if (lectureId) {
      loadExistingMaterials(lectureId);
      loadLectureData(lectureId);
    }
  }, [lectureId]);

  useEffect(() => {
    if (selectedCourseIds.length > 0) {
      loadCourseMaterials();
    } else {
      setPreloadedMaterials([]);
      setSelectedPreloadedMaterialUrls([]);
    }
  }, [selectedCourseIds]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (scriptSaveTimeoutRef.current) {
        clearTimeout(scriptSaveTimeoutRef.current);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      materialNameDebounceRefs.current.forEach(timeout => clearTimeout(timeout));
      materialNameDebounceRefs.current.clear();
    };
  }, []);

  const checkAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/educator/login');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || profileData.role !== 'educator') {
        await supabase.auth.signOut();
        router.push('/educator/login');
        return;
      }

      setProfile(profileData);

      const { data: coursesData } = await supabase
        .from('courses')
        .select('*')
        .eq('educator_id', user.id)
        .order('created_at', { ascending: false });

      if (coursesData) {
        setCourses(coursesData);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCourseMaterials = () => {
    const materials: Array<{ url: string; name: string; courseTitle: string; courseCode: string; sourceCourseId: string; defaultType: 'main' | 'background' }> = [];

    selectedCourseIds.forEach(courseId => {
      const course = courses.find(c => c.id === courseId);
      if (course) {
        const courseMaterials = course.course_materials_data ||
          (course.course_materials_urls?.map(url => ({
            url,
            displayName: extractFileName(url),
            fileName: extractFileName(url)
          })) || []);

        courseMaterials.forEach((material) => {
          materials.push({
            url: material.url,
            name: material.displayName,
            courseTitle: course.title,
            courseCode: course.course_number,
            sourceCourseId: course.id,
            defaultType: 'main'
          });
        });

        const backgroundMaterials = course.background_materials_data ||
          (course.background_materials_urls?.map(url => ({
            url,
            displayName: extractFileName(url),
            fileName: extractFileName(url)
          })) || []);

        backgroundMaterials.forEach((material) => {
          materials.push({
            url: material.url,
            name: material.displayName,
            courseTitle: course.title,
            courseCode: course.course_number,
            sourceCourseId: course.id,
            defaultType: 'background'
          });
        });
      }
    });

    setPreloadedMaterials(materials);
  };

  const loadExistingMaterials = async (lectureIdToLoad: string) => {
    try {
      const { data: materialsData, error } = await supabase
        .from('lecture_materials')
        .select('*')
        .eq('lecture_id', lectureIdToLoad);

      if (error) throw error;

      if (materialsData) {
        const loadedMaterials: MaterialWithType[] = [];
        const preloadedUrls: string[] = [];

        materialsData.forEach(material => {
          const fileName = extractFileName(material.material_url);
          const displayName = material.material_name || extractFileNameWithoutExtension(material.material_url);
          const newMaterial: MaterialWithType = {
            url: material.material_url,
            name: fileName,
            displayName: displayName,
            type: material.material_type as 'main' | 'background',
            sourceCourseId: material.source_course_id,
            materialId: material.id,
            storagePath: material.storage_path,
            sourceType: material.source_type as 'course_preloaded' | 'uploaded'
          };

          loadedMaterials.push(newMaterial);

          if (material.source_type === 'course_preloaded') {
            preloadedUrls.push(material.material_url);
          }
        });

        setAllMaterials(loadedMaterials);
        setSelectedPreloadedMaterialUrls(preloadedUrls);
      }
    } catch (error) {
      console.error('Error loading materials:', error);
    }
  };

  const loadLectureData = async (lectureIdToLoad: string) => {
    try {
      const { data: lectureData, error } = await supabase
        .from('lectures')
        .select('title, selected_course_ids, library_personal, library_usc, content_style, avatar_character, avatar_style, avatar_voice_id, status, script_mode, script_text, script_prompt, video_length')
        .eq('id', lectureIdToLoad)
        .maybeSingle();

      if (error) throw error;

      if (lectureData) {
        if (lectureData.selected_course_ids && lectureData.selected_course_ids.length > 0) {
          setSelectedCourseIds(lectureData.selected_course_ids);
        }

        setAddToPersonalLibrary(lectureData.library_personal || false);
        setAddToUSCLibrary(lectureData.library_usc || false);

        if ((lectureData as any).title) {
          setLectureTitle((lectureData as any).title);
        }

        if (lectureData.content_style && lectureData.content_style.length > 0) {
          setContentStyles(lectureData.content_style);
        }

        if (lectureData.script_mode) {
          setScriptMode(lectureData.script_mode as 'direct' | 'ai');
        }

        if (lectureData.script_text) {
          setGeneratedScript(lectureData.script_text);
          setScriptGenerated(true);

          if (lectureData.script_mode === 'direct') {
            const videoScriptMatch = lectureData.script_text.match(/VIDEO SCRIPT:\n([\s\S]*?)(?:\n\nAUDIO SCRIPT:|$)/);
            if (videoScriptMatch && videoScriptMatch[1]) {
              setScriptDirect(videoScriptMatch[1].trim());
            }
          }
        }

        if (lectureData.script_prompt) {
          setAiPrompt(lectureData.script_prompt);
        }

        if (lectureData.video_length) {
          setVideoLength(lectureData.video_length);
        }

        if (lectureData.avatar_character) {
          setSelectedCharacter(lectureData.avatar_character as AvatarCharacter);
        }

        if (lectureData.avatar_style) {
          setSelectedStyle(lectureData.avatar_style);
        }

        if (lectureData.status === 'generated' || lectureData.status === 'published') {
          setContentGenerated(true);

          const { data: artifacts, error: artifactsError } = await supabase
            .from('lecture_artifacts')
            .select('*')
            .eq('lecture_id', lectureIdToLoad);

          if (!artifactsError && artifacts && artifacts.length > 0) {
            const artifactMap: Record<string, string> = {};
            artifacts.forEach(artifact => {
              artifactMap[artifact.artifact_type] = artifact.file_url;
            });
            setArtifactsByType(artifactMap);
          }
        }
      }
    } catch (error) {
      console.error('Error loading lecture data:', error);
    }
  };

  const cloneLecture = async () => {
    if (!lectureId || !profile) {
      toast.error('Cannot clone lecture - missing data');
      return;
    }

    try {
      const { data: originalLecture, error: fetchError } = await supabase
        .from('lectures')
        .select('*')
        .eq('id', lectureId)
        .maybeSingle();

      if (fetchError || !originalLecture) {
        throw new Error('Failed to fetch original lecture');
      }

      const newTitle = `${originalLecture.title} (Copy)`;

      const { data: newLecture, error: createError } = await supabase
        .from('lectures')
        .insert({
          educator_id: profile.id,
          creator_role: 'educator',
          creator_user_id: profile.id,
          title: newTitle,
          description: originalLecture.description,
          selected_course_ids: originalLecture.selected_course_ids,
          library_personal: originalLecture.library_personal,
          library_usc: originalLecture.library_usc,
          content_style: originalLecture.content_style,
          avatar_character: originalLecture.avatar_character,
          avatar_style: originalLecture.avatar_style,
          avatar_voice_id: originalLecture.avatar_voice_id,
          script_mode: originalLecture.script_mode,
          script_text: originalLecture.script_text,
          script_prompt: originalLecture.script_prompt,
          video_length: originalLecture.video_length,
          status: 'draft'
        })
        .select()
        .single();

      if (createError || !newLecture) {
        throw new Error('Failed to create new lecture');
      }

      const { data: materials, error: materialsError } = await supabase
        .from('lecture_materials')
        .select('*')
        .eq('lecture_id', lectureId);

      if (!materialsError && materials && materials.length > 0) {
        const newMaterials = materials.map(m => ({
          lecture_id: newLecture.id,
          material_url: m.material_url,
          material_name: m.material_name,
          material_type: m.material_type,
          source_type: m.source_type,
          source_course_id: m.source_course_id,
          file_name: m.file_name,
          file_size_bytes: m.file_size_bytes,
          mime_type: m.mime_type
        }));

        await supabase.from('lecture_materials').insert(newMaterials);
      }

      const { data: lectureCourses, error: coursesError } = await supabase
        .from('lecture_courses')
        .select('*')
        .eq('lecture_id', lectureId);

      if (!coursesError && lectureCourses && lectureCourses.length > 0) {
        const newLectureCourses = lectureCourses.map(lc => ({
          lecture_id: newLecture.id,
          course_id: lc.course_id
        }));

        await supabase.from('lecture_courses').insert(newLectureCourses);
      }

      setLectureId(newLecture.id);
      setLectureTitle(newTitle);
      setIsEditMode(true);
      setContentGenerated(false);
      setJobsByType({});
      setArtifactsByType({});
      jobIdsRef.current = [];
      finishedAtRef.current = null;

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      router.push(`/educator/lecture/new?id=${newLecture.id}&mode=edit`);
      toast.success('Lecture cloned successfully! You can now regenerate content.');
    } catch (error: any) {
      console.error('Error cloning lecture:', error);
      console.error('Clone error details:', error?.message);
      toast.error(error?.message || 'Failed to clone lecture');
    }
  };

  const saveScriptToDatabase = async (scriptText: string) => {
    if (!lectureId) return;

    try {
      const { error } = await supabase
        .from('lectures')
        .update({ script_text: scriptText })
        .eq('id', lectureId);

      if (error) throw error;
    } catch (error) {
      console.error('Error saving script:', error);
    }
  };

  const debouncedSaveScript = (scriptText: string) => {
    if (scriptSaveTimeoutRef.current) {
      clearTimeout(scriptSaveTimeoutRef.current);
    }

    scriptSaveTimeoutRef.current = setTimeout(() => {
      saveScriptToDatabase(scriptText);
    }, 1000);
  };

  const toggleCourse = (courseId: string) => {
    setSelectedCourseIds(prev =>
      prev.includes(courseId)
        ? prev.filter(id => id !== courseId)
        : [...prev, courseId]
    );
  };

  const togglePreloadedMaterial = async (url: string) => {
    const isCurrentlySelected = selectedPreloadedMaterialUrls.includes(url);
    const material = preloadedMaterials.find(m => m.url === url);

    if (!material) return;

    if (isCurrentlySelected) {
      setSelectedPreloadedMaterialUrls(prev => prev.filter(u => u !== url));
      setAllMaterials(prev => prev.filter(m => m.url !== url));

      if (lectureId) {
        try {
          const { error } = await supabase
            .from('lecture_materials')
            .delete()
            .eq('lecture_id', lectureId)
            .eq('material_url', url);

          if (error) throw error;
        } catch (error) {
          console.error('Error removing material:', error);
          toast.error('Failed to remove material');
        }
      }
    } else {
      setSelectedPreloadedMaterialUrls(prev => [...prev, url]);

      const displayName = extractFileNameWithoutExtension(material.url);
      let materialId: string | undefined;

      if (lectureId) {
        try {
          const { data: insertedMaterial, error } = await supabase
            .from('lecture_materials')
            .insert({
              lecture_id: lectureId,
              material_url: material.url,
              material_name: extractFileNameWithoutExtension(material.url),
              material_type: material.defaultType,
              source_course_id: material.sourceCourseId,
              source_type: 'course_preloaded'
            })
            .select('id')
            .single();

          if (error) throw error;
          materialId = insertedMaterial?.id;
        } catch (error) {
          console.error('Error adding material:', error);
          toast.error('Failed to add material');
        }
      }

      const newMaterial: MaterialWithType = {
        url: material.url,
        name: material.name,
        displayName: displayName,
        type: material.defaultType,
        sourceCourseId: material.sourceCourseId,
        courseTitle: material.courseTitle,
        courseCode: material.courseCode,
        materialId: materialId,
        sourceType: 'course_preloaded'
      };

      setAllMaterials(prev => {
        const exists = prev.find(m => m.url === url);
        if (exists) return prev;
        return [...prev, newMaterial];
      });
    }
  };

  const handleAdditionalFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!lectureId) {
      toast.error('Save draft first');
      return;
    }

    if (selectedCourseIds.length === 0) {
      toast.error('Select at least one course in Step 1 to upload files');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Not authenticated');
      return;
    }

    const courseIdForPath = selectedCourseIds[0];
    const validFiles: File[] = [];

    for (const file of Array.from(files)) {
      if (!validateFileSize(file, 10)) {
        toast.error(`${file.name} exceeds 10MB limit`);
        continue;
      }

      try {
        const timestamp = Date.now();
        const filePath = `${courseIdForPath}/materials/${timestamp}-${file.name}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('course-files')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('course-files')
          .getPublicUrl(filePath);

        const { data: insertedMaterial, error: insertError } = await supabase
          .from('lecture_materials')
          .insert({
            lecture_id: lectureId,
            material_url: publicUrl,
            material_name: extractFileNameWithoutExtension(publicUrl),
            material_type: 'main',
            source_type: 'uploaded',
            source_course_id: courseIdForPath,
            file_mime: file.type,
            file_size_bytes: file.size,
            storage_path: filePath
          })
          .select('id')
          .single();

        if (insertError) throw insertError;

        validFiles.push(file);

        const displayName = extractFileNameWithoutExtension(publicUrl);
        const newMaterial: MaterialWithType = {
          url: publicUrl,
          name: file.name,
          displayName: displayName,
          type: 'main',
          materialId: insertedMaterial?.id,
          storagePath: filePath,
          sourceType: 'uploaded'
        };

        setAllMaterials(prev => {
          const exists = prev.find(m => m.url === publicUrl);
          if (exists) return prev;
          return [...prev, newMaterial];
        });

        toast.success(`${file.name} uploaded`);
      } catch (error) {
        console.error('Error uploading file:', error);
        const errorMessage = error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Unknown error';
        toast.error(`${file.name}: ${errorMessage}`);
      }
    }

    setAdditionalFiles(prev => [...prev, ...validFiles]);
  };

  const removeAdditionalFile = async (index: number) => {
    const fileToRemove = additionalFiles[index];
    if (!fileToRemove) return;

    const materialToRemove = allMaterials.find(m => {
      if (m.materialId) {
        return m.storagePath && m.storagePath.includes(fileToRemove.name);
      }
      return m.url.includes(fileToRemove.name);
    });

    if (!materialToRemove) return;

    setAllMaterials(prev => prev.filter(m => m !== materialToRemove));
    setAdditionalFiles(prev => prev.filter((_, i) => i !== index));

    if (lectureId) {
      try {
        if (materialToRemove.storagePath && materialToRemove.sourceType === 'uploaded') {
          const { error: storageError } = await supabase.storage
            .from('course-files')
            .remove([materialToRemove.storagePath]);

          if (storageError) {
            console.error('Error removing from storage:', storageError);
          }
        }

        if (materialToRemove.materialId) {
          const { error: dbError } = await supabase
            .from('lecture_materials')
            .delete()
            .eq('id', materialToRemove.materialId);

          if (dbError) throw dbError;
        } else {
          const { error: dbError } = await supabase
            .from('lecture_materials')
            .delete()
            .eq('lecture_id', lectureId)
            .eq('material_url', materialToRemove.url);

          if (dbError) throw dbError;
        }

        toast.success('File removed');
      } catch (error) {
        console.error('Error removing file:', error);
        toast.error('Failed to remove file');
      }
    }
  };

  const handleScriptFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFileSize(file, 5)) {
      toast.error('Script file exceeds 5MB limit');
      return;
    }

    setScriptFile(file);

    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      let extractedText = '';

      if (fileExtension === 'txt') {
        extractedText = await file.text();
      } else if (fileExtension === 'pdf') {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

        const textParts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          textParts.push(pageText);
        }
        extractedText = textParts.join('\n\n');
      } else if (fileExtension === 'docx') {
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else {
        toast.error('Unsupported script file type. Please use TXT, PDF, or DOCX.');
        setScriptFile(null);
        return;
      }

      setScriptDirect(extractedText);
      toast.success(`Script extracted from ${file.name}`);
    } catch (error) {
      console.error('Error parsing script file:', error);
      toast.error('Failed to parse script file');
      setScriptFile(null);
    }
  };

  const handleContinueToMaterials = async () => {
    if (selectedCourseIds.length === 0 && !addToPersonalLibrary && !addToUSCLibrary) {
      toast.error('Please select at least one course or library');
      return;
    }

    if (!lectureTitle.trim()) {
      toast.error('Please enter a lecture title');
      return;
    }

    if (lectureTitle.length > 120) {
      toast.error('Lecture title must be 120 characters or less');
      return;
    }

    if (!profile) return;

    try {
      let currentLectureId = lectureId;

      if (!currentLectureId) {
        const { data: newLecture, error: lectureError } = await supabase
          .from('lectures')
          .insert({
            educator_id: profile.id,
            creator_role: 'educator',
            creator_user_id: profile.id,
            title: lectureTitle,
            description: '',
            selected_course_ids: selectedCourseIds,
            library_personal: addToPersonalLibrary,
            library_usc: addToUSCLibrary,
            status: 'draft'
          })
          .select()
          .single();

        if (lectureError) throw lectureError;
        if (!newLecture) throw new Error('Failed to create lecture');

        currentLectureId = newLecture.id;
        setLectureId(currentLectureId);

        router.push(`/educator/lecture/new?id=${currentLectureId}`);
      } else {
        const { error: updateError } = await supabase
          .from('lectures')
          .update({
            title: lectureTitle,
            selected_course_ids: selectedCourseIds,
            library_personal: addToPersonalLibrary,
            library_usc: addToUSCLibrary
          })
          .eq('id', currentLectureId);

        if (updateError) throw updateError;
      }

      const { error: deleteCoursesError } = await supabase
        .from('lecture_courses')
        .delete()
        .eq('lecture_id', currentLectureId);

      if (deleteCoursesError) throw deleteCoursesError;

      if (selectedCourseIds.length > 0) {
        const lectureCourses = selectedCourseIds.map(courseId => ({
          lecture_id: currentLectureId,
          course_id: courseId
        }));

        const { error: insertCoursesError } = await supabase
          .from('lecture_courses')
          .insert(lectureCourses);

        if (insertCoursesError) throw insertCoursesError;
      }

      toast.success('Draft saved');
      setCurrentStep(2);
      setExpandedStep(2);

      if (currentLectureId) {
        await loadExistingMaterials(currentLectureId);
      }
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error('Failed to save draft');
    }
  };

  const handleContinueToContentStyle = async () => {
    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    toast.success('Materials saved');
    setCurrentStep(3);
    setExpandedStep(3);
  };

  const changeMaterialType = async (url: string, type: 'main' | 'background') => {
    setAllMaterials(prev =>
      prev.map(m => (m.url === url ? { ...m, type } : m))
    );

    if (lectureId) {
      try {
        const { error } = await supabase
          .from('lecture_materials')
          .update({
            material_type: type
          })
          .eq('lecture_id', lectureId)
          .eq('material_url', url);

        if (error) throw error;
      } catch (error) {
        console.error('Error updating material type:', error);
        toast.error('Failed to update material type');
      }
    }
  };

  const updateMaterialDisplayName = (url: string, newDisplayName: string) => {
    setAllMaterials(prev =>
      prev.map(m => (m.url === url ? { ...m, displayName: newDisplayName } : m))
    );

    if (!lectureId) return;

    const material = allMaterials.find(m => m.url === url);
    const debounceKey = material?.materialId || url;

    const existingTimeout = materialNameDebounceRefs.current.get(debounceKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
      try {
        if (material?.materialId) {
          const { error } = await supabase
            .from('lecture_materials')
            .update({ material_name: newDisplayName })
            .eq('id', material.materialId);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('lecture_materials')
            .update({ material_name: newDisplayName })
            .eq('lecture_id', lectureId)
            .eq('material_url', url);

          if (error) throw error;
        }
      } catch (error) {
        console.error('Error updating material name:', error);
        toast.error('Failed to update material name');
      } finally {
        materialNameDebounceRefs.current.delete(debounceKey);
      }
    }, 800);

    materialNameDebounceRefs.current.set(debounceKey, timeout);
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

    try {
      const { error: updateError } = await supabase
        .from('lectures')
        .update({
          content_style: contentStyles
        })
        .eq('id', lectureId);

      if (updateError) throw updateError;

      toast.success('Content style saved');
      setCurrentStep(4);
      setExpandedStep(4);
    } catch (error) {
      console.error('Error saving content style:', error);
      toast.error('Failed to save content style');
    }
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

    setIsGeneratingScript(true);
    try {
      const { error: updateError } = await supabase
        .from('lectures')
        .update({
          script_mode: 'ai',
          script_prompt: aiPrompt,
          video_length: videoLength
        })
        .eq('id', lectureId);

      if (updateError) throw updateError;

      const { data: { session } } = await supabase.auth.getSession();

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

      setScriptMode('ai');
      setGeneratedScript(realScript);
      setScriptGenerated(true);
      toast.success('Script generated successfully!');
    } catch (error) {
      console.error('Error generating script:', error);
      toast.error('Failed to generate script');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleContinueToAvatarSelection = async () => {
    if (scriptMode === 'direct' && !scriptDirect) {
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

    try {
      let scriptTextFormatted = generatedScript;

      if (scriptMode === 'direct') {
        const directScriptContent = scriptDirect || '';

        const { data: materials } = await supabase
          .from('lecture_materials')
          .select('material_name, material_type')
          .eq('lecture_id', lectureId);

        const mainMaterials = materials?.filter(m => m.material_type === 'main').map(m => m.material_name) || [];
        const backgroundMaterials = materials?.filter(m => m.material_type === 'background').map(m => m.material_name) || [];

        const materialsSummary = `Main Materials: ${mainMaterials.length > 0 ? mainMaterials.join(', ') : 'None'}

Background Materials: ${backgroundMaterials.length > 0 ? backgroundMaterials.join(', ') : 'None'}`;

        scriptTextFormatted = `TITLE:
${lectureTitle.trim() || 'Untitled Lecture'}

${materialsSummary}

VIDEO SCRIPT:
${directScriptContent}

AUDIO SCRIPT:
${directScriptContent}

PPT SCRIPT:
SLIDE 1: Untitled Lecture
- Key point 1
- Key point 2
- Key point 3`;

        const { error: updateError } = await supabase
          .from('lectures')
          .update({
            script_mode: 'direct',
            script_text: scriptTextFormatted,
            video_length: videoLength
          })
          .eq('id', lectureId);

        if (updateError) throw updateError;
      }

      toast.success('Script saved');
      setCurrentStep(5);
      setExpandedStep(5);
    } catch (error) {
      console.error('Error saving script:', error);
      toast.error('Failed to save script');
    }
  };

  const handleContinueToGenerateContent = async () => {
    if (!selectedCharacter) {
      toast.error('Please select a character');
      return;
    }

    if (!selectedStyle) {
      toast.error('Please select a style');
      return;
    }

    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    try {
      const { error: updateError } = await supabase
        .from('lectures')
        .update({
          avatar_character: selectedCharacter,
          avatar_style: selectedStyle,
          avatar_voice_id: voice,
        })
        .eq('id', lectureId);

      if (updateError) throw updateError;

      toast.success('Avatar saved');
      setCurrentStep(6);
      setExpandedStep(6);
    } catch (error) {
      console.error('Error saving avatar:', error);
      toast.error('Failed to save avatar');
    }
  };

  const pollJobsAndArtifacts = async (lectureIdToPoll: string, jobIds: string[]) => {
    try {
      // Decide what jobs to look for
      const requiredJobs: string[] = contentStyles
        .map(style => STYLE_TO_JOB[style])
        .filter(Boolean);
  
      // Build base query: always tie to lecture_id
      const jobsBaseQuery = supabase
        .from('lecture_jobs')
        .select('*')
        .eq('lecture_id', lectureIdToPoll);
  
      // If we have jobIds, use them (exact). Otherwise fallback to lecture_id + job_types.
      const { data: jobs, error: jobsError } =
        jobIds && jobIds.length > 0
          ? await jobsBaseQuery.in('id', jobIds)
          : requiredJobs.length > 0
            ? await jobsBaseQuery.in('job_type', requiredJobs)
            : await jobsBaseQuery; // extreme fallback
  
      if (jobsError) throw jobsError;
  
      const { data: artifacts, error: artifactsError } = await supabase
        .from('lecture_artifacts')
        .select('*')
        .eq('lecture_id', lectureIdToPoll);
  
      if (artifactsError) throw artifactsError;
  
      if (!isMountedRef.current) return;
  
      const jobsMap: Record<string, { status: string; progress: number; error?: string }> = {};
      jobs?.forEach(job => {
        jobsMap[job.job_type] = {
          status: job.status,
          progress: job.progress || 0,
          error: job.error_message || (job.result as any)?.error
        };
      });
  
      const artifactsMap: Record<string, string> = {};
      artifacts?.forEach(artifact => {
        if (artifact.file_url) {
          artifactsMap[artifact.artifact_type] = artifact.file_url;
        }
      });
  
      if (!isMountedRef.current) return;
  
      setJobsByType(jobsMap);
      setArtifactsByType(artifactsMap);
  
      // ✅ Determine completion using requiredJobs (same as before)
      const allJobsFinished =
        requiredJobs.length > 0 &&
        requiredJobs.every(jobType => {
          const job = jobsMap[jobType];
          return job && (job.status === 'succeeded' || job.status === 'failed');
        });
  
      if (allJobsFinished) {
        const anySucceeded = requiredJobs.some(jobType => jobsMap[jobType]?.status === 'succeeded');
  
        // Grace window: give artifacts time to show up after job success
        if (anySucceeded && Object.keys(artifactsMap).length === 0) {
          if (!finishedAtRef.current) finishedAtRef.current = Date.now();
          if (Date.now() - finishedAtRef.current < 10_000) {
            return;
          }
        }
  
        finishedAtRef.current = null;
  
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
  
        setIsGenerating(false);
  
        if (anySucceeded && Object.keys(artifactsMap).length > 0) {
          setContentGenerated(true);
          await supabase.from('lectures').update({ status: 'generated' }).eq('id', lectureIdToPoll);
          toast.success('Content generated successfully!');
        } else {
          toast.error('Content generation failed. Please check errors and try again.');
        }
      }
    } catch (error) {
      console.error('Error polling jobs and artifacts:', error);
    }
  };
  const checkExistingGeneration = async (): Promise<{ blocked: boolean; reason: string; jobs: any[] }> => {
    if (!lectureId) return { blocked: false, reason: '', jobs: [] };

    try {
      const requiredJobs = contentStyles
        .map(style => STYLE_TO_JOB[style])
        .filter(Boolean);

      if (requiredJobs.length === 0) {
        return { blocked: false, reason: '', jobs: [] };
      }

      const { data: existingJobsData, error: jobsError } = await supabase
        .from('lecture_jobs')
        .select('*')
        .eq('lecture_id', lectureId)
        .in('job_type', requiredJobs);

      if (jobsError) throw jobsError;

      if (existingJobsData && existingJobsData.length > 0) {
        const jobTypes = existingJobsData.map(j => j.job_type).join(', ');
        return {
          blocked: true,
          reason: `Generation already exists for this lecture (${jobTypes}). Regenerating on the same lecture causes a duplicate-job error.`,
          jobs: existingJobsData
        };
      }

      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: recentRuns, error: runsError } = await supabase
        .from('lecture_generation_client_runs')
        .select('*')
        .eq('lecture_id', lectureId)
        .eq('status', 'started')
        .gte('created_at', twoMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (runsError) throw runsError;

      if (recentRuns && recentRuns.length > 0) {
        return {
          blocked: true,
          reason: 'Generation already in progress. Please wait for it to complete.',
          jobs: []
        };
      }

      return { blocked: false, reason: '', jobs: [] };
    } catch (error) {
      console.error('Error checking existing generation:', error);
      return { blocked: false, reason: '', jobs: [] };
    }
  };

  const handleCloneAndRegenerate = async () => {
    if (!lectureId) return;

    try {
      const { data: lectureData, error: fetchError } = await supabase
        .from('lectures')
        .select('*')
        .eq('id', lectureId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!lectureData) {
        toast.error('Lecture not found');
        return;
      }

      const { data: newLecture, error: insertError } = await supabase
        .from('lectures')
        .insert({
          educator_id: lectureData.educator_id,
          creator_role: 'educator',
          creator_user_id: lectureData.educator_id,
          title: `${lectureData.title} (Copy)`,
          selected_course_ids: lectureData.selected_course_ids,
          library_personal: lectureData.library_personal,
          library_usc: lectureData.library_usc,
          content_style: lectureData.content_style,
          script_mode: lectureData.script_mode,
          script_text: lectureData.script_text,
          script_prompt: lectureData.script_prompt,
          video_length: lectureData.video_length,
          avatar_character: lectureData.avatar_character,
          avatar_style: lectureData.avatar_style,
          avatar_voice_id: lectureData.avatar_voice_id,
          status: 'draft'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const { data: materialsData } = await supabase
        .from('lecture_materials')
        .select('*')
        .eq('lecture_id', lectureId);

      if (materialsData && materialsData.length > 0) {
        const materialsCopy = materialsData.map(m => ({
          lecture_id: newLecture.id,
          material_url: m.material_url,
          material_name: m.material_name,
          material_type: m.material_type,
          source_type: m.source_type,
          source_course_id: m.source_course_id,
          file_mime: m.file_mime,
          file_size_bytes: m.file_size_bytes,
          storage_path: m.storage_path
        }));

        await supabase.from('lecture_materials').insert(materialsCopy);
      }

      toast.success('Lecture cloned! Redirecting...');
      router.push(`/educator/lecture/new?id=${newLecture.id}`);
    } catch (error) {
      console.error('Error cloning lecture:', error);
      toast.error('Failed to clone lecture');
    }
  };

  const handleResetGeneration = async () => {
    if (!lectureId || resetConfirmText !== 'RESET') {
      toast.error('Please type RESET to confirm');
      return;
    }

    try {
      const requiredJobs = contentStyles
        .map(style => STYLE_TO_JOB[style])
        .filter(Boolean);

      const requiredArtifacts = contentStyles
        .map(style => JOB_TO_ARTIFACT[STYLE_TO_JOB[style]])
        .filter(Boolean);

      await supabase
        .from('lecture_jobs')
        .delete()
        .eq('lecture_id', lectureId)
        .in('job_type', requiredJobs);

      await supabase
        .from('lecture_artifacts')
        .delete()
        .eq('lecture_id', lectureId)
        .in('artifact_type', requiredArtifacts);

      await supabase
        .from('lectures')
        .update({ status: 'draft', last_generate_block_reason: null })
        .eq('id', lectureId);

      setGenerationBlocked(false);
      setGenerationBlockReason('');
      setExistingJobs([]);
      setJobsByType({});
      setArtifactsByType({});
      setContentGenerated(false);
      setShowResetModal(false);
      setResetConfirmText('');

      toast.success('Generation state reset. You can now generate content again.');
    } catch (error) {
      console.error('Error resetting generation:', error);
      toast.error('Failed to reset generation state');
    }
  };

  const handleGenerateContent = async () => {
    console.log('handleGenerateContent clicked', { lectureId, isGenerating, gate: isStartingGenerationRef.current });
    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }
  
    if (isStartingGenerationRef.current) return;
    isStartingGenerationRef.current = true;
  
    try {
      const checkResult = await checkExistingGeneration();
  
      if (checkResult.blocked) {
        setGenerationBlocked(true);
        setGenerationBlockReason(checkResult.reason);
        setExistingJobs(checkResult.jobs);
        return; // ok because finally will reset the ref
      }
  
      setGenerationBlocked(false);
      setGenerationBlockReason('');
  
      setIsGenerating(true);
      setContentGenerated(false);
      setJobsByType({});
      setArtifactsByType({});
      finishedAtRef.current = null;
      jobIdsRef.current = [];
  
      toast.info('Starting content generation...');
  
      await supabase
        .from('lectures')
        .update({ last_generate_attempt_at: new Date().toISOString() })
        .eq('id', lectureId);
  
      const requiredJobs = contentStyles.map(s => STYLE_TO_JOB[s]).filter(Boolean);
  
      const { data: clientRun } = await supabase
        .from('lecture_generation_client_runs')
        .insert({
          lecture_id: lectureId,
          status: 'started',
          job_types: requiredJobs
        })
        .select()
        .single();
  
      const clientRunId = clientRun?.id;
  
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
  
        const token = session?.access_token;
        if (!token) throw new Error('Session expired. Please log in again.');
  
        const resp = await fetch(`${BACKEND_URL}/api/lectures/${lectureId}/generate-content`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          }
        });
  
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Backend error (${resp.status}): ${errText}`);
        }
  
        const started = await resp.json();
        const jobIdsMap = started?.job_ids || {};
        const jobIds = Object.values(jobIdsMap).filter(Boolean) as string[];
  
        if (!Array.isArray(jobIds) || jobIds.length === 0) {
          throw new Error(`Backend returned success but started no jobs: ${JSON.stringify(started)}`);
        }
  
        jobIdsRef.current = jobIds;
  
        toast.info('Backend processing started. Monitoring progress...');
  
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  
        await pollJobsAndArtifacts(lectureId, jobIds);
  
        pollingIntervalRef.current = setInterval(() => {
          pollJobsAndArtifacts(lectureId, jobIdsRef.current);
        }, 2000);
  
        if (clientRunId) {
          await supabase
            .from('lecture_generation_client_runs')
            .update({ status: 'completed' })
            .eq('id', clientRunId);
        }
      } catch (innerError) {
        console.error('Error calling backend:', innerError);
  
        toast.error('Backend call failed, but generation may have started. Monitoring DB...');
  
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  
        await pollJobsAndArtifacts(lectureId, []);
        pollingIntervalRef.current = setInterval(() => {
          pollJobsAndArtifacts(lectureId, []);
        }, 2000);
  
        if (clientRunId) {
          await supabase
            .from('lecture_generation_client_runs')
            .update({
              status: 'error',
              reason: innerError instanceof Error ? innerError.message : 'Unknown error'
            })
            .eq('id', clientRunId);
        }
  
        return; // keep polling
      }
    } catch (e) {
      console.error('handleGenerateContent outer error:', e);
      toast.error('Failed to start generation');
      setIsGenerating(false);
    } finally {
      // ✅ THIS is the key fix
      isStartingGenerationRef.current = false;
    }
  };

  const handleGoToPublish = () => {
    setCurrentStep(7);
    setExpandedStep(7);
  };

  const handleRegenerateScript = async () => {
    if (scriptSaveTimeoutRef.current) {
      clearTimeout(scriptSaveTimeoutRef.current);
      scriptSaveTimeoutRef.current = null;
    }

    await saveScriptToDatabase(generatedScript);

    toast.info('Regenerating with changes...');
  };

  const handleRegenerateSlides = () => {
    toast.info('Regenerating slides...');
  };

  const handlePublishContent = async () => {
    if (!lectureId) {
      toast.error('No lecture draft found');
      return;
    }

    try {
      const { data: artifacts, error: artifactsError } = await supabase
        .from('lecture_artifacts')
        .select('artifact_type, file_url')
        .eq('lecture_id', lectureId);

      if (artifactsError) throw artifactsError;

      if (!artifacts || artifacts.length === 0) {
        toast.error('Cannot publish: No content artifacts found. Please generate content first.');
        return;
      }

      const validArtifacts = artifacts.filter(a => a.file_url && a.file_url.trim() !== '');
      if (validArtifacts.length === 0) {
        toast.error('Cannot publish: No valid content artifacts with URLs found. Please generate content first.');
        return;
      }

      const { error: updateError } = await supabase
        .from('lectures')
        .update({
          selected_course_ids: selectedCourseIds,
          library_personal: addToPersonalLibrary,
          library_usc: addToUSCLibrary,
          status: 'published'
        })
        .eq('id', lectureId);

      if (updateError) throw updateError;

      toast.success('Content published successfully!');
      if (returnTo && socraticAttach === 'avatar_lecture' && lectureId) {
        savePendingSocraticCreatedResource({
          courseId: preselectedCourseId || selectedCourseIds[0] || '',
          type: 'avatar_lecture',
          id: lectureId,
          title: lectureTitle.trim() || 'Untitled avatar lecture',
          summary: 'Avatar lecture created for Socratic Writing.',
        });
        router.push(returnTo);
        return;
      }
      router.push('/educator/dashboard');
    } catch (error) {
      console.error('Error publishing content:', error);
      toast.error('Failed to publish content');
    }
  };

  const extractFileName = (url: string): string => {
    try {
      const decodedUrl = decodeURIComponent(url);
      const urlWithoutQuery = decodedUrl.split('?')[0];
      const pathParts = urlWithoutQuery.split('/');
      const fileNameWithExt = pathParts[pathParts.length - 1] || 'Unknown File';
      return fileNameWithExt;
    } catch {
      return 'Unknown File';
    }
  };

  const extractFileNameWithoutExtension = (url: string): string => {
    const fileName = extractFileName(url);
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) return fileName;
    return fileName.substring(0, lastDotIndex);
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
    { number: 1, title: 'Select Course or Library', subtitle: 'Choose where to publish this content' },
    { number: 2, title: 'Select Materials', subtitle: 'Add any additional materials for the lecture' },
    { number: 3, title: 'Select Content Style', subtitle: 'Choose one or more content formats' },
    { number: 4, title: 'Script or Prompt Engineering', subtitle: 'Add your script or generate with AI' },
    { number: 5, title: 'Select Avatar', subtitle: 'Choose an AI presenter' },
    { number: 6, title: 'Generate Content', subtitle: 'Review and regenerate if needed' },
    { number: 7, title: 'Publish Content', subtitle: 'Choose where to publish and download options' }
  ];

  const avatarOptions = [
    { id: 'lisa' as AvatarCharacter, label: 'Lisa', file: 'Lisa.png' },
    // { id: 'lori' as AvatarCharacter, label: 'Lori', file: 'Lori.png' },
    // { id: 'meg' as AvatarCharacter, label: 'Meg', file: 'Meg.png' },
    // { id: 'jeff' as AvatarCharacter, label: 'Jeff', file: 'Jeff.png' },
    // { id: 'max' as AvatarCharacter, label: 'Max', file: 'Max.png' },
    { id: 'harry' as AvatarCharacter, label: 'Harry', file: 'Harry.png' },
  ].map((a) => {
    const { data } = supabase.storage.from('media').getPublicUrl(`Images/${a.file}`);
    return { ...a, imageUrl: data.publicUrl };
  });

  const characterStyles: Record<AvatarCharacter, { styles: string[]; default: string }> = {
    lisa: {
      styles: ['casual-sitting', 'graceful-sitting', 'graceful-standing', 'technical-sitting', 'technical-standing'],
      default: 'graceful-sitting'
    },
    lori: {
      styles: ['casual', 'graceful', 'formal'],
      default: 'graceful'
    },
    meg: {
      styles: ['formal', 'casual', 'business'],
      default: 'formal'
    },
    jeff: {
      styles: ['formal', 'business'],
      default: 'formal'
    },
    max: {
      styles: ['business', 'casual', 'formal'],
      default: 'business'
    },
    harry: {
      styles: ['business', 'casual', 'youthful'],
      default: 'business'
    }
  };

  return (
    <EducatorLayout profile={profile}>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/educator/dashboard')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">Back</span>
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{isEditMode ? 'Edit Lecture' : 'Create Lecture'}</h1>
              <p className="text-gray-600 mt-1">{isEditMode ? 'Update your lecture and regenerate content as needed' : 'Follow the steps below to create your AI-powered lecture content'}</p>
            </div>
          </div>
          {isEditMode && lectureId && (
            <button
              onClick={cloneLecture}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
            >
              <FileText className="w-5 h-5" />
              Save as New Lecture
            </button>
          )}
        </div>

        <div className="bg-brand-maroon text-white rounded-2xl p-8">
          <h2 className="text-2xl font-bold mb-2">Create New Lecture</h2>
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
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

                        <div className="mt-6">
                          <h4 className="font-semibold text-gray-900 mb-4">Add to Library</h4>
                          <div className="space-y-2">
                            <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={addToPersonalLibrary}
                                onChange={(e) => setAddToPersonalLibrary(e.target.checked)}
                                className="w-5 h-5 text-brand-maroon rounded focus:ring-brand-maroon"
                              />
                              <span className="font-medium text-gray-900">Personal Library</span>
                            </label>
                            <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={addToUSCLibrary}
                                onChange={(e) => setAddToUSCLibrary(e.target.checked)}
                                className="w-5 h-5 text-brand-maroon rounded focus:ring-brand-maroon"
                              />
                              <span className="font-medium text-gray-900">USC Library</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-gray-900 mb-4">Lecture Title <span className="text-red-600">*</span></h4>
                        <input
                          type="text"
                          value={lectureTitle}
                          onChange={(e) => setLectureTitle(e.target.value)}
                          placeholder="Enter lecture title (max 120 characters)"
                          maxLength={120}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                        />
                        <p className="text-sm text-gray-500 mt-2">
                          {lectureTitle.length}/120 characters
                        </p>
                        {lectureTitle.trim() && (
                          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-sm text-green-900">
                              <span className="font-semibold">Lecture Title: </span>
                              {lectureTitle}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={handleContinueToMaterials}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors"
                    >
                      Continue to Materials Selection
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 2 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-gray-900">Add Materials for Your Lecture</h4>
                      <button className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm">
                        <Info className="w-4 h-4" />
                        What's the difference?
                      </button>
                    </div>

                    {preloadedMaterials.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-4">Preloaded Course Materials</h4>
                        <p className="text-sm text-gray-600 mb-4">Select materials from your courses:</p>
                        <div className="space-y-2">
                          {preloadedMaterials.map((material, index) => (
                            <label key={index} className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                              <input
                                type="checkbox"
                                checked={selectedPreloadedMaterialUrls.includes(material.url)}
                                onChange={() => togglePreloadedMaterial(material.url)}
                                className="w-5 h-5 text-brand-maroon rounded focus:ring-brand-maroon mt-0.5"
                              />
                              <File className="w-5 h-5 text-gray-400 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 break-words">{material.name}</p>
                                <p className="text-xs text-gray-600 mt-1">{material.courseCode}</p>
                                <p className="text-xs text-gray-500 mt-0.5 italic">
                                  Type: {material.defaultType === 'main' ? 'Main Material' : 'Background Material'}
                                </p>
                              </div>
                              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded shrink-0">
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
                        <div className="space-y-3">
                          {allMaterials.map((material, index) => (
                            <div key={index} className="p-4 border border-gray-200 rounded-lg space-y-3">
                              <div className="flex items-start gap-3">
                                <File className="w-5 h-5 text-gray-400 mt-1" />
                                <div className="flex-1 space-y-2">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      Display Name (editable)
                                    </label>
                                    <input
                                      type="text"
                                      value={material.displayName}
                                      onChange={(e) => updateMaterialDisplayName(material.url, e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent text-sm"
                                      placeholder="Enter display name"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      File Name
                                    </label>
                                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                                      <span className="flex-1">{material.name}</span>
                                      <span className="text-xs font-semibold text-gray-500 bg-gray-200 px-2 py-1 rounded">
                                        {getFileExtension(material.name)}
                                      </span>
                                    </div>
                                  </div>
                                  {material.courseCode && (
                                    <p className="text-xs text-gray-600">From: {material.courseCode}</p>
                                  )}
                                </div>
                                <div className="flex flex-col gap-2">
                                  <button
                                    onClick={() => changeMaterialType(material.url, 'main')}
                                    className={`px-3 py-1.5 rounded-lg font-medium text-xs transition-colors ${
                                      material.type === 'main'
                                        ? 'bg-brand-maroon text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    Main
                                  </button>
                                  <button
                                    onClick={() => changeMaterialType(material.url, 'background')}
                                    className={`px-3 py-1.5 rounded-lg font-medium text-xs transition-colors ${
                                      material.type === 'background'
                                        ? 'bg-brand-yellow text-black'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    Background
                                  </button>
                                </div>
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
                            accept=".txt,.docx,.pdf"
                            onChange={handleScriptFileSelect}
                            className="hidden"
                          />
                          <button
                            onClick={() => scriptFileInputRef.current?.click()}
                            className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors"
                          >
                            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-700 font-medium">Upload Script File</p>
                            <p className="text-gray-500 text-sm">TXT, DOC, DOCX, PDF</p>
                          </button>

                          {scriptFile && (
                            <div className="mt-4 bg-gray-50 p-4 rounded-lg flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <File className="w-5 h-5 text-gray-400" />
                                <span className="font-medium text-gray-900">{scriptFile.name}</span>
                              </div>
                              <button
                                onClick={() => {
                                  setScriptFile(null);
                                  setScriptDirect('');
                                }}
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
                            Default: "Create an engaging educational video script about the topic"
                          </p>
                        </div>

                        <div>
                          <label className="block font-semibold text-gray-900 mb-3">Video Length (minutes)</label>
                          <select
                            value={videoLength}
                            onChange={(e) => setVideoLength(Number(e.target.value))}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                          >
                            <option value={1}>1 minute</option>
                            <option value={2}>2 minutes</option>
                            <option value={3}>3 minutes</option>
                            <option value={4}>4 minutes</option>
                            <option value={5}>5 minutes</option>
                          </select>
                        </div>

                        <button
                          onClick={handleGenerateScript}
                          disabled={isGeneratingScript}
                          className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 px-8 rounded-lg transition-colors flex items-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          {isGeneratingScript ? (
                            <>
                              <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-black"></div>
                              Generating Script...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-5 h-5" />
                              Generate Script with AI
                            </>
                          )}
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
                      disabled={scriptMode === 'direct' ? !scriptDirect : !scriptGenerated}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Continue to Avatar Selection
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 5 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-4">Select Character</h4>
                      <div className="grid grid-cols-3 gap-4">
                        {avatarOptions.map((avatar) => (
                          <button
                            key={avatar.id}
                            onClick={() => {
                              setSelectedCharacter(avatar.id);
                              setSelectedStyle(characterStyles[avatar.id].default);
                            }}
                            className={`p-6 border-2 rounded-xl text-center transition-all ${
                              selectedCharacter === avatar.id
                                ? 'border-brand-maroon bg-red-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="mb-3 flex justify-center">
                              <img
                                src={avatar.imageUrl}
                                alt={avatar.label}
                                className="h-20 w-20 rounded-full object-cover border border-gray-200 bg-white"
                                loading="lazy"
                              />
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm">{avatar.label}</h4>
                          </button>
                        ))}
                      </div>
                    </div>

                    {selectedCharacter && (
                      <div>
                        <label className="block font-semibold text-gray-900 mb-3">Select Style</label>
                        <select
                          value={selectedStyle}
                          onChange={(e) => setSelectedStyle(e.target.value)}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                        >
                          {characterStyles[selectedCharacter].styles.map((style) => (
                            <option key={style} value={style}>
                              {style.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      onClick={handleContinueToGenerateContent}
                      disabled={!selectedCharacter || !selectedStyle}
                      className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-8 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Continue to Generate Content
                    </button>
                  </div>
                )}

                {isExpanded && step.number === 6 && (
                  <div className="p-6 pt-0 space-y-6">
                    {!contentGenerated ? (
                      <>
                        {generationBlocked && (
                          <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-6 mb-6">
                            <div className="flex items-start gap-3 mb-4">
                              <Info className="w-6 h-6 text-amber-600 flex-shrink-0 mt-1" />
                              <div>
                                <h3 className="text-lg font-bold text-amber-900 mb-2">Generation Already Exists</h3>
                                <p className="text-amber-800 mb-4">{generationBlockReason}</p>
                                {existingJobs.length > 0 && (
                                  <div className="bg-white rounded-lg p-3 mb-4 text-sm">
                                    <p className="font-semibold text-gray-900 mb-2">Existing Jobs:</p>
                                    <ul className="space-y-1">
                                      {existingJobs.map((job, idx) => (
                                        <li key={idx} className="text-gray-700">
                                          <span className="font-medium">{job.job_type}</span>: {job.status}
                                          {job.progress > 0 && ` (${job.progress}%)`}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-3">
                              {Object.keys(artifactsByType).length > 0 && (
                                <button
                                  onClick={() => {
                                    setCurrentStep(7);
                                    setExpandedStep(7);
                                  }}
                                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
                                >
                                  <Eye className="w-4 h-4" />
                                  View Existing Output
                                </button>
                              )}
                              <button
                                onClick={handleCloneAndRegenerate}
                                className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
                              >
                                <Sparkles className="w-4 h-4" />
                                Regenerate Safely (Clone Lecture)
                              </button>
                              <button
                                onClick={() => setShowResetModal(true)}
                                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
                              >
                                <Info className="w-4 h-4" />
                                Reset Generation (Advanced)
                              </button>
                            </div>
                          </div>
                        )}

                        {!generationBlocked && (
                          <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                            <Sparkles className="w-16 h-16 text-brand-maroon mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Generate!</h3>
                            <p className="text-gray-600 mb-6">
                              Your lecture is configured and ready. Click the button below to start generating your AI-powered content.
                            </p>
                            <button
                              onClick={handleGenerateContent}
                              disabled={isGenerating}
                              className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-4 px-12 rounded-lg transition-colors text-lg disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-3 mx-auto"
                            >
                              {isGenerating && (
                                <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                              )}
                              {isGenerating ? 'Generating...' : 'Generate Content'}
                            </button>
                            {isGenerating && (
                              <p className="text-sm text-gray-600 mt-3">Starting jobs and polling status...</p>
                            )}
                          </div>
                        )}

                        {isGenerating && (
                          <div className="border border-gray-200 rounded-xl p-6 space-y-4">
                            <h4 className="font-bold text-gray-900 mb-4">Generation Progress</h4>
                            {Object.keys(jobsByType).length === 0 && (
                              <div className="text-center py-8">
                                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-maroon mb-4"></div>
                                <p className="text-gray-600">Starting generation... waiting for job updates</p>
                              </div>
                            )}
                            {contentStyles.includes('audio') && jobsByType[STYLE_TO_JOB['audio']] && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Mic className="w-5 h-5 text-brand-maroon" />
                                    <span className="font-medium text-gray-900">Audio</span>
                                  </div>
                                  <span className={`text-sm font-medium ${
                                    jobsByType[STYLE_TO_JOB['audio']].status === 'failed' ? 'text-red-600' :
                                    jobsByType[STYLE_TO_JOB['audio']].status === 'succeeded' ? 'text-green-600' :
                                    'text-brand-maroon'
                                  }`}>
                                    {jobsByType[STYLE_TO_JOB['audio']].status === 'succeeded' ? 'Complete' :
                                     jobsByType[STYLE_TO_JOB['audio']].status === 'failed' ? 'Failed' :
                                     jobsByType[STYLE_TO_JOB['audio']].status === 'running' ? `${jobsByType[STYLE_TO_JOB['audio']].progress}%` :
                                     'Queued'}
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${
                                      jobsByType[STYLE_TO_JOB['audio']].status === 'failed' ? 'bg-red-600' : 'bg-brand-maroon'
                                    }`}
                                    style={{ width: `${jobsByType[STYLE_TO_JOB['audio']].progress}%` }}
                                  />
                                </div>
                                {jobsByType[STYLE_TO_JOB['audio']].error && (
                                  <p className="text-sm text-red-600">{jobsByType[STYLE_TO_JOB['audio']].error}</p>
                                )}
                              </div>
                            )}
                            {contentStyles.includes('powerpoint') && jobsByType[STYLE_TO_JOB['powerpoint']] && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <FileText className="w-5 h-5 text-brand-maroon" />
                                    <span className="font-medium text-gray-900">PowerPoint</span>
                                  </div>
                                  <span className={`text-sm font-medium ${
                                    jobsByType[STYLE_TO_JOB['powerpoint']].status === 'failed' ? 'text-red-600' :
                                    jobsByType[STYLE_TO_JOB['powerpoint']].status === 'succeeded' ? 'text-green-600' :
                                    'text-brand-maroon'
                                  }`}>
                                    {jobsByType[STYLE_TO_JOB['powerpoint']].status === 'succeeded' ? 'Complete' :
                                     jobsByType[STYLE_TO_JOB['powerpoint']].status === 'failed' ? 'Failed' :
                                     jobsByType[STYLE_TO_JOB['powerpoint']].status === 'running' ? `${jobsByType[STYLE_TO_JOB['powerpoint']].progress}%` :
                                     'Queued'}
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${
                                      jobsByType[STYLE_TO_JOB['powerpoint']].status === 'failed' ? 'bg-red-600' : 'bg-brand-maroon'
                                    }`}
                                    style={{ width: `${jobsByType[STYLE_TO_JOB['powerpoint']].progress}%` }}
                                  />
                                </div>
                                {jobsByType[STYLE_TO_JOB['powerpoint']].error && (
                                  <p className="text-sm text-red-600">{jobsByType[STYLE_TO_JOB['powerpoint']].error}</p>
                                )}
                              </div>
                            )}
                            {contentStyles.includes('video') && jobsByType[STYLE_TO_JOB['video']] && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Video className="w-5 h-5 text-brand-maroon" />
                                    <span className="font-medium text-gray-900">Video Avatar</span>
                                  </div>
                                  <span className={`text-sm font-medium ${
                                    jobsByType[STYLE_TO_JOB['video']].status === 'failed' ? 'text-red-600' :
                                    jobsByType[STYLE_TO_JOB['video']].status === 'succeeded' ? 'text-green-600' :
                                    'text-brand-maroon'
                                  }`}>
                                    {jobsByType[STYLE_TO_JOB['video']].status === 'succeeded' ? 'Complete' :
                                     jobsByType[STYLE_TO_JOB['video']].status === 'failed' ? 'Failed' :
                                     jobsByType[STYLE_TO_JOB['video']].status === 'running' ? `${jobsByType[STYLE_TO_JOB['video']].progress}%` :
                                     'Queued'}
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${
                                      jobsByType[STYLE_TO_JOB['video']].status === 'failed' ? 'bg-red-600' : 'bg-brand-maroon'
                                    }`}
                                    style={{ width: `${jobsByType[STYLE_TO_JOB['video']].progress}%` }}
                                  />
                                </div>
                                {jobsByType[STYLE_TO_JOB['video']].error && (
                                  <p className="text-sm text-red-600">{jobsByType[STYLE_TO_JOB['video']].error}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="border border-gray-200 rounded-xl p-6">
                          <h4 className="font-bold text-gray-900 mb-4">Summary</h4>
                          <div className="space-y-3 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Courses Selected:</span>
                              <span className="font-medium text-gray-900">{selectedCourseIds.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Materials Added:</span>
                              <span className="font-medium text-gray-900">{allMaterials.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Content Styles:</span>
                              <span className="font-medium text-gray-900">{contentStyles.join(', ').toUpperCase()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Character:</span>
                              <span className="font-medium text-gray-900">
                                {selectedCharacter ? avatarOptions.find(a => a.id === selectedCharacter)?.label : 'None'}
                              </span>
                            </div>
                            {selectedCharacter && selectedStyle && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Style:</span>
                                <span className="font-medium text-gray-900">
                                  {selectedStyle.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                                </span>
                              </div>
                            )}
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
                        {artifactsByType[JOB_TO_ARTIFACT['video_avatar']] && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-4">Video Preview</h4>
                            <div className="bg-gray-900 rounded-xl overflow-hidden">
                              <video controls className="w-full" src={artifactsByType[JOB_TO_ARTIFACT['video_avatar']]} />
                            </div>
                          </div>
                        )}

                        {!artifactsByType[JOB_TO_ARTIFACT['video_avatar']] && artifactsByType[JOB_TO_ARTIFACT['audio']] && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-4">Audio Preview</h4>
                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                              <audio controls className="w-full" src={artifactsByType[JOB_TO_ARTIFACT['audio']]} />
                            </div>
                          </div>
                        )}

                        {artifactsByType[JOB_TO_ARTIFACT['pptx']] && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-4">PowerPoint Presentation</h4>
                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                              <p className="text-gray-700 font-medium mb-4">PowerPoint presentation ready</p>
                              <a
                                href={artifactsByType[JOB_TO_ARTIFACT['pptx']]}
                                download
                                className="inline-flex items-center gap-2 bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-6 rounded-lg transition-colors"
                              >
                                <Download className="w-5 h-5" />
                                Download PPTX
                              </a>
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold text-gray-900">Edit Script & Regenerate</h4>
                            {isEditMode && lectureId && (
                              <button
                                onClick={cloneLecture}
                                className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
                              >
                                <FileText className="w-4 h-4" />
                                Save as New Lecture
                              </button>
                            )}
                          </div>
                          <textarea
                            value={generatedScript}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setGeneratedScript(newValue);
                              debouncedSaveScript(newValue);
                            }}
                            className="w-full h-48 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-white"
                          />
                          <div className="mt-3 flex gap-3">
                            <button
                              onClick={handleRegenerateScript}
                              className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
                            >
                              <Sparkles className="w-5 h-5" />
                              Regenerate with Changes
                            </button>
                            <button
                              onClick={handleGoToPublish}
                              className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
                            >
                              <CheckCircle className="w-5 h-5" />
                              Go to Publish
                            </button>
                          </div>
                        </div>

                        {contentStyles.includes('powerpoint') && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-4">Edit Prompt & Regenerate</h4>
                            <button
                              onClick={handleRegenerateSlides}
                              className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2"
                            >
                              <Sparkles className="w-5 h-5" />
                              Regenerate Slides
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {isExpanded && step.number === 7 && (
                  <div className="p-6 pt-0 space-y-6">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-4">Publish To</h4>

                      <div className="mb-4">
                        <p className="text-sm text-gray-600 mb-3">Courses (Selected Earlier):</p>
                        <div className="space-y-2">
                          {courses.filter(c => selectedCourseIds.includes(c.id)).map(course => (
                            <div key={course.id} className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                              <CheckCircle className="w-5 h-5 text-green-600" />
                              <span className="font-medium text-gray-900">{course.course_number} - {course.title}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={addToPersonalLibrary}
                            onChange={(e) => setAddToPersonalLibrary(e.target.checked)}
                            className="w-5 h-5 text-brand-maroon rounded focus:ring-brand-maroon"
                          />
                          <span className="font-medium text-gray-900">Personal Library</span>
                        </label>
                        <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={addToUSCLibrary}
                            onChange={(e) => setAddToUSCLibrary(e.target.checked)}
                            className="w-5 h-5 text-brand-maroon rounded focus:ring-brand-maroon"
                          />
                          <span className="font-medium text-gray-900">USC Library</span>
                        </label>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={handlePublishContent}
                        className="flex-1 bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-4 px-8 rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <CheckCircle className="w-5 h-5" />
                        Publish Content
                      </button>
                      <button
                        onClick={() => toast.info('Download functionality coming soon')}
                        className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-4 px-8 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <Download className="w-5 h-5" />
                        Download
                      </button>
                      <button
                        onClick={() => toast.info('Student view coming soon')}
                        className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-4 px-8 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <Eye className="w-5 h-5" />
                        Student View
                      </button>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm text-blue-900 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Your content will be published to the selected locations and will be available immediately to students.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showResetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="bg-red-100 p-2 rounded-lg">
                <Info className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Reset Generation State (Advanced)</h3>
                <p className="text-gray-700 mb-4">
                  This will delete all lecture_jobs and lecture_artifacts for the selected content types from the database.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
              <p className="text-sm text-amber-900 font-semibold mb-2">Warning:</p>
              <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
                <li>This only cleans database records, not backend storage files</li>
                <li>Generated files may remain orphaned in storage</li>
                <li>This action cannot be undone</li>
                <li>Recommended: Use "Clone Lecture" instead for safe regeneration</li>
              </ul>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Type <span className="font-mono bg-gray-100 px-2 py-1 rounded">RESET</span> to confirm:
              </label>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="Type RESET here"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmText('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetGeneration}
                disabled={resetConfirmText !== 'RESET'}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Reset Generation State
              </button>
            </div>
          </div>
        </div>
      )}
    </EducatorLayout>
  );
}
