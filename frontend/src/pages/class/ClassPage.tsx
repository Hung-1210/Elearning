import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { classApi, exerciseApi, meetingApi, documentApi, faceProfileApi, aiApi, examApi } from '../../api';
import { useAuthStore } from '../../store/authStore';
import type {
  ClassInfo,
  Exercise,
  Meeting,
  Student,
  ClassAttachFile,
  DocCategoryRaw,
  SubmittedFile,
  ClassFaceProfileSummary,
  DocIngestionStatus,
  Exam,
} from '../../types';
import Sidebar, { MobileMenuButton, type ClassTabKey } from '../../components/layout/Sidebar';
import { useLayoutStore } from '../../store/layoutStore';
import { QuestionBankTab, TeacherExamListTab, StudentExamListTab } from '../exam';
import ClassFaceProfilesTab from './ClassFaceProfilesTab';
import { RagChatDrawer } from './rag/RagChatDrawer';

type Tab = ClassTabKey;

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Tổng quan',
  exercises: 'Bài tập',
  meetings: 'Buổi học',
  students: 'Học viên',
  'face-profiles': 'Khuôn mặt sinh viên',
  documents: 'Tài liệu lớp',
  exams: 'Đề thi',
  'question-bank': 'Ngân hàng câu hỏi',
};

interface CategoryGroup {
  id: number;
  name: string;
  docs: { id: number; file_name: string }[];
}

const BACKEND_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';

