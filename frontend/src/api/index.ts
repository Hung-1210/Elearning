import api from './axios';
import type { AuthPayload, ClassInfo, Exercise, Meeting, Doc, Student, SubmittedFile, ClassAttachFile, DocCategoryRaw } from '../types';

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  login: (loginId: string, password: string) =>
    api.post<{ success: boolean; data: { accessToken: string; user: AuthPayload } }>('/auth/login', { loginId, password }),
  signup: (name: string, loginId: string, password: string) =>
    api.post('/auth/signup', { name, loginId, password }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get<{ success: boolean; data: { user: AuthPayload } }>('/auth/me'),
};

// ── Classes ───────────────────────────────────────────────────
export const classApi = {
  getAll: () => api.get<{ success: boolean; data: ClassInfo[] }>('/classes'),
  getById: (id: number) => api.get<{ success: boolean; data: ClassInfo }>(`/classes/${id}`),
  create: (name: string) => api.post('/classes', { name }),
  updateName: (id: number, name: string) => api.put(`/classes/${id}/name`, { name }),
  toggleInvite: (id: number, isOpen: boolean) => api.put(`/classes/${id}/invite-status`, { isOpen }),
  join: (inviteCode: string) => api.post('/classes/join', { inviteCode }),

  // Students
  getStudents: (id: number) => api.get<{ success: boolean; data: Student[] }>(`/classes/${id}/students`),
  removeStudent: (classId: number, studentId: number) =>
    api.delete(`/classes/${classId}/students/${studentId}`),
  importStudents: (id: number, formData: FormData) =>
    api.post(`/classes/${id}/students/import`, formData, { responseType: 'blob' }),

  // Attach files
  getAttachFiles: (id: number) =>
    api.get<{ success: boolean; data: ClassAttachFile[] }>(`/classes/${id}/attach-files`),
  attachFile: (id: number, docId: number) => api.post(`/classes/${id}/attach-files`, { docId }),
  removeAttachFile: (id: number, docId: number) =>
    api.delete(`/classes/${id}/attach-files`, { data: { docId } }),
};

// ── Exercises ─────────────────────────────────────────────────
export const exerciseApi = {
  getByClass: (classId: number) =>
    api.get<{ success: boolean; data: Exercise[] }>(`/exercises/class/${classId}`),

  create: (data: {
    classId: number;
    name: string;
    description: string;
    startTime: string;
    endTime: string;
    attachFileIds: number[];
  }) =>
    api.post('/exercises', {
      ...data,
      attachFileIds: JSON.stringify(data.attachFileIds),
    }),

  update: (id: number, data: {
    name: string;
    description: string;
    startTime: string;
    endTime: string;
    attachFileIds: number[];
  }) =>
    api.put(`/exercises/${id}`, {
      ...data,
      attachFileIds: JSON.stringify(data.attachFileIds),
    }),

  delete: (id: number) => api.delete(`/exercises/${id}`),
  getForLecturer: (id: number) => api.get<{ success: boolean; data: Exercise }>(`/exercises/${id}`),

  // Submissions (lecturer)
  getSubmissionStatus: (classId: number, exerciseId: number) =>
    api.get<{ success: boolean; data: { login_id: string; student_name: string; submission_status: string }[] }>(`/exercises/class/${classId}/submissions/${exerciseId}`),
  downloadSubmissions: (classId: number, exerciseId: number) =>
    api.get(`/exercises/class/${classId}/submissions/${exerciseId}/download`, { responseType: 'blob' }),

  // Submissions (student)
  submit: (exerciseId: number, files: FileList | File[]) => {
    const formData = new FormData();
    formData.append('exerciseId', String(exerciseId));
    Array.from(files).forEach((f) => formData.append('files', f));
    return api.post(`/exercises/${exerciseId}/submit`, formData);
  },
  unsubmit: (exerciseId: number) => api.delete(`/exercises/${exerciseId}/submit`, { data: { exerciseId } }),
  getSubmittedFiles: (exerciseId: number) =>
    api.get<{ success: boolean; data: SubmittedFile[] }>(`/exercises/${exerciseId}/submit`),
  deleteSubmittedFile: (exerciseId: number, fileId: number, fileName: string) =>
    api.delete(`/exercises/${exerciseId}/submit/file`, { data: { fileId, exerciseId, fileName } }),
};

// ── Documents ─────────────────────────────────────────────────
export const documentApi = {
  getAll: () => api.get<{ success: boolean; data: DocCategoryRaw[] }>('/documents'),
  createCategory: (name: string) => api.post('/documents/categories', { name }),
  updateCategory: (id: number, name: string) => api.put(`/documents/categories/${id}`, { name }),
  deleteCategory: (id: number) => api.delete(`/documents/categories/${id}`),
  getDocsByCategory: (id: number) => api.get<{ success: boolean; data: Doc[] }>(`/documents/categories/${id}/docs`),
  upload: (docCategoryId: number, files: FileList | File[]) => {
    const formData = new FormData();
    formData.append('docCategoryId', String(docCategoryId));
    Array.from(files).forEach((f) => formData.append('files', f));
    return api.post('/documents/upload', formData);
  },
  deleteDoc: (id: number, fileName: string) =>
    api.delete(`/documents/${id}`, { data: { fileName } }),
};

// ── Meetings ──────────────────────────────────────────────────
export const meetingApi = {
  getByClass: (classId: number) =>
    api.get<{ success: boolean; data: Meeting[] }>(`/meetings/class/${classId}`),
  getById: (id: number) => api.get<{ success: boolean; data: Meeting }>(`/meetings/${id}`),
  getByCode: (code: string) => api.get<{ success: boolean; data: Meeting }>(`/meetings/code/${code}`),
  create: (data: {
    classId: number;
    name: string;
    description: string;
    startTime: string;
    endTime: string;
  }) => api.post('/meetings', data),
  update: (id: number, data: {
    name: string;
    description: string;
    startTime: string;
    endTime: string;
  }) => api.put(`/meetings/${id}`, data),
  delete: (id: number) => api.delete(`/meetings/${id}`),
};
