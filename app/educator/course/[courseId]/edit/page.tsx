'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase, Profile, Course } from '@/lib/supabase';
import EducatorLayout from '@/components/EducatorLayout';
import { ArrowLeft, GraduationCap, FileText, Users, BookOpen, FolderOpen, Upload, Plus, X, Save, File, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadCourseFile, uploadMultipleFiles, validateFileSize, validateFileType } from '@/lib/fileUpload';
import {
  createEmptyStudentEntry,
  mergeStudentRosterEntries,
  parseStudentRosterFile,
  StudentRosterEntry,
} from '@/lib/studentRoster';

type CourseStudentRosterRow = {
  course_student_id: string;
  student_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

const safeText = (value: unknown): string => (typeof value === 'string' ? value : '');

export default function EditCourse() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.courseId as string;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [semester, setSemester] = useState('Fall 2026');
  const [courseNumber, setCourseNumber] = useState('');
  const [section, setSection] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [instructorName, setInstructorName] = useState('');

  const [teachingAssistants, setTeachingAssistants] = useState<string[]>([]);
  const [taInput, setTaInput] = useState('');

  const [students, setStudents] = useState<StudentRosterEntry[]>([]);
  const [studentInput, setStudentInput] = useState<StudentRosterEntry>(createEmptyStudentEntry());

  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [textbookInput, setTextbookInput] = useState('');

  const [syllabusFile, setSyllabusFile] = useState<File | null>(null);
  const [existingSyllabusUrl, setExistingSyllabusUrl] = useState<string | null>(null);
  const [studentRosterFile, setStudentRosterFile] = useState<File | null>(null);
  const [courseMaterialsFiles, setCourseMaterialsFiles] = useState<File[]>([]);
  const [existingCourseMaterials, setExistingCourseMaterials] = useState<Array<{url: string, displayName: string, fileName: string}>>([]);
  const [backgroundMaterialsFiles, setBackgroundMaterialsFiles] = useState<File[]>([]);
  const [existingBackgroundMaterials, setExistingBackgroundMaterials] = useState<Array<{url: string, displayName: string, fileName: string}>>([]);

  const syllabusInputRef = useRef<HTMLInputElement>(null);
  const studentRosterInputRef = useRef<HTMLInputElement>(null);
  const courseMaterialsInputRef = useRef<HTMLInputElement>(null);
  const backgroundMaterialsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkAuth();
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

      const { data: courseData } = await supabase
        .from('courses')
        .select('*')
        .eq('id', courseId)
        .eq('educator_id', user.id)
        .maybeSingle();

      if (courseData) {
        setCourse(courseData);
        setSemester(safeText(courseData.semester) || 'Fall 2026');
        setCourseNumber(safeText(courseData.course_number));
        setSection(safeText(courseData.section));
        setCourseTitle(safeText(courseData.title));
        setInstructorName(safeText(courseData.instructor_name));
        setExistingSyllabusUrl(courseData.syllabus_url);

        const courseMats = courseData.course_materials_data || courseData.course_materials_urls || [];
        const bgMats = courseData.background_materials_data || courseData.background_materials_urls || [];

        setExistingCourseMaterials(
          Array.isArray(courseMats) && courseMats.length > 0 && typeof courseMats[0] === 'object'
            ? courseMats
            : courseMats.map((url: string) => ({
                url,
                displayName: url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Material',
                fileName: url.split('/').pop() || 'file'
              }))
        );

        setExistingBackgroundMaterials(
          Array.isArray(bgMats) && bgMats.length > 0 && typeof bgMats[0] === 'object'
            ? bgMats
            : bgMats.map((url: string) => ({
                url,
                displayName: url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Material',
                fileName: url.split('/').pop() || 'file'
              }))
        );

        const { data: tasData } = await supabase
          .from('course_teaching_assistants')
          .select('email')
          .eq('course_id', courseId);
        if (tasData) {
          setTeachingAssistants(tasData.map(ta => ta.email));
        }

        const { data: studentsData, error: studentsError } = await supabase
          .rpc('get_course_student_roster', { p_course_id: courseId });
        if (studentsError) {
          throw studentsError;
        }
        if (studentsData) {
          setStudents(
            (studentsData as CourseStudentRosterRow[]).map(student => ({
              id: student.course_student_id,
              firstName: student.first_name ?? '',
              lastName: student.last_name ?? '',
              email: student.email ?? '',
              studentId: student.student_id,
            }))
          );
        }

        const { data: textbooksData } = await supabase
          .from('course_textbooks')
          .select('title_isbn')
          .eq('course_id', courseId);
        if (textbooksData) {
          setTextbooks(textbooksData.map(t => t.title_isbn));
        }
      }
    } catch (error) {
      console.error('Error loading course:', error);
    } finally {
      setLoading(false);
    }
  };

  const addTeachingAssistant = () => {
    if (taInput.trim() && taInput.includes('@')) {
      setTeachingAssistants([...teachingAssistants, taInput.trim()]);
      setTaInput('');
    } else {
      toast.error('Please enter a valid email address');
    }
  };

  const removeTeachingAssistant = (index: number) => {
    setTeachingAssistants(teachingAssistants.filter((_, i) => i !== index));
  };

  const addStudent = () => {
    const email = studentInput.email.trim();

    if (!email || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    setStudents(prev =>
      mergeStudentRosterEntries(prev, [
        {
          ...studentInput,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          email,
        },
      ])
    );
    setStudentInput(createEmptyStudentEntry());
  };

  const removeStudent = (index: number) => {
    setStudents(students.filter((_, i) => i !== index));
  };

  const updateStudent = (
    index: number,
    field: 'firstName' | 'lastName' | 'email',
    value: string
  ) => {
    setStudents(prev =>
      prev.map((student, currentIndex) =>
        currentIndex === index ? { ...student, [field]: value } : student
      )
    );
  };

  const addTextbook = () => {
    if (textbookInput.trim()) {
      setTextbooks([...textbooks, textbookInput.trim()]);
      setTextbookInput('');
    }
  };

  const removeTextbook = (index: number) => {
    setTextbooks(textbooks.filter((_, i) => i !== index));
  };

  const handleSyllabusSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

    if (!validateFileType(file, allowedTypes)) {
      toast.error('Please upload a PDF, DOC, or DOCX file');
      return;
    }

    if (!validateFileSize(file, 10)) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setSyllabusFile(file);
    setExistingSyllabusUrl(null);
  };

  const handleStudentRosterSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

    if (!validateFileType(file, allowedTypes)) {
      toast.error('Please upload a CSV or Excel file');
      return;
    }

    if (!validateFileSize(file, 10)) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setStudentRosterFile(file);

    const parsedStudents = await parseStudentRosterFile(file);

    if (parsedStudents.length > 0) {
      setStudents(prev => mergeStudentRosterEntries(prev, parsedStudents));
      toast.success(`Added ${parsedStudents.length} students from roster`);
    } else {
      toast.error('No valid student rows found in the uploaded file');
    }
  };

  const handleCourseMaterialsSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];

    Array.from(files).forEach(file => {
      if (!validateFileSize(file, 10)) {
        toast.error(`${file.name} exceeds 10MB limit`);
        return;
      }
      validFiles.push(file);
    });

    setCourseMaterialsFiles(prev => [...prev, ...validFiles]);
  };

  const handleBackgroundMaterialsSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];

    Array.from(files).forEach(file => {
      if (!validateFileSize(file, 10)) {
        toast.error(`${file.name} exceeds 10MB limit`);
        return;
      }
      validFiles.push(file);
    });

    setBackgroundMaterialsFiles(prev => [...prev, ...validFiles]);
  };

  const removeCourseMaterial = (index: number) => {
    setCourseMaterialsFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeBackgroundMaterial = (index: number) => {
    setBackgroundMaterialsFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeExistingCourseMaterial = (index: number) => {
    setExistingCourseMaterials(prev => prev.filter((_, i) => i !== index));
  };

  const removeExistingBackgroundMaterial = (index: number) => {
    setExistingBackgroundMaterials(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateCourse = async () => {
    if (!profile || !course) return;

    if (!courseNumber.trim() || !courseTitle.trim()) {
      toast.error('Please fill in required fields: Course Number and Course Title');
      return;
    }

    setSaving(true);
    try {
      let syllabusUrl = existingSyllabusUrl;
      const courseMaterialsData = [...existingCourseMaterials];
      const backgroundMaterialsData = [...existingBackgroundMaterials];

      if (syllabusFile) {
        toast.info('Uploading syllabus...');
        syllabusUrl = await uploadCourseFile(courseId, 'syllabus', syllabusFile);
      }

      if (courseMaterialsFiles.length > 0) {
        toast.info(`Uploading ${courseMaterialsFiles.length} course materials...`);
        const urls = await uploadMultipleFiles(courseId, 'materials', courseMaterialsFiles);
        courseMaterialsData.push(...urls.map(url => ({
          url,
          displayName: url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Material',
          fileName: url.split('/').pop() || 'file'
        })));
      }

      if (backgroundMaterialsFiles.length > 0) {
        toast.info(`Uploading ${backgroundMaterialsFiles.length} background materials...`);
        const urls = await uploadMultipleFiles(courseId, 'background', backgroundMaterialsFiles);
        backgroundMaterialsData.push(...urls.map(url => ({
          url,
          displayName: url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Material',
          fileName: url.split('/').pop() || 'file'
        })));
      }

      const payload = {
        course_number: safeText(courseNumber).trim(),
        title: safeText(courseTitle).trim(),
        semester: safeText(semester).trim() || 'Fall 2026',
        section: safeText(section).trim() || null,
        instructor_name: safeText(instructorName).trim(),
        syllabus_url: syllabusUrl || null,
        course_materials_data: courseMaterialsData,
        background_materials_data: backgroundMaterialsData,
      };

      const { error: updateError } = await supabase
        .from('courses')
        .update(payload)
        .eq('id', courseId)
        .eq('educator_id', profile.id);

      if (updateError) {
        console.error("Update error details:", updateError);
        throw updateError;
      }

      const studentPayload = students.map(student => ({
        first_name: safeText(student.firstName).trim(),
        last_name: safeText(student.lastName).trim(),
        email: safeText(student.email).trim(),
      }));

      const seenEmails = new Set<string>();
      for (const student of studentPayload) {
        if (!student.email || !student.email.includes('@')) {
          throw new Error('Every student must have a valid email address.');
        }

        const normalizedEmail = student.email.toLowerCase();
        if (seenEmails.has(normalizedEmail)) {
          throw new Error(`Duplicate student email found: ${student.email}`);
        }
        seenEmails.add(normalizedEmail);
      }

      const { error: taDeleteError } = await supabase
        .from('course_teaching_assistants')
        .delete()
        .eq('course_id', courseId);

      if (taDeleteError) {
        throw taDeleteError;
      }

      if (teachingAssistants.length > 0) {
        const taRecords = teachingAssistants.map(email => ({
          course_id: courseId,
          email: email,
        }));
        const { error: taInsertError } = await supabase
          .from('course_teaching_assistants')
          .insert(taRecords);

        if (taInsertError) {
          throw taInsertError;
        }
      }

      const { data: syncedStudents, error: syncStudentsError } = await supabase.rpc(
        'sync_course_student_roster',
        {
          p_course_id: courseId,
          p_students: studentPayload,
        }
      );

      if (syncStudentsError) {
        throw syncStudentsError;
      }

      setStudents(
        ((syncedStudents ?? []) as CourseStudentRosterRow[]).map(student => ({
          id: student.course_student_id,
          firstName: student.first_name ?? '',
          lastName: student.last_name ?? '',
          email: student.email ?? '',
          studentId: student.student_id,
        }))
      );

      const { error: textbookDeleteError } = await supabase
        .from('course_textbooks')
        .delete()
        .eq('course_id', courseId);

      if (textbookDeleteError) {
        throw textbookDeleteError;
      }

      if (textbooks.length > 0) {
        const textbookRecords = textbooks.map(titleIsbn => ({
          course_id: courseId,
          title_isbn: titleIsbn,
        }));
        const { error: textbookInsertError } = await supabase
          .from('course_textbooks')
          .insert(textbookRecords);

        if (textbookInsertError) {
          throw textbookInsertError;
        }
      }

      toast.success('Course updated successfully!');
      router.push(`/educator/course/${courseId}`);
    } catch (error: any) {
      console.error('Error updating course:', error);
      console.error('Supabase error message:', error?.message);
      console.error('Supabase error details:', error?.details);
      console.error('Supabase error hint:', error?.hint);
      toast.error(error?.message || 'Failed to update course. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!profile || !course) return;

    setDeleting(true);
    try {
      const { error: deleteError } = await supabase
        .from('courses')
        .delete()
        .eq('id', courseId)
        .eq('educator_id', profile.id);

      if (deleteError) throw deleteError;

      toast.success('Course deleted successfully');
      router.push('/educator/dashboard');
    } catch (error) {
      console.error('Error deleting course:', error);
      toast.error('Failed to delete course. Please try again.');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!course) {
    return (
      <EducatorLayout profile={profile}>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Course Not Found</h1>
          <button
            onClick={() => router.push('/educator/dashboard')}
            className="text-brand-maroon hover:text-brand-maroon-hover font-medium"
          >
            Return to Dashboard
          </button>
        </div>
      </EducatorLayout>
    );
  }

  return (
    <EducatorLayout profile={profile}>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(`/educator/course/${courseId}`)}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-medium">Back</span>
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Manage Course</h1>
              <p className="text-gray-600 mt-1">Update course information and materials</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={saving || deleting}
              className="border border-[#DC2626] text-[#DC2626] hover:bg-red-50 font-semibold py-2.5 px-5 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              Delete Course
            </button>
            <button
              onClick={handleUpdateCourse}
              disabled={saving || deleting}
              className="bg-[#8B1A1A] hover:bg-[#6B1414] text-white font-semibold py-2.5 px-5 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Updating...' : 'Update Course'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-brand-maroon p-3 rounded-xl">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Basic Information</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Semester <span className="text-red-600">*</span>
                </label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                >
                  <option value="Spring 2026">Spring 2026</option>
                  <option value="Summer 2026">Summer 2026</option>
                  <option value="Fall 2026">Fall 2026</option>
                  <option value="Spring 2027">Spring 2027</option>
                  <option value="Summer 2027">Summer 2027</option>
                  <option value="Fall 2027">Fall 2027</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Course Number <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={courseNumber}
                  onChange={(e) => setCourseNumber(e.target.value)}
                  placeholder="e.g., ECON 203"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Section
                </label>
                <input
                  type="text"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  placeholder="e.g., 001"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Course Title <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder="e.g., Principles of Microeconomics"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Instructor Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={instructorName}
                  onChange={(e) => setInstructorName(e.target.value)}
                  placeholder="e.g., Dr. John Smith"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-brand-yellow p-3 rounded-xl">
                <FileText className="w-6 h-6 text-black" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Syllabus</h2>
            </div>

            <input
              ref={syllabusInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleSyllabusSelect}
              className="hidden"
            />

            {existingSyllabusUrl && !syllabusFile ? (
              <div className="border-2 border-blue-300 bg-blue-50 rounded-xl p-6 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <File className="w-8 h-8 text-blue-600" />
                    <div>
                      <p className="font-medium text-gray-900">Current Syllabus</p>
                      <a
                        href={existingSyllabusUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline"
                      >
                        View File
                      </a>
                    </div>
                  </div>
                  <button
                    onClick={() => syllabusInputRef.current?.click()}
                    className="text-brand-maroon hover:text-brand-maroon-hover font-medium text-sm"
                  >
                    Replace
                  </button>
                </div>
              </div>
            ) : syllabusFile ? (
              <div className="border-2 border-green-300 bg-green-50 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <File className="w-8 h-8 text-green-600" />
                    <div>
                      <p className="font-medium text-gray-900">{syllabusFile.name}</p>
                      <p className="text-sm text-gray-600">{(syllabusFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSyllabusFile(null);
                      if (course.syllabus_url) setExistingSyllabusUrl(course.syllabus_url);
                    }}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => syllabusInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-gray-400 transition-colors"
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-700 font-medium mb-1">Click to upload syllabus</p>
                <p className="text-gray-500 text-sm">PDF, DOC, DOCX up to 10MB</p>
              </button>
            )}
          </div>

          <div className="pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-brand-maroon p-3 rounded-xl">
                <Users className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Teaching Assistants</h2>
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="email"
                value={taInput}
                onChange={(e) => setTaInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addTeachingAssistant()}
                placeholder="Enter TA email"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
              />
              <button
                onClick={addTeachingAssistant}
                className="bg-brand-yellow hover:bg-brand-yellow-hover p-3 rounded-lg transition-colors"
              >
                <Plus className="w-6 h-6 text-black" />
              </button>
            </div>

            {teachingAssistants.length > 0 && (
              <div className="space-y-2">
                {teachingAssistants.map((ta, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
                    <span className="text-gray-700">{ta}</span>
                    <button
                      onClick={() => removeTeachingAssistant(index)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-brand-yellow p-3 rounded-xl">
                <Users className="w-6 h-6 text-black" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Students</h2>
            </div>

            <input
              ref={studentRosterInputRef}
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={handleStudentRosterSelect}
              className="hidden"
            />

            <button
              onClick={() => studentRosterInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors mb-4"
            >
              <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-700 font-medium text-sm">Upload student list (Excel/CSV)</p>
            </button>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.4fr_auto] gap-2 mb-4">
              <input
                type="text"
                value={studentInput.firstName}
                onChange={(e) => setStudentInput(prev => ({ ...prev, firstName: e.target.value }))}
                placeholder="First name"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
              />
              <input
                type="text"
                value={studentInput.lastName}
                onChange={(e) => setStudentInput(prev => ({ ...prev, lastName: e.target.value }))}
                placeholder="Last name"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
              />
              <input
                type="email"
                value={studentInput.email}
                onChange={(e) => setStudentInput(prev => ({ ...prev, email: e.target.value }))}
                onKeyPress={(e) => e.key === 'Enter' && addStudent()}
                placeholder="Enter student email"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
              />
              <button
                onClick={addStudent}
                className="bg-brand-yellow hover:bg-brand-yellow-hover p-3 rounded-lg transition-colors h-[52px]"
              >
                <Plus className="w-6 h-6 text-black" />
              </button>
            </div>

            {students.length > 0 && (
              <div className="space-y-3">
                {students.map((student, index) => (
                  <div key={student.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.4fr_auto] gap-2 bg-gray-50 px-4 py-3 rounded-lg">
                    <input
                      type="text"
                      value={student.firstName}
                      onChange={(e) => updateStudent(index, 'firstName', e.target.value)}
                      placeholder="First name"
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-white"
                    />
                    <input
                      type="text"
                      value={student.lastName}
                      onChange={(e) => updateStudent(index, 'lastName', e.target.value)}
                      placeholder="Last name"
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-white"
                    />
                    <input
                      type="email"
                      value={student.email}
                      onChange={(e) => updateStudent(index, 'email', e.target.value)}
                      placeholder="Email"
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-white"
                    />
                    <button
                      onClick={() => removeStudent(index)}
                      className="text-gray-400 hover:text-red-600 transition-colors justify-self-end self-center"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-brand-yellow p-3 rounded-xl">
                <BookOpen className="w-6 h-6 text-black" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Textbooks</h2>
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={textbookInput}
                onChange={(e) => setTextbookInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addTextbook()}
                placeholder="Enter textbook title and ISBN"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
              />
              <button
                onClick={addTextbook}
                className="bg-brand-yellow hover:bg-brand-yellow-hover p-3 rounded-lg transition-colors"
              >
                <Plus className="w-6 h-6 text-black" />
              </button>
            </div>

            {textbooks.length > 0 && (
              <div className="space-y-2">
                {textbooks.map((textbook, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
                    <span className="text-gray-700">{textbook}</span>
                    <button
                      onClick={() => removeTextbook(index)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-brand-maroon p-3 rounded-xl">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Course Materials</h2>
            </div>

            <input
              ref={courseMaterialsInputRef}
              type="file"
              multiple
              onChange={handleCourseMaterialsSelect}
              className="hidden"
            />

            <button
              onClick={() => courseMaterialsInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors mb-4"
            >
              <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-700 font-medium text-sm">Upload additional course materials</p>
            </button>

            {existingCourseMaterials.length > 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Current Materials:</p>
                {existingCourseMaterials.map((material, index) => (
                  <div key={index} className="bg-blue-50 px-4 py-3 rounded-lg">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <File className="w-5 h-5 text-blue-600 mt-1" />
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={material.displayName}
                            onChange={(e) => {
                              const updated = [...existingCourseMaterials];
                              updated[index] = { ...material, displayName: e.target.value };
                              setExistingCourseMaterials(updated);
                            }}
                            className="w-full px-3 py-1.5 text-gray-900 font-medium bg-white border border-gray-300 rounded focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                            placeholder="Display name"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">File:</span>
                            <a
                              href={material.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {material.fileName}
                            </a>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeExistingCourseMaterial(index)}
                        className="text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {courseMaterialsFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700 mb-2">New Materials:</p>
                {courseMaterialsFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-green-50 px-4 py-3 rounded-lg">
                    <div className="flex items-center gap-3">
                      <File className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="text-gray-900 font-medium">{file.name}</p>
                        <p className="text-sm text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeCourseMaterial(index)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-gray-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-brand-maroon p-3 rounded-xl">
                <FolderOpen className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Background Materials</h2>
            </div>

            <input
              ref={backgroundMaterialsInputRef}
              type="file"
              multiple
              onChange={handleBackgroundMaterialsSelect}
              className="hidden"
            />

            <button
              onClick={() => backgroundMaterialsInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors mb-4"
            >
              <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-700 font-medium text-sm">Upload additional background materials</p>
            </button>

            {existingBackgroundMaterials.length > 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Current Materials:</p>
                {existingBackgroundMaterials.map((material, index) => (
                  <div key={index} className="bg-blue-50 px-4 py-3 rounded-lg">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <File className="w-5 h-5 text-blue-600 mt-1" />
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={material.displayName}
                            onChange={(e) => {
                              const updated = [...existingBackgroundMaterials];
                              updated[index] = { ...material, displayName: e.target.value };
                              setExistingBackgroundMaterials(updated);
                            }}
                            className="w-full px-3 py-1.5 text-gray-900 font-medium bg-white border border-gray-300 rounded focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                            placeholder="Display name"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">File:</span>
                            <a
                              href={material.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {material.fileName}
                            </a>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeExistingBackgroundMaterial(index)}
                        className="text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {backgroundMaterialsFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700 mb-2">New Materials:</p>
                {backgroundMaterialsFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-green-50 px-4 py-3 rounded-lg">
                    <div className="flex items-center gap-3">
                      <File className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="text-gray-900 font-medium">{file.name}</p>
                        <p className="text-sm text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeBackgroundMaterial(index)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="bg-red-100 p-3 rounded-full">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">Delete Course</h3>
              </div>

              <p className="text-gray-700">
                Are you sure you want to delete <span className="font-semibold">{course?.title}</span>?
                This action cannot be undone and will remove all associated data including students, teaching assistants, and materials.
              </p>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteCourse}
                  disabled={deleting}
                  className="flex-1 px-4 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>Deleting...</>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5" />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EducatorLayout>
  );
}
