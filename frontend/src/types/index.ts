// Shared TypeScript types for frontend
// Mirroring backend types

export interface AuthPayload {
  userId: number;
  name: string;
  isLecturer: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthPayload;
}

export interface ClassInfo {
  id: number;
  name: string;
  lecturer_id: number;
  lecturer_name?: string;
  invite_code_students: string;
  is_open_students: boolean;
  member_count?: number;
}

export interface DocCategory {
  id: number;
  name: string;
  lecturer_id: number;
}

export interface Doc {
  id: number;
  file_name: string;
  doc_category_id: number;
  category_name?: string;
}

export interface DocCategoryWithDocs extends DocCategory {
  docs: Doc[];
}

export interface Exercise {
  id: number;
  class_id: number;
  start_time: string;
  end_time: string;
  name: string;
  description: string | null;
  submission_count?: number;
  submission_status?: 'not_submitted' | 'in_progress' | 'submitted';
  attachFiles?: { exercise_id: number; doc_id: number; file_name: string }[];
}

export interface Meeting {
  id: number;
  class_id: number;
  start_time: string;
  end_time: string;
  name: string;
  description: string | null;
  meeting_code: string;
  status: 'not-started' | 'started' | 'ended';
}

export interface Student {
  id: number;
  name: string;
  login_id: string;
  submission_status?: string;
}

export interface SubmittedFile {
  id: number;
  submitted_exercises_id: number;
  file_name: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface ClassAttachFile {
  class_id: number;
  doc_id: number;
  file_name: string;
  category_name: string;
}

export interface DocCategoryRaw {
  doc_category_id: number;
  category_name: string;
  doc_id: number | null;
  file_name: string | null;
}

export type UserRole = 'lecturer' | 'student';
