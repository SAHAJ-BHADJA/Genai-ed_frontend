'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, Profile, Course } from '@/lib/supabase';
import StudentLayout from '@/components/StudentLayout';
import { ArrowLeft, Upload, File, Check, ChevronDown, ChevronUp, Info, Video, Mic, FileText, Sparkles, Download, Eye, Play, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getBackendBase } from '@/lib/backend';
import { validateFileSize } from '@/lib/fileUpload';

type MaterialWithType = {
  url: string;
  name: string;
  type: 'main' | 'background';
  sourceCourseId?: string;
  courseTitle?: string;
  courseCode?: string;
};

type AvatarType = 'professional_male' | 'professional_female' | 'casual_male' | 'casual_female';

const BACKEND_URL = getBackendBase().replace(/\/$/, '');

export default function CreateLecture() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lectureId = searchParams.get('lectureId');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [expandedStep, setExpandedStep] = useState(1);

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [addToPersonalLibrary, setAddToPersonalLibrary] = useState(false);
  const [addToUSCLibrary, setAddToUSCLibrary] = useState(false);

  const [preloadedMaterials, setPreloadedMaterials] = useState<Array<{ url: string; name: string; courseTitle: string; courseCode: string; sourceCourseId: string }>>([]);
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

  const [selectedAvatar, setSelectedAvatar] = useState<AvatarType | null>(null);

  const [contentGenerated, setContentGenerated] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const additionalFilesInputRef = useRef<HTMLInputElement>(null);
  const scriptFileInputRef = useRef<HTMLInputElement>(null);

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

      if (!profileData || profileData.role !== 'student') {
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

  const handleScriptFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFileSize(file, 5)) {
      toast.error('Script file exceeds 5MB limit');
      return;
    }

    setScriptFile(file);
  };

  const handleContinueToMaterials = async () => {
    if (selectedCourseIds.length === 0 && !addToPersonalLibrary && !addToUSCLibrary) {
      toast.error('Please select at least one course or library');
      return;
    }

    if (!lectureId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('You must be logged in');
        return;
      }

      const primaryCourseId = selectedCourseIds[0];
      if (!primaryCourseId) {
        toast.error('Please select at least one course');
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
          title: 'Draft Lecture',
          status: 'draft'
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating draft:', error);
        toast.error('Failed to save draft');
        return;
      }

      if (draftLecture) {
        router.push(`/student/create-lecture?lectureId=${draftLecture.id}`);
        return;
      }
    }

    setCurrentStep(2);
    setExpandedStep(2);
  };

  const handleContinueToContentStyle = () => {
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

  const handleContinueToScriptPrompt = () => {
    if (contentStyles.length === 0) {
      toast.error('Please select at least one content style');
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
          video_length: videoLength
        })
        .eq('id', lectureId);

      if (updateError) throw updateError;

      const { data: jobData, error: jobError } = await supabase
        .from('lecture_jobs')
        .insert({
          lecture_id: lectureId,
          job_type: 'scripts',
          status: 'running',
          progress: 10
        })
        .select()
        .single();

      if (jobError) throw jobError;

      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-lecture-script/api/lectures/${lectureId}/generate-script`, {
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

      const { error: jobUpdateError } = await supabase
        .from('lecture_jobs')
        .update({
          status: 'succeeded',
          progress: 100
        })
        .eq('id', jobData.id);

      if (jobUpdateError) throw jobUpdateError;

      setGeneratedScript(realScript);
      setScriptGenerated(true);
      toast.success('Script generated successfully!');
    } catch (error) {
      console.error('Error generating script:', error);
      toast.error('Failed to generate script');

      if (lectureId) {
        await supabase
          .from('lecture_jobs')
          .update({
            status: 'failed',
            result: { error: error instanceof Error ? error.message : 'Unknown error' }
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'scripts');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleContinueToAvatarSelection = () => {
    if (scriptMode === 'direct' && !scriptDirect && !scriptFile) {
      toast.error('Please enter a script or upload a script file');
      return;
    }

    if (scriptMode === 'ai' && !scriptGenerated) {
      toast.error('Please generate a script first');
      return;
    }

    setCurrentStep(5);
    setExpandedStep(5);
  };

  const handleContinueToGenerateContent = () => {
    if (!selectedAvatar) {
      toast.error('Please select an avatar');
      return;
    }

    setCurrentStep(6);
    setExpandedStep(6);
  };

  const handleGenerateContent = async () => {
    setIsGenerating(true);
    toast.info('Generating content...');

    setTimeout(() => {
      setIsGenerating(false);
      setContentGenerated(true);
      toast.success('Content generated successfully!');
    }, 2000);
  };

  const handleGoToPublish = () => {
    setCurrentStep(7);
    setExpandedStep(7);
  };

  const handleRegenerateScript = () => {
    toast.info('Regenerating with changes...');
  };

  const handleRegenerateSlides = () => {
    toast.info('Regenerating slides...');
  };

  const handlePublishContent = () => {
    toast.success('Content published successfully!');
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
    { id: 'professional_male', label: 'Professional Male', emoji: '👨‍💼' },
    { id: 'professional_female', label: 'Professional Female', emoji: '👩‍💼' },
    { id: 'casual_male', label: 'Casual Male', emoji: '🙋‍♂️' },
    { id: 'casual_female', label: 'Casual Female', emoji: '🙋‍♀️' }
  ];

  return (
    <StudentLayout profile={profile}>
      <div className="max-w-5xl mx-auto space-y-8">
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

                    <div>
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
                            accept=".txt,.doc,.docx,.pdf"
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
                            <option value={5}>5 minutes</option>
                            <option value={10}>10 minutes</option>
                            <option value={15}>15 minutes</option>
                            <option value={20}>20 minutes</option>
                            <option value={30}>30 minutes</option>
                            <option value={45}>45 minutes</option>
                            <option value={60}>60 minutes</option>
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
                    <div className="grid grid-cols-4 gap-4">
                      {avatarOptions.map((avatar) => (
                        <button
                          key={avatar.id}
                          onClick={() => setSelectedAvatar(avatar.id as AvatarType)}
                          className={`p-6 border-2 rounded-xl text-center transition-all ${
                            selectedAvatar === avatar.id
                              ? 'border-brand-maroon bg-red-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="text-5xl mb-3">{avatar.emoji}</div>
                          <h4 className="font-bold text-gray-900 text-sm">{avatar.label}</h4>
                        </button>
                      ))}
                    </div>

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
                        {(contentStyles.includes('video') || contentStyles.includes('audio')) && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-4">Content Preview</h4>
                            <div className="bg-gray-900 rounded-xl p-20 flex items-center justify-center aspect-video">
                              <div className="text-center">
                                <Play className="w-20 h-20 text-gray-400 mx-auto mb-4" />
                                <p className="text-white text-lg">Video/Audio Preview</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {contentStyles.includes('powerpoint') && (
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-4">PowerPoint Preview</h4>
                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-12 text-center">
                              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                              <p className="text-gray-700 font-medium">PowerPoint slides generated</p>
                              <p className="text-gray-600 text-sm mt-1">12 slides created</p>
                            </div>
                          </div>
                        )}

                        <div>
                          <h4 className="font-semibold text-gray-900 mb-4">Edit Script & Regenerate</h4>
                          <textarea
                            value={generatedScript}
                            onChange={(e) => setGeneratedScript(e.target.value)}
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
                        onClick={() => toast.info('Preview coming soon')}
                        className="bg-brand-yellow hover:bg-brand-yellow-hover text-black font-bold py-4 px-8 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <Eye className="w-5 h-5" />
                        Preview
                      </button>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm text-blue-900 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Your content will be published to the selected locations and will be available immediately.
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
