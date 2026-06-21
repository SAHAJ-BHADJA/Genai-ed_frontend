'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Profile } from '@/lib/supabase';
import EducatorLayout from '@/components/EducatorLayout';
import { ArrowLeft, GraduationCap, FileText, Users, BookOpen, FolderOpen, Upload, Plus, X, Save, File } from 'lucide-react';
import { toast } from 'sonner';
import { uploadCourseFile, uploadMultipleFiles, validateFileSize, validateFileType } from '@/lib/fileUpload';
import {
  createEmptyStudentEntry,
  mergeStudentRosterEntries,
  parseStudentRosterFile,
  StudentRosterEntry,
} from '@/lib/studentRoster';

const fileDisplayName = (file: File) => file.name.replace(/\.[^.]+$/, '') || file.name;

const materialMetadataFromUpload = (url: string, file: File | undefined) => ({
  url,
  displayName: file ? fileDisplayName(file) : url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Material',
  fileName: file?.name || url.split('/').pop() || 'file',
});

export default function CreateCourse() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
  const [studentRosterFile, setStudentRosterFile] = useState<File | null>(null);
  const [courseMaterialsFiles, setCourseMaterialsFiles] = useState<File[]>([]);
  const [backgroundMaterialsFiles, setBackgroundMaterialsFiles] = useState<File[]>([]);

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
      setInstructorName(`${profileData.first_name} ${profileData.last_name}`);
    } catch (error) {
      console.error('Error loading profile:', error);
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

  const handleSaveCourse = async () => {
    if (!profile) {
      toast.error('Profile not loaded. Please refresh the page.');
      return;
    }

    if (!courseNumber.trim() || !courseTitle.trim()) {
      toast.error('Please fill in required fields: Course Number and Course Title');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        toast.error('Not authenticated. Please log in again.');
        router.push('/educator/login');
        return;
      }

      const { data: courseData, error: courseError } = await supabase
        .from('courses')
        .insert({
          educator_id: profile.id,
          course_number: courseNumber.trim(),
          title: courseTitle.trim(),
          semester: semester,
          section: section.trim(),
          instructor_name: instructorName.trim(),
          description: '',
        })
        .select()
        .single();

      if (courseError) {
        console.error('Course creation error:', courseError);
        throw courseError;
      }

      let syllabusUrl: string | null = null;
      const courseMaterialsData: Array<{url: string, displayName: string, fileName: string}> = [];
      const backgroundMaterialsData: Array<{url: string, displayName: string, fileName: string}> = [];

      if (syllabusFile) {
        toast.info('Uploading syllabus...');
        syllabusUrl = await uploadCourseFile(courseData.id, 'syllabus', syllabusFile);
      }

      if (courseMaterialsFiles.length > 0) {
        toast.info(`Uploading ${courseMaterialsFiles.length} course materials...`);
        const urls = await uploadMultipleFiles(courseData.id, 'materials', courseMaterialsFiles);
        courseMaterialsData.push(...urls.map((url, index) =>
          materialMetadataFromUpload(url, courseMaterialsFiles[index])
        ));
      }

      if (backgroundMaterialsFiles.length > 0) {
        toast.info(`Uploading ${backgroundMaterialsFiles.length} background materials...`);
        const urls = await uploadMultipleFiles(courseData.id, 'background', backgroundMaterialsFiles);
        backgroundMaterialsData.push(...urls.map((url, index) =>
          materialMetadataFromUpload(url, backgroundMaterialsFiles[index])
        ));
      }

      const { error: updateError } = await supabase
        .from('courses')
        .update({
          syllabus_url: syllabusUrl,
          course_materials_data: courseMaterialsData,
          background_materials_data: backgroundMaterialsData,
        })
        .eq('id', courseData.id);

      if (updateError) throw updateError;

      if (teachingAssistants.length > 0) {
        const taRecords = teachingAssistants.map(email => ({
          course_id: courseData.id,
          email: email,
        }));
        const { error: taInsertError } = await supabase
          .from('course_teaching_assistants')
          .insert(taRecords);

        if (taInsertError) {
          throw taInsertError;
        }
      }

      if (students.length > 0) {
        const studentPayload = students.map(student => ({
          first_name: student.firstName.trim(),
          last_name: student.lastName.trim(),
          email: student.email.trim(),
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

        const { error: syncStudentsError } = await supabase.rpc('sync_course_student_roster', {
          p_course_id: courseData.id,
          p_students: studentPayload,
        });

        if (syncStudentsError) {
          throw syncStudentsError;
        }
      }

      if (textbooks.length > 0) {
        const textbookRecords = textbooks.map(titleIsbn => ({
          course_id: courseData.id,
          title_isbn: titleIsbn,
        }));
        const { error: textbookInsertError } = await supabase
          .from('course_textbooks')
          .insert(textbookRecords);

        if (textbookInsertError) {
          throw textbookInsertError;
        }
      }

      toast.success('Course created successfully!');
      router.push(`/educator/course/${courseData.id}`);
    } catch (error: any) {
      console.error('Error creating course:', error);
      console.error('Supabase error message:', error?.message);
      console.error('Supabase error details:', error?.details);
      console.error('Supabase error hint:', error?.hint);
      toast.error(error?.message || 'Failed to create course. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

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
              <h1 className="text-3xl font-bold text-gray-900">Add My Course</h1>
              <p className="text-gray-600 mt-1">Create and configure a new course</p>
            </div>
          </div>
          <button
            onClick={handleSaveCourse}
            disabled={saving}
            className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : 'Save Course'}
          </button>
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

            {!syllabusFile ? (
              <button
                onClick={() => syllabusInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-gray-400 transition-colors"
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-700 font-medium mb-1">Click to upload syllabus</p>
                <p className="text-gray-500 text-sm">PDF, DOC, DOCX up to 10MB</p>
              </button>
            ) : (
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
                    onClick={() => setSyllabusFile(null)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
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

            {!studentRosterFile ? (
              <button
                onClick={() => studentRosterInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-gray-400 transition-colors mb-4"
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-700 font-medium">Upload student list (Excel/CSV)</p>
              </button>
            ) : (
              <div className="border-2 border-green-300 bg-green-50 rounded-xl p-6 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <File className="w-8 h-8 text-green-600" />
                    <div>
                      <p className="font-medium text-gray-900">{studentRosterFile.name}</p>
                      <p className="text-sm text-gray-600">{(studentRosterFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setStudentRosterFile(null)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-[1fr,1fr,2fr,auto] gap-2 mb-4">
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
                placeholder="Student email"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
              />
              <button
                onClick={addStudent}
                className="bg-brand-yellow hover:bg-brand-yellow-hover p-3 rounded-lg transition-colors"
                aria-label="Add student"
              >
                <Plus className="w-6 h-6 text-black" />
              </button>
            </div>

            {students.length > 0 && (
              <div className="space-y-2">
                {students.map((student, index) => (
                  <div key={student.id || index} className="grid md:grid-cols-[1fr,1fr,2fr,auto] gap-2 bg-gray-50 px-4 py-3 rounded-lg">
                    <input
                      type="text"
                      value={student.firstName}
                      onChange={(e) => updateStudent(index, 'firstName', e.target.value)}
                      placeholder="First name"
                      className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={student.lastName}
                      onChange={(e) => updateStudent(index, 'lastName', e.target.value)}
                      placeholder="Last name"
                      className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                    />
                    <input
                      type="email"
                      value={student.email}
                      onChange={(e) => updateStudent(index, 'email', e.target.value)}
                      placeholder="Email"
                      className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-maroon focus:border-transparent"
                    />
                    <button
                      onClick={() => removeStudent(index)}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                      aria-label={`Remove ${student.email || 'student'}`}
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
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-gray-400 transition-colors mb-4"
            >
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-1">Upload course materials</p>
              <p className="text-gray-500 text-sm">PDFs, documents, presentations, etc.</p>
            </button>

            {courseMaterialsFiles.length > 0 && (
              <div className="space-y-2">
                {courseMaterialsFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
                    <div className="flex items-center gap-3">
                      <File className="w-5 h-5 text-gray-600" />
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
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-gray-400 transition-colors mb-4"
            >
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-700 font-medium mb-1">Upload background materials</p>
              <p className="text-gray-500 text-sm">PDFs, documents, presentations, etc.</p>
            </button>

            {backgroundMaterialsFiles.length > 0 && (
              <div className="space-y-2">
                {backgroundMaterialsFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
                    <div className="flex items-center gap-3">
                      <File className="w-5 h-5 text-gray-600" />
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
      </div>
    </EducatorLayout>
  );
}
