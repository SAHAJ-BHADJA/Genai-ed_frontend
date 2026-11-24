import { supabase } from './supabase';

export type StudentCourseEnrollment = {
  id: string;
  course_id: string;
  student_id: string | null;
  email: string;
  enrollment_type?: 'student' | 'educator_test';
};

const ENROLLMENT_COLUMNS = 'id,course_id,student_id,email,enrollment_type';

export async function listStudentCourseEnrollments(
  userId: string,
  email?: string | null,
): Promise<StudentCourseEnrollment[]> {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const queries = [
    supabase
      .from('course_students')
      .select(ENROLLMENT_COLUMNS)
      .eq('student_id', userId),
  ];

  if (normalizedEmail) {
    queries.push(
      supabase
        .from('course_students')
        .select(ENROLLMENT_COLUMNS)
        .ilike('email', normalizedEmail),
    );
  }

  const results = await Promise.all(queries);
  const enrollments = new Map<string, StudentCourseEnrollment>();

  for (const result of results) {
    if (result.error) throw result.error;
    for (const row of (result.data || []) as StudentCourseEnrollment[]) {
      enrollments.set(row.id, row);
    }
  }

  return Array.from(enrollments.values());
}

export async function getStudentCourseEnrollment(
  userId: string,
  email: string | null | undefined,
  courseId: string,
): Promise<StudentCourseEnrollment | null> {
  const enrollments = await listStudentCourseEnrollments(userId, email);
  return enrollments.find((row) => row.course_id === courseId) || null;
}