export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  const classId = parseInt(id || '0', 10);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { sidebarCollapsed } = useLayoutStore();
  const isLecturer = user?.isLecturer;

  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const tabParam = (searchParams.get('tab') as Tab) || 'overview';
    if (tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, classId]);

  const handleSelectTab = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'overview') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab }, { replace: true });
    }
  };
  const [allClasses, setAllClasses] = useState<ClassInfo[]>([]);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classDocs, setClassDocs] = useState<ClassAttachFile[]>([]);
  const [classExams, setClassExams] = useState<Exam[]>([]);
  const [docsAiStatus, setDocsAiStatus] = useState<DocIngestionStatus[]>([]);
  const [geminiConfigured, setGeminiConfigured] = useState(true);
  const [showRagDrawer, setShowRagDrawer] = useState(false);
  const [openDocMenuId, setOpenDocMenuId] = useState<number | null>(null);
  const [aiToastMsg, setAiToastMsg] = useState<string | null>(null);
  const [faceSummary, setFaceSummary] = useState<ClassFaceProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Class Name Edit Modal
  const [showEditClassName, setShowEditClassName] = useState(false);
  const [editClassNameVal, setEditClassNameVal] = useState('');
  const [savingClassName, setSavingClassName] = useState(false);

  // Exercise Modals
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [exerciseForm, setExerciseForm] = useState({
    name: '',
    description: '',
    startTime: '',
    endTime: '',
    attachFileIds: [] as number[],
  });
  const [savingExercise, setSavingExercise] = useState(false);

  const [editExerciseItem, setEditExerciseItem] = useState<Exercise | null>(null);
  const [editExerciseForm, setEditExerciseForm] = useState({
    name: '',
    description: '',
    startTime: '',
    endTime: '',
    attachFileIds: [] as number[],
  });
  const [savingEditExercise, setSavingEditExercise] = useState(false);

  // Submissions Modal (Lecturer)
  const [viewSubmissionsEx, setViewSubmissionsEx] = useState<Exercise | null>(null);
  const [submissionsList, setSubmissionsList] = useState<{ login_id: string; student_name: string; submission_status: string }[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // Submit Exercise Modal (Student)
  const [studentSubmitEx, setStudentSubmitEx] = useState<Exercise | null>(null);
  const [studentSubmittedFiles, setStudentSubmittedFiles] = useState<SubmittedFile[]>([]);
  const [studentNewFiles, setStudentNewFiles] = useState<FileList | null>(null);
  const [submittingFiles, setSubmittingFiles] = useState(false);
  const [loadingSubmittedFiles, setLoadingSubmittedFiles] = useState(false);

  // Meeting Modals
  const [showAddMeeting, setShowAddMeeting] = useState(false);
  const [meetingForm, setMeetingForm] = useState({
    name: '',
    description: '',
    startTime: '',
    endTime: '',
  });
  const [savingMeeting, setSavingMeeting] = useState(false);

  const [editMeetingItem, setEditMeetingItem] = useState<Meeting | null>(null);
  const [editMeetingForm, setEditMeetingForm] = useState({
    name: '',
    description: '',
    startTime: '',
    endTime: '',
  });
  const [savingEditMeeting, setSavingEditMeeting] = useState(false);

  // Class Documents Manage Modal (Lecturer)
  const [showManageDocs, setShowManageDocs] = useState(false);
  const [allDocCategories, setAllDocCategories] = useState<CategoryGroup[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);

  // Import Students (Lecturer)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importingStudents, setImportingStudents] = useState(false);

  useEffect(() => {
    loadAll();
  }, [classId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [classRes, allClassRes, exRes, meetRes, docRes, examRes] = await Promise.all([
        classApi.getById(classId),
        classApi.getAll(),
        exerciseApi.getByClass(classId),
        meetingApi.getByClass(classId),
        classApi.getAttachFiles(classId),
        examApi.listForClass(classId).catch(() => null),
      ]);
      setClassInfo(classRes.data.data);
      setAllClasses(allClassRes.data.data || []);
      setExercises(exRes.data.data || []);
      setMeetings(meetRes.data.data || []);
      setClassDocs(docRes.data.data || []);
      if (examRes?.data) {
        const rawExams = Array.isArray(examRes.data.data)
          ? examRes.data.data
          : (examRes.data.data as { exams?: Exam[] })?.exams || examRes.data.exams || [];
        setClassExams(rawExams);
      } else {
        setClassExams([]);
      }
      void reloadDocsAiStatus();

      if (isLecturer) {
        const [studentRes, faceRes] = await Promise.all([
          classApi.getStudents(classId),
          faceProfileApi.listForClass(classId).catch(() => null),
        ]);
        setStudents(studentRes.data.data || []);
        if (faceRes?.data?.data?.summary) {
          setFaceSummary(faceRes.data.data.summary);
        }
      }
    } catch (err) {
      console.error(err);
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const reloadExercises = async () => {
    try {
      const res = await exerciseApi.getByClass(classId);
      setExercises(res.data.data || []);
    } catch {}
  };

  const reloadMeetings = async () => {
    try {
      const res = await meetingApi.getByClass(classId);
      setMeetings(res.data.data || []);
    } catch {}
  };

  const reloadClassDocs = async () => {
    try {
      const res = await classApi.getAttachFiles(classId);
      setClassDocs(res.data.data || []);
      void reloadDocsAiStatus();
    } catch {}
  };

  const reloadDocsAiStatus = async () => {
    try {
      const res = await aiApi.getDocsStatus(classId);
      setDocsAiStatus(res.data.data.docs || []);
      setGeminiConfigured(res.data.data.geminiConfigured);
    } catch {}
  };

  useEffect(() => {
    if (activeTab !== 'documents') return;
    void reloadDocsAiStatus();
  }, [activeTab, classId]);

  useEffect(() => {
    if (activeTab !== 'documents') return;
    const hasPending = docsAiStatus.some(
      (d) => d.status === 'pending' || d.status === 'processing',
    );
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      void reloadDocsAiStatus();
    }, 3500);
    return () => window.clearInterval(timer);
  }, [activeTab, docsAiStatus]);

  const reloadStudents = async () => {
    try {
      const res = await classApi.getStudents(classId);
      setStudents(res.data.data || []);
    } catch {}
  };

  // Load lecturer's document library for checkboxes
  const loadDocLibrary = async () => {
    setLoadingCategories(true);
    try {
      const res = await documentApi.getAll();
      const rawData = res.data.data || [];
      const map = new Map<number, CategoryGroup>();
      rawData.forEach((row: DocCategoryRaw) => {
        if (!map.has(row.doc_category_id)) {
          map.set(row.doc_category_id, {
            id: row.doc_category_id,
            name: row.category_name,
            docs: [],
          });
        }
        if (row.doc_id && row.file_name) {
          map.get(row.doc_category_id)!.docs.push({
            id: row.doc_id,
            file_name: row.file_name,
          });
        }
      });
      setAllDocCategories(Array.from(map.values()));
    } catch {} finally {
      setLoadingCategories(false);
    }
  };

  // ── Class Settings Handlers ─────────────────────────────────────
  const handleUpdateClassName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editClassNameVal.trim()) return;
    setSavingClassName(true);
    try {
      await classApi.updateName(classId, editClassNameVal.trim());
      setClassInfo((prev) => (prev ? { ...prev, name: editClassNameVal.trim() } : null));
      setShowEditClassName(false);
    } catch {
      alert('Không thể đổi tên lớp');
    } finally {
      setSavingClassName(false);
    }
  };

  const handleToggleInvite = async () => {
    if (!classInfo) return;
    const newStatus = !classInfo.is_open_students;
    try {
      await classApi.toggleInvite(classId, newStatus);
      setClassInfo({ ...classInfo, is_open_students: newStatus });
    } catch {
      alert('Không thể cập nhật trạng thái mời');
    }
  };

  const copyInviteLink = () => {
    if (classInfo?.invite_code_students) {
      navigator.clipboard.writeText(`${window.location.origin}/join/${classInfo.invite_code_students}`);
      alert('Đã copy link mời vào clipboard!');
    }
  };

  // ── Exercise Handlers ───────────────────────────────────────────
  const openAddExerciseModal = async () => {
    setExerciseForm({
      name: '',
      description: '',
      startTime: '',
      endTime: '',
      attachFileIds: [],
    });
    setShowAddExercise(true);
    await loadDocLibrary();
  };

  const handleCreateExercise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (new Date(exerciseForm.startTime) > new Date(exerciseForm.endTime)) {
      alert('Thời gian kết thúc phải sau thời gian bắt đầu!');
      return;
    }
    setSavingExercise(true);
    try {
      await exerciseApi.create({
        classId,
        ...exerciseForm,
      });
      setShowAddExercise(false);
      await reloadExercises();
    } catch {
      alert('Không thể tạo bài tập');
    } finally {
      setSavingExercise(false);
    }
  };

  const openEditExerciseModal = async (ex: Exercise) => {
    setEditExerciseItem(ex);
    const existingFileIds = ex.attachFiles?.map((f) => f.doc_id) || [];
    setEditExerciseForm({
      name: ex.name,
      description: ex.description || '',
      startTime: ex.start_time.slice(0, 16),
      endTime: ex.end_time.slice(0, 16),
      attachFileIds: existingFileIds,
    });
    await loadDocLibrary();
  };

  const handleUpdateExercise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editExerciseItem) return;
    if (new Date(editExerciseForm.startTime) > new Date(editExerciseForm.endTime)) {
      alert('Thời gian kết thúc phải sau thời gian bắt đầu!');
      return;
    }
    setSavingEditExercise(true);
    try {
      await exerciseApi.update(editExerciseItem.id, editExerciseForm);
      setEditExerciseItem(null);
      await reloadExercises();
    } catch {
      alert('Không thể cập nhật bài tập');
    } finally {
      setSavingEditExercise(false);
    }
  };

  const handleDeleteExercise = async (ex: Exercise) => {
    if (!confirm(`Xác nhận xóa bài tập "${ex.name}"?`)) return;
    try {
      await exerciseApi.delete(ex.id);
      await reloadExercises();
    } catch {
      alert('Không thể xóa bài tập');
    }
  };

  const openSubmissionsModal = async (ex: Exercise) => {
    setViewSubmissionsEx(ex);
    setLoadingSubmissions(true);
    try {
      const res = await exerciseApi.getSubmissionStatus(classId, ex.id);
      setSubmissionsList(res.data.data || []);
    } catch {
      alert('Không thể tải danh sách nộp bài');
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const handleDownloadSubmissions = async (exerciseId: number, exerciseName: string) => {
    try {
      const res = await exerciseApi.downloadSubmissions(classId, exerciseId);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bai_nop_${exerciseName}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert('Không thể tải xuống bài nộp');
    }
  };

  // Student Submissions Handlers
  const openStudentSubmitModal = async (ex: Exercise) => {
    setStudentSubmitEx(ex);
    setLoadingSubmittedFiles(true);
    try {
      const res = await exerciseApi.getSubmittedFiles(ex.id);
      setStudentSubmittedFiles(res.data.data || []);
    } catch {
      setStudentSubmittedFiles([]);
    } finally {
      setLoadingSubmittedFiles(false);
    }
  };

  const handleStudentUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentSubmitEx || !studentNewFiles || studentNewFiles.length === 0) {
      alert('Vui lòng chọn tệp để nộp');
      return;
    }
    setSubmittingFiles(true);
    try {
      await exerciseApi.submit(studentSubmitEx.id, studentNewFiles);
      setStudentNewFiles(null);
      const res = await exerciseApi.getSubmittedFiles(studentSubmitEx.id);
      setStudentSubmittedFiles(res.data.data || []);
      await reloadExercises();
      alert('Nộp bài thành công!');
    } catch {
      alert('Nộp bài thất bại');
    } finally {
      setSubmittingFiles(false);
    }
  };

  const handleStudentDeleteFile = async (file: SubmittedFile) => {
    if (!studentSubmitEx) return;
    const isLast = studentSubmittedFiles.length === 1;
    const msg = isLast ? 'Xóa file này đồng nghĩa với việc hủy nộp bài. Tiếp tục?' : 'Xác nhận xóa file này?';
    if (!confirm(msg)) return;
    try {
      await exerciseApi.deleteSubmittedFile(studentSubmitEx.id, file.id, file.file_name);
      const res = await exerciseApi.getSubmittedFiles(studentSubmitEx.id);
      setStudentSubmittedFiles(res.data.data || []);
      await reloadExercises();
      if (isLast) {
        setStudentSubmitEx(null);
      }
    } catch {
      alert('Xóa tệp thất bại');
    }
  };

  const handleStudentUnsubmit = async () => {
    if (!studentSubmitEx) return;
    if (!confirm(`Xác nhận hủy nộp bài tập "${studentSubmitEx.name}"?`)) return;
    try {
      await exerciseApi.unsubmit(studentSubmitEx.id);
      setStudentSubmittedFiles([]);
      setStudentSubmitEx(null);
      await reloadExercises();
      alert('Đã hủy nộp bài');
    } catch {
      alert('Hủy nộp bài thất bại');
    }
  };

  // ── Meeting Handlers ────────────────────────────────────────────
  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (new Date(meetingForm.startTime) > new Date(meetingForm.endTime)) {
      alert('Thời gian kết thúc phải sau thời gian bắt đầu!');
      return;
    }
    setSavingMeeting(true);
    try {
      await meetingApi.create({
        classId,
        ...meetingForm,
      });
      setShowAddMeeting(false);
      setMeetingForm({ name: '', description: '', startTime: '', endTime: '' });
      await reloadMeetings();
    } catch {
      alert('Không thể lên lịch cuộc họp');
    } finally {
      setSavingMeeting(false);
    }
  };

  const openEditMeetingModal = (m: Meeting) => {
    setEditMeetingItem(m);
    setEditMeetingForm({
      name: m.name,
      description: m.description || '',
      startTime: m.start_time.slice(0, 16),
      endTime: m.end_time.slice(0, 16),
    });
  };

  const handleUpdateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMeetingItem) return;
    if (new Date(editMeetingForm.startTime) > new Date(editMeetingForm.endTime)) {
      alert('Thời gian kết thúc phải sau thời gian bắt đầu!');
      return;
    }
    setSavingEditMeeting(true);
    try {
      await meetingApi.update(editMeetingItem.id, editMeetingForm);
      setEditMeetingItem(null);
      await reloadMeetings();
    } catch {
      alert('Không thể cập nhật cuộc họp');
    } finally {
      setSavingEditMeeting(false);
    }
  };

  const handleDeleteMeeting = async (m: Meeting) => {
    if (!confirm(`Xác nhận xóa cuộc họp "${m.name}"?`)) return;
    try {
      await meetingApi.delete(m.id);
      await reloadMeetings();
    } catch {
      alert('Không thể xóa cuộc họp');
    }
  };

  // ── Students Handlers ───────────────────────────────────────────
  const handleImportStudents = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingStudents(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('classId', String(classId));

      const res = await classApi.importStudents(classId, formData);

      // Download returned Excel file with passwords
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Danh_sach_tai_khoan_${classInfo?.name || 'lop'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert('Import học viên thành công! File Excel chứa tài khoản và mật khẩu đã được tải xuống.');
      await reloadStudents();
    } catch {
      alert('Import thất bại. Vui lòng kiểm tra định dạng file Excel (.xlsx)');
    } finally {
      setImportingStudents(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveStudent = async (student: Student) => {
    if (!confirm(`Xác nhận xóa học viên "${student.name}" khỏi lớp?`)) return;
    try {
      await classApi.removeStudent(classId, student.id);
      await reloadStudents();
    } catch {
      alert('Không thể xóa học viên');
    }
  };

  // ── Class Attach Files Handlers ─────────────────────────────────
  const openManageDocsModal = async () => {
    setShowManageDocs(true);
    await loadDocLibrary();
  };

  const handleToggleDocAttachment = async (docId: number, isAttached: boolean) => {
    try {
      if (isAttached) {
        await classApi.removeAttachFile(classId, docId);
      } else {
        await classApi.attachFile(classId, docId);
        setAiToastMsg('Đang chuẩn bị tài liệu cho Trợ giảng AI…');
        window.setTimeout(() => setAiToastMsg(null), 4000);
      }
      await reloadClassDocs();
    } catch {
      alert('Thao tác đính kèm tệp thất bại');
    }
  };

  const handleReindexDoc = async (docId: number) => {
    setOpenDocMenuId(null);
    try {
      await aiApi.reindexDoc(docId);
      setAiToastMsg('Đã đưa tài liệu vào hàng đợi lập chỉ mục lại cho AI…');
      window.setTimeout(() => setAiToastMsg(null), 4000);
      await reloadDocsAiStatus();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Không thể lập chỉ mục lại tài liệu.');
    }
  };

  const handleOpenAiQuestionFromDoc = (docId: number) => {
    setOpenDocMenuId(null);
    setActiveTab('question-bank');
    navigate(`/class/${classId}?tab=question-bank&aiDocs=${docId}`);
  };

  // ── Helpers ─────────────────────────────────────────────────────
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return (
      d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    );
  };

  const getDisplayFileName = (pathName: string) => {
    const raw = pathName.includes('/') ? pathName.split('/')[1] : pathName;
    return raw.includes('-') ? raw.substring(raw.indexOf('-') + 1) : raw;
  };

  const getFileUrl = (pathName: string) => `${BACKEND_URL}/uploads/${pathName}`;

  const attachedDocIdsSet = useMemo(() => {
    return new Set(classDocs.map((d) => d.doc_id));
  }, [classDocs]);

  // Group class docs by category
  const classDocsByCategory = useMemo(() => {
    const map: Record<string, ClassAttachFile[]> = {};
    classDocs.forEach((doc) => {
      const cat = doc.category_name || 'Khác';
      if (!map[cat]) map[cat] = [];
      map[cat].push(doc);
    });
    return map;
  }, [classDocs]);

  // Real progress statistics for Class Overview
  const classProgress = useMemo(() => {
    const memberTotal = Math.max(isLecturer ? students.length : classInfo?.member_count || 1, 1);

    // 1. Exercise progress
    let exercisePct = 0;
    if (exercises.length > 0) {
      if (isLecturer) {
        const avg =
          exercises.reduce(
            (sum, ex) => sum + Math.min(100, ((ex.submission_count || 0) / memberTotal) * 100),
            0,
          ) / exercises.length;
        exercisePct = Math.round(avg);
      } else {
        const submittedCount = exercises.filter((ex) => ex.submission_status === 'submitted').length;
        exercisePct = Math.round((submittedCount / exercises.length) * 100);
      }
    }

    // 2. Meeting progress (started or ended / total)
    let meetingPct = 0;
    if (meetings.length > 0) {
      const doneOrLive = meetings.filter((m) => m.status === 'ended' || m.status === 'started').length;
      meetingPct = Math.round((doneOrLive / meetings.length) * 100);
    }

    // 3. Document AI-ready progress
    let docPct = 0;
    if (classDocs.length > 0) {
      const readyCount = docsAiStatus.filter((d) => d.status === 'ready').length;
      docPct = docsAiStatus.length > 0
        ? Math.min(100, Math.round((readyCount / classDocs.length) * 100))
        : 100;
    }

    const activeMetrics = [
      exercises.length > 0 ? exercisePct : null,
      meetings.length > 0 ? meetingPct : null,
      classDocs.length > 0 ? docPct : null,
    ].filter((v): v is number => v !== null);

    const overallPct =
      activeMetrics.length > 0
        ? Math.round(activeMetrics.reduce((a, b) => a + b, 0) / activeMetrics.length)
        : 0;

    return { exercisePct, meetingPct, docPct, overallPct };
  }, [exercises, meetings, classDocs, docsAiStatus, students.length, classInfo?.member_count, isLecturer]);

  // Real recent activities for Class Overview
  const recentActivities = useMemo(() => {
    const items: {
      id: string;
      title: string;
      timeText: string;
      ts: number;
      tab: Tab;
      bg: string;
      color: string;
      kind: 'exercise' | 'doc' | 'meeting' | 'exam';
    }[] = [];

    exercises.slice(0, 3).forEach((ex) => {
      const ts = new Date(ex.start_time || ex.end_time).getTime() || 0;
      const detail = isLecturer
        ? `Bài tập "${ex.name}" — ${ex.submission_count || 0}/${students.length} học viên đã nộp`
        : `Bài tập "${ex.name}" — ${ex.submission_status === 'submitted' ? 'Đã nộp' : 'Chưa nộp'}`;
      items.push({
        id: `ex-${ex.id}`,
        title: detail,
        timeText: formatDate(ex.end_time),
        ts,
        tab: 'exercises',
        bg: '#EEF2FF',
        color: '#4F46E5',
        kind: 'exercise',
      });
    });

    meetings.slice(0, 2).forEach((m) => {
      const ts = new Date(m.start_time).getTime() || 0;
      const statusLabel =
        m.status === 'started' ? 'Đang diễn ra' : m.status === 'ended' ? 'Đã kết thúc' : 'Sắp diễn ra';
      items.push({
        id: `mt-${m.id}`,
        title: `Buổi học "${m.name}" (${statusLabel})`,
        timeText: formatDate(m.start_time),
        ts,
        tab: 'meetings',
        bg: '#EFF6FF',
        color: '#2563EB',
        kind: 'meeting',
      });
    });

    classDocs.slice(0, 2).forEach((d) => {
      const aiDoc = docsAiStatus.find((s) => s.docId === d.doc_id);
      const statusSuffix =
        aiDoc?.status === 'ready'
          ? 'đã sẵn sàng cho AI'
          : aiDoc?.status === 'processing'
          ? 'đang xử lý chỉ mục AI'
          : 'đã được gắn vào lớp';
      items.push({
        id: `doc-${d.doc_id}`,
        title: `Tài liệu "${getDisplayFileName(d.file_name)}" ${statusSuffix}`,
        timeText: d.category_name || 'Tài liệu lớp',
        ts: Date.now() - 1000 * 60 * 60,
        tab: 'documents',
        bg: '#ECFDF5',
        color: '#059669',
        kind: 'doc',
      });
    });

    classExams.slice(0, 2).forEach((exam) => {
      const ts = new Date(exam.created_at || exam.start_time || '').getTime() || 0;
      items.push({
        id: `exam-${exam.id}`,
        title: `Đề thi "${exam.title}" (${exam.status === 'published' ? 'Đã xuất bản' : 'Bản nháp'})`,
        timeText: exam.start_time ? formatDate(exam.start_time) : 'Đề thi',
        ts,
        tab: 'exams',
        bg: '#FFF7ED',
        color: '#D97706',
        kind: 'exam',
      });
    });

    return items.sort((a, b) => b.ts - a.ts).slice(0, 4);
  }, [exercises, meetings, classDocs, docsAiStatus, classExams, students.length, isLecturer]);

  const classSidebarContext = {
    classId,
    className: classInfo?.name || 'Đang tải...',
    studentCount: isLecturer ? students.length : classInfo?.member_count || 0,
    isOpenStudents: classInfo?.is_open_students,
    activeTab,
    onSelectTab: handleSelectTab,
    pendingFaceCount: faceSummary?.pending || 0,
  };

  if (loading) {
    return (
      <div className="app-layout">
        <Sidebar classes={allClasses} currentClassId={classId} classContext={classSidebarContext} />
        <div className={`main-content page-loading ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar classes={allClasses} currentClassId={classId} classContext={classSidebarContext} />
      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Header */}
        <header className="page-header">
          <div className="page-header-left">
            <MobileMenuButton />
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => navigate('/')} title="Quay lại Dashboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
            <div>
              <div className="page-header-breadcrumb">
                <span className="breadcrumb-link" onClick={() => navigate('/')}>Tổng quan</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
                <span
                  className={activeTab !== 'overview' ? 'breadcrumb-link' : ''}
                  style={{ color: activeTab === 'overview' ? 'var(--color-text-primary)' : undefined, fontWeight: activeTab === 'overview' ? 600 : 500 }}
                  onClick={() => activeTab !== 'overview' && handleSelectTab('overview')}
                >
                  {classInfo?.name}
                </span>
                {activeTab !== 'overview' && (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="9 18 15 12 9 6"/></svg>
                    <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{TAB_LABELS[activeTab]}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <span className="badge badge-neutral">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
              {isLecturer ? students.length : classInfo?.member_count || 0} học viên
            </span>
            {isLecturer && (
              <button id="btn-copy-invite" className="btn btn-secondary btn-sm" onClick={copyInviteLink}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                Copy link mời
              </button>
            )}
          </div>
        </header>

        {/* Tab Content */}
        <main className="page-content">
          {/* ── OVERVIEW TAB ────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Class Hero Banner */}
              <div className="hero-banner" style={{ marginBottom: 0 }}>
                <div className="hero-banner-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 14,
                        background: 'linear-gradient(135deg, #4F46E5, #6366F1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 6px 16px rgba(79,70,229,0.3)',
                        flexShrink: 0,
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="24" height="24">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h1 className="hero-banner-title" style={{ marginBottom: 2 }}>
                        {classInfo?.name}
                      </h1>
                      <p className="hero-banner-subtitle">
                        Giảng viên: {classInfo?.lecturer_name || user?.name} ·{' '}
                        {isLecturer ? students.length : classInfo?.member_count || 0} học viên
                      </p>
                    </div>
                  </div>

                  {isLecturer && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ background: 'var(--color-surface)' }}
                        onClick={() => {
                          setEditClassNameVal(classInfo?.name || '');
                          setShowEditClassName(true);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Đổi tên lớp
                      </button>
                      <button
                        className={`btn btn-sm ${classInfo?.is_open_students ? 'btn-primary' : 'btn-outline'}`}
                        style={!classInfo?.is_open_students ? { background: 'var(--color-surface)' } : undefined}
                        onClick={handleToggleInvite}
                        title="Bật/tắt cho phép sinh viên tham gia bằng link mời"
                      >
                        {classInfo?.is_open_students ? '✓ Đang mở nhận học viên' : '✕ Đang khóa nhận học viên'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="hero-banner-art" aria-hidden="true">
                  <svg width="128" height="84" viewBox="0 0 128 84" fill="none">
                    <rect x="20" y="18" width="76" height="50" rx="10" fill="#4F46E5" fillOpacity="0.16" />
                    <rect x="30" y="12" width="72" height="48" rx="8" fill="#4F46E5" />
                    <rect x="38" y="22" width="32" height="6" rx="3" fill="white" fillOpacity="0.85" />
                    <rect x="38" y="33" width="52" height="4" rx="2" fill="white" fillOpacity="0.45" />
                    <rect x="38" y="42" width="42" height="4" rx="2" fill="white" fillOpacity="0.45" />
                    <circle cx="96" cy="58" r="14" fill="#10B981" />
                    <path d="M90 58L94 62L102 54" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* 4 Quick Stat Cards */}
              <div className="kpi-grid" style={{ marginBottom: 0 }}>
                <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => handleSelectTab('exercises')}>
                  <div className="kpi-icon" style={{ background: '#EEF2FF' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" width="22" height="22">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="kpi-body">
                    <div className="kpi-top">
                      <span className="kpi-value">{exercises.length}</span>
                      <span className="kpi-trend info">{classProgress.exercisePct}%</span>
                    </div>
                    <div className="kpi-label">Bài tập được giao</div>
                  </div>
                </div>

                <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => handleSelectTab('meetings')}>
                  <div className="kpi-icon" style={{ background: '#EFF6FF' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" width="22" height="22">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                  </div>
                  <div className="kpi-body">
                    <div className="kpi-top">
                      <span className="kpi-value">{meetings.length}</span>
                      <span className="kpi-trend info">{classProgress.meetingPct}%</span>
                    </div>
                    <div className="kpi-label">Buổi học trực tuyến</div>
                  </div>
                </div>

                <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => handleSelectTab('documents')}>
                  <div className="kpi-icon" style={{ background: '#ECFDF5' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" width="22" height="22">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div className="kpi-body">
                    <div className="kpi-top">
                      <span className="kpi-value">{classDocs.length}</span>
                      <span className="kpi-trend up">{classProgress.docPct}% AI</span>
                    </div>
                    <div className="kpi-label">Tài liệu lớp học</div>
                  </div>
                </div>

                <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => handleSelectTab('exams')}>
                  <div className="kpi-icon" style={{ background: '#FFF7ED' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" width="22" height="22">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                  </div>
                  <div className="kpi-body">
                    <div className="kpi-top">
                      <span className="kpi-value">{classExams.length}</span>
                      <span className="kpi-trend info">
                        {classExams.filter((e) => e.status === 'published').length} đang mở
                      </span>
                    </div>
                    <div className="kpi-label">Đề thi & Kiểm tra</div>
                  </div>
                </div>
              </div>

              {/* 2-Column Analytics: Tiến độ lớp học + Hoạt động gần đây */}
              <div className="analytics-grid-2" style={{ marginBottom: 0 }}>
                {/* Tiến độ lớp học */}
                <div className="widget-card">
                  <div className="widget-header">
                    <h3 className="widget-title">Tiến độ lớp học</h3>
                    <span className="badge badge-primary">Tổng hợp</span>
                  </div>
                  <div className="donut-wrap" style={{ padding: '8px 0' }}>
                    {(() => {
                      const r = 52;
                      const c = 2 * Math.PI * r;
                      const dash = (classProgress.overallPct / 100) * c;
                      return (
                        <svg width="136" height="136" viewBox="0 0 136 136">
                          <defs>
                            <linearGradient id="classProgressGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#4F46E5" />
                              <stop offset="60%" stopColor="#3B82F6" />
                              <stop offset="100%" stopColor="#10B981" />
                            </linearGradient>
                          </defs>
                          <circle
                            cx="68"
                            cy="68"
                            r={r}
                            fill="none"
                            stroke="var(--color-border-subtle)"
                            strokeWidth="13"
                          />
                          <circle
                            cx="68"
                            cy="68"
                            r={r}
                            fill="none"
                            stroke="url(#classProgressGrad)"
                            strokeWidth="13"
                            strokeDasharray={`${dash} ${c - dash}`}
                            strokeLinecap="round"
                            transform="rotate(-90 68 68)"
                          />
                          <text
                            x="68"
                            y="64"
                            textAnchor="middle"
                            fontSize="24"
                            fontWeight="800"
                            fill="var(--color-text-primary)"
                          >
                            {classProgress.overallPct}%
                          </text>
                          <text
                            x="68"
                            y="82"
                            textAnchor="middle"
                            fontSize="11.5"
                            fill="var(--color-text-muted)"
                          >
                            Hoàn thành
                          </text>
                        </svg>
                      );
                    })()}

                    <div className="donut-legend" style={{ minWidth: 160 }}>
                      <div className="donut-legend-row">
                        <span className="chart-legend-item">
                          <span className="chart-legend-dot" style={{ background: '#4F46E5' }} />
                          Bài tập
                        </span>
                        <strong style={{ color: 'var(--color-text-primary)' }}>{classProgress.exercisePct}%</strong>
                      </div>
                      <div className="donut-legend-row">
                        <span className="chart-legend-item">
                          <span className="chart-legend-dot" style={{ background: '#3B82F6' }} />
                          Buổi học
                        </span>
                        <strong style={{ color: 'var(--color-text-primary)' }}>{classProgress.meetingPct}%</strong>
                      </div>
                      <div className="donut-legend-row">
                        <span className="chart-legend-item">
                          <span className="chart-legend-dot" style={{ background: '#10B981' }} />
                          Tài liệu AI
                        </span>
                        <strong style={{ color: 'var(--color-text-primary)' }}>{classProgress.docPct}%</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Hoạt động gần đây */}
                <div className="widget-card">
                  <div className="widget-header">
                    <h3 className="widget-title">Hoạt động gần đây</h3>
                    <span className="widget-link" onClick={() => handleSelectTab('exercises')}>
                      Xem bài tập →
                    </span>
                  </div>

                  {recentActivities.length === 0 ? (
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-text-muted)',
                        fontSize: 13,
                        padding: '24px 0',
                      }}
                    >
                      Chưa có hoạt động nào trong lớp học này
                    </div>
                  ) : (
                    <div className="activity-list">
                      {recentActivities.map((act) => (
                        <div
                          key={act.id}
                          className="activity-item"
                          onClick={() => handleSelectTab(act.tab)}
                        >
                          <div className="activity-icon" style={{ background: act.bg, color: act.color }}>
                            {act.kind === 'exercise' && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                            )}
                            {act.kind === 'meeting' && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <polygon points="23 7 16 12 23 17 23 7" />
                                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                              </svg>
                            )}
                            {act.kind === 'doc' && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                            )}
                            {act.kind === 'exam' && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <path d="M9 11l3 3L22 4" />
                                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                              </svg>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              className="truncate"
                              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}
                            >
                              {act.title}
                            </div>
                          </div>
                          <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                            {act.timeText}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* AI Hỗ trợ giảng dạy / Trợ giảng AI Banner */}
              <div className="ai-promo-banner">
                <div className="ai-promo-left">
                  <div className="ai-promo-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="22" height="22">
                      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                      <path d="M6 12v5c3 3 9 3 12 0v-5" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
                      {isLecturer ? 'AI Hỗ trợ giảng dạy' : 'Trợ giảng AI (RAG)'}
                    </div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)' }}>
                      {isLecturer
                        ? 'Tạo câu hỏi trắc nghiệm từ tài liệu bằng AI, hỏi đáp giáo trình có trích dẫn và giám sát thi thông minh.'
                        : 'Hỏi đáp trực tiếp nội dung bài giảng, giáo trình của lớp học kèm trích dẫn nguồn chính xác.'}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {isLecturer && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: 'rgba(255,255,255,0.16)',
                        color: '#ffffff',
                        border: '1px solid rgba(255,255,255,0.3)',
                      }}
                      onClick={() => handleSelectTab('question-bank')}
                    >
                      Tạo câu hỏi AI
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ background: '#ffffff', color: '#4F46E5', fontWeight: 700 }}
                    onClick={() => setShowRagDrawer(true)}
                  >
                    Khám phá ngay →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── EXERCISES TAB ───────────────────────────────────────── */}
          {activeTab === 'exercises' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>Danh sách bài tập ({exercises.length})</h2>
                {isLecturer && (
                  <button id="btn-add-exercise" className="btn btn-primary" onClick={openAddExerciseModal}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Giao bài tập
                  </button>
                )}
              </div>

              {exercises.length === 0 ? (
                <div className="empty-state card">
                  <div className="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div className="empty-state-title">Chưa có bài tập nào</div>
                  <div className="empty-state-desc">
                    {isLecturer ? 'Nhấn "Giao bài tập" để tạo bài tập mới cho học viên' : 'Giảng viên chưa giao bài tập nào'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {exercises.map((ex) => (
                    <div key={ex.id} id={`exercise-${ex.id}`} className="card" style={{ padding: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{ex.name}</h3>
                            {!isLecturer && (
                              <span className={`badge ${ex.submission_status === 'submitted' ? 'badge-success' : 'badge-neutral'}`}>
                                {ex.submission_status === 'submitted' ? '✓ Đã nộp bài' : 'Chưa nộp bài'}
                              </span>
                            )}
                          </div>

                          {ex.description && (
                            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 10, whiteSpace: 'pre-line' }}>
                              {ex.description}
                            </p>
                          )}

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                              </svg>
                              <span>{formatDate(ex.start_time)} → {formatDate(ex.end_time)}</span>
                            </div>
                            {isLecturer && ex.submission_count !== undefined && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                                </svg>
                                <span>{ex.submission_count}/{students.length} học viên đã nộp</span>
                              </div>
                            )}
                          </div>

                          {/* Attached files */}
                          {ex.attachFiles && ex.attachFiles.length > 0 && (
                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border-subtle)' }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                                TỆP ĐÍNH KÈM ({ex.attachFiles.length}):
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {ex.attachFiles.map((file) => (
                                  <a
                                    key={file.doc_id}
                                    href={getFileUrl(file.file_name)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="badge badge-neutral"
                                    style={{ textDecoration: 'none', padding: '5px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" width="12" height="12">
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    </svg>
                                    {getDisplayFileName(file.file_name)}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {isLecturer ? (
                            <>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => openSubmissionsModal(ex)}
                                title="Xem tình trạng nộp bài"
                              >
                                Xem nộp bài ({ex.submission_count || 0})
                              </button>
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => openEditExerciseModal(ex)}
                                title="Sửa bài tập"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                style={{ color: 'var(--color-danger)' }}
                                onClick={() => handleDeleteExercise(ex)}
                                title="Xóa bài tập"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                  <polyline points="3 6 5 6 21 6"/>
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                </svg>
                              </button>
                            </>
                          ) : (
                            <button
                              className={`btn btn-sm ${ex.submission_status === 'submitted' ? 'btn-secondary' : 'btn-primary'}`}
                              onClick={() => openStudentSubmitModal(ex)}
                            >
                              {ex.submission_status === 'submitted' ? 'Sửa bài đã nộp' : 'Nộp bài tập'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── MEETINGS TAB ────────────────────────────────────────── */}
          {activeTab === 'meetings' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>Các buổi học trực tuyến ({meetings.length})</h2>
                {isLecturer && (
                  <button id="btn-add-meeting" className="btn btn-primary" onClick={() => setShowAddMeeting(true)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Lên lịch buổi học
                  </button>
                )}
              </div>

              {meetings.length === 0 ? (
                <div className="empty-state card">
                  <div className="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="23 7 16 12 23 17 23 7"/>
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                    </svg>
                  </div>
                  <div className="empty-state-title">Chưa có buổi học nào</div>
                  <div className="empty-state-desc">
                    {isLecturer ? 'Nhấn "Lên lịch buổi học" để tạo phòng học WebRTC' : 'Chưa có buổi học trực tuyến nào được lên lịch'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {meetings.map((m) => {
                    const d = new Date(m.start_time);
                    const now = new Date();
                    const isEnded = m.status === 'ended' || now > new Date(m.end_time);
                    const isStarted = !isEnded && now >= new Date(m.start_time);
                    return (
                      <div
                        key={m.id}
                        id={`meeting-${m.id}`}
                        className="meeting-card"
                        style={{ opacity: isEnded ? 0.78 : 1 }}
                      >
                        <div className="meeting-card-time">
                          <div className="date">{d.getDate()}</div>
                          <div className="month">Tháng {d.getMonth() + 1}</div>
                        </div>
                        <div className="meeting-card-info">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <div className="meeting-card-name">{m.name}</div>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 9999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: isEnded
                                  ? '#F1F5F9'
                                  : isStarted
                                    ? '#DCFCE7'
                                    : '#EEF2FF',
                                color: isEnded
                                  ? '#64748B'
                                  : isStarted
                                    ? '#15803D'
                                    : '#4F46E5',
                              }}
                            >
                              {isEnded
                                ? 'Đã kết thúc'
                                : isStarted
                                  ? '● Đang diễn ra'
                                  : 'Sắp diễn ra'}
                            </span>
                          </div>
                          <div className="meeting-card-time-range">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                            {formatDate(m.start_time)} → {formatDate(m.end_time)}
                          </div>
                          {m.description && <div className="text-sm text-muted mt-1">{m.description}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className={`btn btn-sm ${isEnded ? 'btn-secondary' : 'btn-primary'}`}
                            id={`btn-join-meeting-${m.id}`}
                            disabled={isEnded}
                            title={
                              isEnded
                                ? 'Buổi học đã quá thời gian kết thúc, không thể tham gia'
                                : 'Tham gia phòng học trực tuyến'
                            }
                            style={{
                              cursor: isEnded ? 'not-allowed' : 'pointer',
                              opacity: isEnded ? 0.65 : 1,
                            }}
                            onClick={() => {
                              if (new Date() > new Date(m.end_time) || m.status === 'ended') {
                                alert('Buổi học này đã quá thời gian kết thúc, không thể tham gia.');
                                void reloadMeetings();
                                return;
                              }
                              navigate(`/class/${classId}/meet/${m.meeting_code}`);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                              <polygon points="23 7 16 12 23 17 23 7"/>
                              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                            </svg>
                            {isEnded ? 'Đã kết thúc' : 'Vào phòng học'}
                          </button>
                          {isLecturer && (
                            <>
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => openEditMeetingModal(m)}
                                title="Sửa buổi học"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                style={{ color: 'var(--color-danger)' }}
                                onClick={() => handleDeleteMeeting(m)}
                                title="Xóa buổi học"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                  <polyline points="3 6 5 6 21 6"/>
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── STUDENTS TAB (Lecturer Only) ────────────────────────── */}
          {activeTab === 'students' && isLecturer && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>Danh sách học viên ({students.length})</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    style={{ display: 'none' }}
                    onChange={handleImportStudents}
                  />
                  <button
                    id="btn-import-students"
                    className="btn btn-primary"
                    disabled={importingStudents}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {importingStudents ? 'Đang nhập...' : 'Import danh sách Excel (.xlsx)'}
                  </button>
                </div>
              </div>

              {students.length === 0 ? (
                <div className="empty-state card">
                  <div className="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    </svg>
                  </div>
                  <div className="empty-state-title">Chưa có học viên nào</div>
                  <div className="empty-state-desc">
                    Tải lên file Excel (.xlsx) với Cột 1 là Mã SV, Cột 2 là Họ tên để tự tạo tài khoản cho học viên
                  </div>
                </div>
              ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-subtle, #f8fafc)', borderBottom: '1px solid var(--color-border)' }}>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>STT</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>Mã SV / Định danh</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>Họ và tên</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((st, idx) => (
                        <tr key={st.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                          <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{st.login_id}</td>
                          <td style={{ padding: '12px 16px', fontSize: 14 }}>{st.name}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              style={{ color: 'var(--color-danger)' }}
                              title="Xóa học viên khỏi lớp"
                              onClick={() => handleRemoveStudent(st)}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── DOCUMENTS TAB ───────────────────────────────────────── */}
          {activeTab === 'documents' && (
            <div>
              {aiToastMsg && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: '#EEF2FF',
                    border: '1px solid #C7D2FE',
                    color: '#4338CA',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  ✨ {aiToastMsg}
                </div>
              )}

              <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                    Tài liệu lớp học ({classDocs.length})
                  </h2>
                  <button
                    type="button"
                    disabled={classDocs.length === 0}
                    onClick={() => setShowRagDrawer(true)}
                    title={
                      classDocs.length === 0
                        ? 'Lớp học chưa có tài liệu để hỏi đáp AI'
                        : 'Mở Trợ giảng AI hỏi đáp tài liệu lớp học'
                    }
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background:
                        classDocs.length === 0
                          ? '#CBD5E1'
                          : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                      color: '#FFFFFF',
                      fontSize: 13,
                      fontWeight: 700,
                      boxShadow:
                        classDocs.length === 0
                          ? 'none'
                          : '0 4px 12px rgba(79, 70, 229, 0.25)',
                      cursor: classDocs.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    💬 Hỏi đáp tài liệu (AI)
                  </button>
                </div>

                {isLecturer && (
                  <button id="btn-manage-class-docs" className="btn btn-primary" onClick={openManageDocsModal}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Quản lý tài liệu lớp
                  </button>
                )}
              </div>

              {classDocs.length === 0 ? (
                <div className="empty-state card">
                  <div className="empty-state-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                  <div className="empty-state-title">Chưa có tài liệu nào trong lớp</div>
                  <div className="empty-state-desc">
                    {isLecturer ? 'Nhấn "Quản lý tài liệu lớp" để chọn tài liệu đính kèm từ kho tài liệu của bạn' : 'Giảng viên chưa chia sẻ tài liệu cho lớp'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {Object.entries(classDocsByCategory).map(([catName, docs]) => (
                    <div key={catName} className="card" style={{ padding: 18 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" width="16" height="16">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        {catName}
                        <span className="badge badge-neutral" style={{ fontSize: 11 }}>{docs.length} tệp</span>
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
                        {docs.map((doc) => {
                          const name = getDisplayFileName(doc.file_name);
                          const st = docsAiStatus.find((s) => s.docId === doc.doc_id);
                          const status = st?.status || 'pending';
                          return (
                            <div
                              key={doc.doc_id}
                              style={{
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                padding: '10px 12px',
                                background: 'var(--color-bg)',
                                borderRadius: 10,
                                border: '1px solid var(--color-border)',
                              }}
                            >
                              <a
                                href={getFileUrl(doc.file_name)}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  color: 'var(--color-text-primary)',
                                  textDecoration: 'none',
                                  fontSize: 13,
                                  fontWeight: 600,
                                  flex: 1,
                                  minWidth: 0,
                                }}
                                title={name}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0 }}>
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                  <polyline points="14 2 14 8 20 8"/>
                                </svg>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {name}
                                </span>
                              </a>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span
                                  title={st?.errorMessage || undefined}
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: 9999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background:
                                      status === 'ready'
                                        ? '#DCFCE7'
                                        : status === 'failed'
                                          ? '#FEE2E2'
                                          : status === 'unsupported'
                                            ? '#F1F5F9'
                                            : '#FEF3C7',
                                    color:
                                      status === 'ready'
                                        ? '#15803D'
                                        : status === 'failed'
                                          ? '#B91C1C'
                                          : status === 'unsupported'
                                            ? '#64748B'
                                            : '#B45309',
                                  }}
                                >
                                  {status === 'ready'
                                    ? '✅ Sẵn sàng'
                                    : status === 'failed'
                                      ? st?.errorCode === 'scanned_pdf'
                                        ? '⚠️ PDF scan'
                                        : st?.errorCode === 'missing_api_key'
                                          ? '⏳ Chờ API Key'
                                          : '⚠️ Lỗi'
                                      : status === 'unsupported'
                                        ? '⚪ Không hỗ trợ'
                                        : '⏳ Đang xử lý'}
                                </span>

                                {isLecturer && (
                                  <div style={{ position: 'relative' }}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenDocMenuId((prev) =>
                                          prev === doc.doc_id ? null : doc.doc_id,
                                        )
                                      }
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        padding: '2px 6px',
                                        borderRadius: 6,
                                        fontSize: 15,
                                        fontWeight: 700,
                                        color: '#64748B',
                                      }}
                                      title="Tác vụ AI"
                                    >
                                      ⋮
                                    </button>

                                    {openDocMenuId === doc.doc_id && (
                                      <div
                                        style={{
                                          position: 'absolute',
                                          top: 'calc(100% + 4px)',
                                          right: 0,
                                          width: 230,
                                          background: '#FFFFFF',
                                          border: '1px solid #E2E8F0',
                                          borderRadius: 10,
                                          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.14)',
                                          padding: 6,
                                          zIndex: 80,
                                        }}
                                      >
                                        {status === 'ready' && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenAiQuestionFromDoc(doc.doc_id)}
                                            style={{
                                              width: '100%',
                                              textAlign: 'left',
                                              padding: '8px 10px',
                                              border: 'none',
                                              background: 'transparent',
                                              borderRadius: 6,
                                              fontSize: 12.5,
                                              fontWeight: 600,
                                              color: '#4F46E5',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            ✨ Tạo câu hỏi từ tài liệu này
                                          </button>
                                        )}
                                        {status !== 'unsupported' && (
                                          <button
                                            type="button"
                                            onClick={() => void handleReindexDoc(doc.doc_id)}
                                            style={{
                                              width: '100%',
                                              textAlign: 'left',
                                              padding: '8px 10px',
                                              border: 'none',
                                              background: 'transparent',
                                              borderRadius: 6,
                                              fontSize: 12.5,
                                              fontWeight: 500,
                                              color: '#334155',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            🔄 Lập chỉ mục lại
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <RagChatDrawer
                open={showRagDrawer}
                onClose={() => setShowRagDrawer(false)}
                classId={classId}
                className={classInfo?.name || `Lớp #${classId}`}
                docsStatus={docsAiStatus}
                geminiConfigured={geminiConfigured}
              />
            </div>
          )}

          {/* ── EXAMS TAB ───────────────────────────────────────────── */}
          {activeTab === 'exams' && (
            <div>
              {isLecturer ? (
                <TeacherExamListTab classId={String(classId)} />
              ) : (
                <StudentExamListTab classId={String(classId)} />
              )}
            </div>
          )}

          {/* ── QUESTION BANK TAB ───────────────────────────────────── */}
          {activeTab === 'question-bank' && isLecturer && (
            <div>
              <QuestionBankTab classId={String(classId)} />
            </div>
          )}

          {/* ── FACE PROFILES TAB (LECTURER) ───────────────────────── */}
          {activeTab === 'face-profiles' && isLecturer && (
            <div>
              <ClassFaceProfilesTab
                classId={classId}
                onSummaryChange={(sum) => setFaceSummary(sum)}
              />
            </div>
          )}
        </main>
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────── */}

      {/* Edit Class Name Modal */}
      {showEditClassName && (
        <div className="modal-overlay" onClick={() => setShowEditClassName(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Đổi tên lớp học</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowEditClassName(false)}>✕</button>
            </div>
            <form onSubmit={handleUpdateClassName}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-class-name">Tên lớp học mới</label>
                  <input
                    id="edit-class-name"
                    type="text"
                    className="form-input"
                    value={editClassNameVal}
                    onChange={(e) => setEditClassNameVal(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowEditClassName(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={savingClassName}>
                  {savingClassName ? 'Đang lưu...' : 'Cập nhật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Exercise Modal */}
      {showAddExercise && (
        <div className="modal-overlay" onClick={() => setShowAddExercise(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Giao bài tập mới</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAddExercise(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateExercise}>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="add-ex-name">Tên bài tập</label>
                  <input
                    id="add-ex-name"
                    type="text"
                    className="form-input"
                    placeholder="VD: Bài tập lớn số 1, Bài tập tuần 3..."
                    value={exerciseForm.name}
                    onChange={(e) => setExerciseForm({ ...exerciseForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="add-ex-desc">Mô tả / Hướng dẫn làm bài</label>
                  <textarea
                    id="add-ex-desc"
                    className="form-input"
                    rows={3}
                    placeholder="Ghi chú các yêu cầu, quy định nộp bài..."
                    value={exerciseForm.description}
                    onChange={(e) => setExerciseForm({ ...exerciseForm, description: e.target.value })}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-ex-start">Bắt đầu vào</label>
                    <input
                      id="add-ex-start"
                      type="datetime-local"
                      className="form-input"
                      value={exerciseForm.startTime}
                      onChange={(e) => setExerciseForm({ ...exerciseForm, startTime: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-ex-end">Kết thúc (hạn nộp)</label>
                    <input
                      id="add-ex-end"
                      type="datetime-local"
                      className="form-input"
                      value={exerciseForm.endTime}
                      onChange={(e) => setExerciseForm({ ...exerciseForm, endTime: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Attach documents checklist */}
                <div className="form-group">
                  <label className="form-label">Đính kèm tài liệu từ kho của bạn</label>
                  {loadingCategories ? (
                    <div className="spinner" style={{ width: 20, height: 20 }} />
                  ) : allDocCategories.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Chưa có tài liệu nào trong kho.</div>
                  ) : (
                    <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
                      {allDocCategories.map((cat) => (
                        <div key={cat.id} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                            📁 {cat.name}
                          </div>
                          {cat.docs.map((doc) => {
                            const isChecked = exerciseForm.attachFileIds.includes(doc.id);
                            return (
                              <label
                                key={doc.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontSize: 13,
                                  padding: '4px 8px',
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...exerciseForm.attachFileIds, doc.id]
                                      : exerciseForm.attachFileIds.filter((x) => x !== doc.id);
                                    setExerciseForm({ ...exerciseForm, attachFileIds: next });
                                  }}
                                />
                                {getDisplayFileName(doc.file_name)}
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddExercise(false)}>Hủy</button>
                <button id="btn-submit-create-exercise" type="submit" className="btn btn-primary" disabled={savingExercise}>
                  {savingExercise ? 'Đang tạo...' : 'Giao bài tập'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Exercise Modal */}
      {editExerciseItem && (
        <div className="modal-overlay" onClick={() => setEditExerciseItem(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Sửa bài tập: {editExerciseItem.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setEditExerciseItem(null)}>✕</button>
            </div>
            <form onSubmit={handleUpdateExercise}>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                <div className="form-group">
                  <label className="form-label">Tên bài tập</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editExerciseForm.name}
                    onChange={(e) => setEditExerciseForm({ ...editExerciseForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mô tả</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={editExerciseForm.description}
                    onChange={(e) => setEditExerciseForm({ ...editExerciseForm, description: e.target.value })}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">Bắt đầu vào</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={editExerciseForm.startTime}
                      onChange={(e) => setEditExerciseForm({ ...editExerciseForm, startTime: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Kết thúc vào</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={editExerciseForm.endTime}
                      onChange={(e) => setEditExerciseForm({ ...editExerciseForm, endTime: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Attach documents checklist */}
                <div className="form-group">
                  <label className="form-label">Đính kèm tài liệu từ kho</label>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
                    {allDocCategories.map((cat) => (
                      <div key={cat.id} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                          📁 {cat.name}
                        </div>
                        {cat.docs.map((doc) => {
                          const isChecked = editExerciseForm.attachFileIds.includes(doc.id);
                          return (
                            <label
                              key={doc.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 13,
                                padding: '4px 8px',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...editExerciseForm.attachFileIds, doc.id]
                                    : editExerciseForm.attachFileIds.filter((x) => x !== doc.id);
                                  setEditExerciseForm({ ...editExerciseForm, attachFileIds: next });
                                }}
                              />
                              {getDisplayFileName(doc.file_name)}
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setEditExerciseItem(null)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={savingEditExercise}>
                  {savingEditExercise ? 'Đang lưu...' : 'Cập nhật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Submissions Modal (Lecturer) */}
      {viewSubmissionsEx && (
        <div className="modal-overlay" onClick={() => setViewSubmissionsEx(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tình trạng nộp bài: {viewSubmissionsEx.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setViewSubmissionsEx(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {loadingSubmissions ? (
                <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" /></div>
              ) : submissionsList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-text-muted)' }}>Chưa có học viên nào trong lớp.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12 }}>STT</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12 }}>Mã SV</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12 }}>Họ và tên</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12 }}>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissionsList.map((s, idx) => {
                      const isSub = s.submission_status === 'submitted' || s.submission_status === 'submitted-late';
                      return (
                        <tr key={s.login_id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                          <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                          <td style={{ padding: '8px 12px', fontSize: 13, fontFamily: 'monospace' }}>{s.login_id}</td>
                          <td style={{ padding: '8px 12px', fontSize: 13 }}>{s.student_name}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <span className={`badge ${isSub ? 'badge-success' : 'badge-neutral'}`}>
                              {s.submission_status === 'submitted' ? 'Đã nộp' : s.submission_status === 'submitted-late' ? 'Nộp muộn' : 'Chưa nộp'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button
                className="btn btn-secondary"
                onClick={() => handleDownloadSubmissions(viewSubmissionsEx.id, viewSubmissionsEx.name)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Tải xuống toàn bộ bài đã nộp (.zip)
              </button>
              <button className="btn btn-outline" onClick={() => setViewSubmissionsEx(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Student Submit / Manage Files Modal */}
      {studentSubmitEx && (
        <div className="modal-overlay" onClick={() => setStudentSubmitEx(null)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Nộp bài: {studentSubmitEx.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setStudentSubmitEx(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* List of currently submitted files */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--color-text-primary)' }}>
                  DANH SÁCH TỆP ĐÃ NỘP ({studentSubmittedFiles.length})
                </div>
                {loadingSubmittedFiles ? (
                  <div className="spinner" style={{ width: 20, height: 20 }} />
                ) : studentSubmittedFiles.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>
                    Bạn chưa nộp tệp nào cho bài tập này.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {studentSubmittedFiles.map((file) => (
                      <div
                        key={file.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: 'var(--color-bg)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 6,
                        }}
                      >
                        <a
                          href={getFileUrl(file.file_name)}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 13, color: 'var(--color-text-primary)', textDecoration: 'none', fontWeight: 500 }}
                        >
                          📄 {getDisplayFileName(file.file_name)}
                        </a>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          style={{ color: 'var(--color-danger)' }}
                          title="Xóa tệp này"
                          onClick={() => handleStudentDeleteFile(file)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upload new files form */}
              <form onSubmit={handleStudentUpload}>
                <div className="form-group">
                  <label className="form-label">Tải lên tệp bài làm</label>
                  <input
                    type="file"
                    className="form-input"
                    multiple
                    onChange={(e) => setStudentNewFiles(e.target.files)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="submit" className="btn btn-primary" disabled={submittingFiles}>
                    {submittingFiles ? 'Đang nộp...' : 'Nộp thêm tệp'}
                  </button>
                  {studentSubmittedFiles.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                      onClick={handleStudentUnsubmit}
                    >
                      Hủy nộp toàn bộ bài
                    </button>
                  )}
                </div>
              </form>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setStudentSubmitEx(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Meeting Modal */}
      {showAddMeeting && (
        <div className="modal-overlay" onClick={() => setShowAddMeeting(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Lên lịch buổi học trực tuyến</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAddMeeting(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateMeeting}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="meet-name">Tên cuộc họp / buổi học</label>
                  <input
                    id="meet-name"
                    type="text"
                    className="form-input"
                    placeholder="VD: Buổi 1 - Giới thiệu kiến trúc Web..."
                    value={meetingForm.name}
                    onChange={(e) => setMeetingForm({ ...meetingForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="meet-desc">Mô tả nội dung</label>
                  <textarea
                    id="meet-desc"
                    className="form-input"
                    rows={2}
                    placeholder="Nội dung thảo luận..."
                    value={meetingForm.description}
                    onChange={(e) => setMeetingForm({ ...meetingForm, description: e.target.value })}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="meet-start">Dự kiến bắt đầu</label>
                    <input
                      id="meet-start"
                      type="datetime-local"
                      className="form-input"
                      value={meetingForm.startTime}
                      onChange={(e) => setMeetingForm({ ...meetingForm, startTime: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="meet-end">Dự kiến kết thúc</label>
                    <input
                      id="meet-end"
                      type="datetime-local"
                      className="form-input"
                      value={meetingForm.endTime}
                      onChange={(e) => setMeetingForm({ ...meetingForm, endTime: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddMeeting(false)}>Hủy</button>
                <button id="btn-submit-create-meeting" type="submit" className="btn btn-primary" disabled={savingMeeting}>
                  {savingMeeting ? 'Đang tạo...' : 'Lên lịch ngay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Meeting Modal */}
      {editMeetingItem && (
        <div className="modal-overlay" onClick={() => setEditMeetingItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Sửa buổi học</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setEditMeetingItem(null)}>✕</button>
            </div>
            <form onSubmit={handleUpdateMeeting}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tên cuộc họp</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editMeetingForm.name}
                    onChange={(e) => setEditMeetingForm({ ...editMeetingForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mô tả</label>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={editMeetingForm.description}
                    onChange={(e) => setEditMeetingForm({ ...editMeetingForm, description: e.target.value })}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">Bắt đầu</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={editMeetingForm.startTime}
                      onChange={(e) => setEditMeetingForm({ ...editMeetingForm, startTime: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Kết thúc</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={editMeetingForm.endTime}
                      onChange={(e) => setEditMeetingForm({ ...editMeetingForm, endTime: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setEditMeetingItem(null)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={savingEditMeeting}>
                  {savingEditMeeting ? 'Đang lưu...' : 'Cập nhật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Class Documents Modal (Lecturer) */}
      {showManageDocs && (
        <div className="modal-overlay" onClick={() => setShowManageDocs(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Đính kèm tài liệu vào lớp: {classInfo?.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowManageDocs(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                Chọn các tài liệu từ kho của bạn để chia sẻ cho học viên trong lớp này:
              </p>
              {loadingCategories ? (
                <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>
              ) : allDocCategories.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-muted)' }}>
                  Bạn chưa có tài liệu nào trong kho tài liệu.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {allDocCategories.map((cat) => (
                    <div key={cat.id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--color-text-primary)' }}>
                        📁 {cat.name} ({cat.docs.length})
                      </div>
                      {cat.docs.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Không có tệp nào.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {cat.docs.map((doc) => {
                            const isAttached = attachedDocIdsSet.has(doc.id);
                            return (
                              <label
                                key={doc.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontSize: 13,
                                  padding: '4px 6px',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  background: isAttached ? 'rgba(79,70,229,0.06)' : 'transparent',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isAttached}
                                  onChange={() => handleToggleDocAttachment(doc.id, isAttached)}
                                />
                                <span style={{ fontWeight: isAttached ? 600 : 400 }}>
                                  {getDisplayFileName(doc.file_name)}
                                </span>
                                {isAttached && <span className="badge badge-success" style={{ fontSize: 10, marginLeft: 'auto' }}>Đang chia sẻ</span>}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowManageDocs(false)}>Hoàn tất</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
