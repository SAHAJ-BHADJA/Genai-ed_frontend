import { supabase } from './supabase';

export const uploadCourseFile = async (
  courseId: string,
  fileType: 'syllabus' | 'materials' | 'background' | 'students',
  file: File
): Promise<string> => {
  const sanitizedOriginalName = file.name
    .trim()
    .replace(/[^\w.\-() ]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-+|-+$/g, '') || 'uploaded-file';
  const fileName = `${Date.now()}-${sanitizedOriginalName}`;
  const filePath = `${courseId}/${fileType}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('course-files')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload file: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage
    .from('course-files')
    .getPublicUrl(filePath);

  return publicUrl;
};

export const uploadMultipleFiles = async (
  courseId: string,
  fileType: 'materials' | 'background',
  files: FileList | File[]
): Promise<string[]> => {
  const uploadPromises = Array.from(files).map(file =>
    uploadCourseFile(courseId, fileType, file)
  );

  return Promise.all(uploadPromises);
};

export const parseStudentCSV = (csvContent: string): string[] => {
  const lines = csvContent.split('\n').filter(line => line.trim());
  const emails: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (i === 0 && (line.toLowerCase().includes('email') || line.toLowerCase().includes('name'))) {
      continue;
    }

    const columns = line.split(',').map(col => col.trim().replace(/['"]/g, ''));

    for (const col of columns) {
      if (col.includes('@') && col.includes('.')) {
        emails.push(col);
        break;
      }
    }
  }

  return emails;
};

export const validateFileSize = (file: File, maxSizeMB: number = 10): boolean => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxSizeBytes;
};

export const validateFileType = (file: File, allowedTypes: string[]): boolean => {
  return allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      const category = type.split('/')[0];
      return file.type.startsWith(category + '/');
    }
    return file.type === type;
  });
};

export const uploadFile = async (
  file: File,
  storagePath: string,
  bucketName: string
): Promise<{ url: string | null; error: string | null }> => {
  try {
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      return { url: null, error: uploadError.message };
    }

    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    return { url: publicUrl, error: null };
  } catch (error) {
    return { url: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};
