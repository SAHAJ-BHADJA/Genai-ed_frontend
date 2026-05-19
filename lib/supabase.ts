import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Genai-ed_frontend/.env.local and restart the dev server.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'educator' | 'student';
  auth_provider?: string;
  is_access_approved?: boolean;
  access_code_verified_at?: string | null;
  google_linked_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseMaterial = {
  url: string;
  displayName: string;
  fileName: string;
};

export type Course = {
  id: string;
  educator_id: string;
  course_number: string;
  title: string;
  description: string;
  student_count: number;
  semester: string;
  section: string;
  instructor_name: string;
  syllabus_url: string | null;
  course_materials_urls?: string[];
  background_materials_urls?: string[];
  course_materials_data?: CourseMaterial[];
  background_materials_data?: CourseMaterial[];
  created_at: string;
  updated_at: string;
};

export type Lecture = {
  id: string;
  course_id: string | null;
  educator_id: string;
  creator_role: 'educator' | 'student';
  creator_user_id: string;
  title: string;
  description: string;
  video_url: string | null;
  duration: number | null;
  content_style: string[];
  script_prompt: string;
  script_file_url: string | null;
  generated_content: any;
  avatar: 'professional_male' | 'professional_female' | 'casual_male' | 'casual_female' | null;
  video_length: number;
  library_personal: boolean;
  library_usc: boolean;
  status: 'draft' | 'generating' | 'completed';
  created_at: string;
  updated_at: string;
};

export type LectureCourse = {
  id: string;
  lecture_id: string;
  course_id: string;
  created_at: string;
};

export type LectureMaterial = {
  id: string;
  lecture_id: string;
  material_url: string;
  material_name: string;
  material_type: 'main' | 'background';
  source_course_id: string | null;
  created_at: string;
};

export type CourseTeachingAssistant = {
  id: string;
  course_id: string;
  email: string;
  created_at: string;
};

export type CourseStudent = {
  id: string;
  course_id: string;
  email: string;
  created_at: string;
};

export type CourseTextbook = {
  id: string;
  course_id: string;
  title_isbn: string;
  created_at: string;
};
