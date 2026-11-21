import React, { useEffect, useMemo, useState } from 'react';
import { faceProfileApi } from '../../api';
import type { ClassFaceProfileItem, ClassFaceProfileSummary } from '../../types';

interface ClassFaceProfilesTabProps {
  classId: number;
  onSummaryChange?: (summary: ClassFaceProfileSummary) => void;
}

const STEP_LABELS: Record<number, string> = {
  1: '1. Chính diện',
  2: '2. Nghiêng trái',
  3: '3. Nghiêng phải',
  4: '4. Chính diện #2',
};

const REJECT_PRESETS = [
  'Ảnh quá tối hoặc bị mờ, không nhìn rõ ngũ quan',
  'Đang đeo khẩu trang che mặt',
  'Đang đeo kính râm hoặc vật cản che mắt',
  'Góc chụp chưa đúng hướng dẫn (cần nhìn thẳng và nghiêng nhẹ)',
  'Có nhiều người trong khung hình hoặc ảnh không hợp lệ',
];

export default function ClassFaceProfilesTab({
  classId,
  onSummaryChange,
}: ClassFaceProfilesTabProps) {
  const [items, setItems] = useState<ClassFaceProfileItem[]>([]);
  const [summary, setSummary] = useState<ClassFaceProfileSummary>({
    total: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    unregistered: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'pending' | 'approved' | 'rejected' | 'unregistered'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Reject Modal
  const [rejectTarget, setRejectTarget] = useState<ClassFaceProfileItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Lightbox Modal
  const [lightboxPhoto, setLightboxPhoto] = useState<{
    url: string;
    studentName: string;
    stepLabel: string;
  } | null>(null);

  useEffect(() => {
    loadProfiles();
    return () => {
      Object.values(photoUrls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [classId]);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const res = await faceProfileApi.listForClass(classId);
      const data = res.data.data;
      setItems(data.items || []);
      setSummary(data.summary);
      onSummaryChange?.(data.summary);
      setSelectedStudentIds([]);

      // Load thumbnails for students who have photos
      const withPhotos = (data.items || []).filter(
        (it) => it.photoSteps && it.photoSteps.length > 0,
      );
      loadAllPhotosForItems(withPhotos);
    } catch (err) {
      console.error('Failed to load class face profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAllPhotosForItems = async (list: ClassFaceProfileItem[]) => {
    const newEntries: Record<string, string> = {};
    await Promise.all(
      list.flatMap((student) =>
        (student.photoSteps || []).map(async (stepNo: number) => {
          const key = `${student.studentId}_${stepNo}`;
          try {
            const res = await faceProfileApi.fetchStudentPhotoBlob(student.studentId, stepNo);
            newEntries[key] = URL.createObjectURL(res.data);
          } catch {
            // ignore missing photo
          }
        }),
      ),
    );
    setPhotoUrls((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return newEntries;
    });
  };

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (filterStatus !== 'all' && it.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = it.studentName?.toLowerCase().includes(q);
        const matchId = it.loginId?.toLowerCase().includes(q);
        if (!matchName && !matchId) return false;
      }
      return true;
    });
  }, [items, filterStatus, searchQuery]);

  const pendingItemsInView = useMemo(
    () => filteredItems.filter((it) => it.status === 'pending'),
    [filteredItems],
  );

  const toggleSelectStudent = (studentId: number) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId],
    );
  };

  const toggleSelectAllPending = () => {
    const pendingIds = pendingItemsInView.map((it) => it.studentId);
    const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedStudentIds.includes(id));
    if (allSelected) {
      setSelectedStudentIds((prev) => prev.filter((id) => !pendingIds.includes(id)));
    } else {
      setSelectedStudentIds((prev) => Array.from(new Set([...prev, ...pendingIds])));
    }
  };

  const handleApproveSingle = async (student: ClassFaceProfileItem) => {
    setProcessingId(student.studentId);
    try {
      await faceProfileApi.review(student.studentId, 'approve');
      await loadProfiles();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.response?.data?.message || 'Không thể duyệt hồ sơ khuôn mặt.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedStudentIds.length === 0) return;
    setBulkProcessing(true);
    try {
      await faceProfileApi.reviewBulk(selectedStudentIds, 'approve');
      await loadProfiles();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.response?.data?.message || 'Không thể duyệt hàng loạt.');
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      alert('Vui lòng nhập hoặc chọn lý do từ chối.');
      return;
    }
    setProcessingId(rejectTarget.studentId);
    try {
      await faceProfileApi.review(rejectTarget.studentId, 'reject', rejectReason.trim());
      setRejectTarget(null);
      setRejectReason('');
      await loadProfiles();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.response?.data?.message || 'Không thể từ chối hồ sơ khuôn mặt.');
    } finally {
      setProcessingId(null);
    }
  };

  const renderStatusPill = (item: ClassFaceProfileItem) => {
    if (item.status === 'approved') {
      return (
        <span
          className="badge"
          style={{
            background: '#ECFDF5',
            color: '#059669',
            border: '1px solid #A7F3D0',
            fontWeight: 600,
          }}
        >
          🟢 Đã duyệt
        </span>
      );
    }
    if (item.status === 'pending') {
      return (
        <span
          className="badge"
          style={{
            background: '#FFFBEB',
            color: '#D97706',
            border: '1px solid #FDE68A',
            fontWeight: 600,
          }}
        >
          🟡 Chờ duyệt
        </span>
      );
    }
    if (item.status === 'rejected') {
      return (
        <span
          className="badge"
          style={{
            background: '#FEF2F2',
            color: '#DC2626',
            border: '1px solid #FECACA',
            fontWeight: 600,
          }}
        >
          🔴 Đã từ chối
        </span>
      );
    }
    return (
      <span
        className="badge"
        style={{
          background: '#F1F5F9',
          color: '#64748B',
          border: '1px solid #E2E8F0',
          fontWeight: 600,
        }}
      >
        ⚪ Chưa đăng ký
      </span>
    );
  };

  return (
    <div>
      {/* Header & Summary Filter Chips */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
              Quản lý & Duyệt hồ sơ khuôn mặt sinh viên
            </h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
              Kiểm tra 4 ảnh góc mặt của sinh viên trước khi cho phép sử dụng điểm danh tự động trong phòng học & xác thực phòng thi.
            </p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={loadProfiles} disabled={loading}>
            🔄 Làm mới
          </button>
        </div>

        {/* Filter Chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {[
            { key: 'all', label: `Tất cả (${summary.total})` },
            { key: 'pending', label: `🟡 Chờ duyệt (${summary.pending})` },
            { key: 'approved', label: `🟢 Đã duyệt (${summary.approved})` },
            { key: 'rejected', label: `🔴 Từ chối (${summary.rejected})` },
            { key: 'unregistered', label: `⚪ Chưa đăng ký (${summary.unregistered})` },
          ].map((chip) => {
            const active = filterStatus === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilterStatus(chip.key as any)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: active ? '2px solid #4F46E5' : '1px solid var(--color-border)',
                  background: active ? '#EEF2FF' : '#fff',
                  color: active ? '#4F46E5' : 'var(--color-text-primary)',
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* Search & Bulk Action Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <input
            type="text"
            className="form-input"
            placeholder="Tìm theo tên hoặc mã sinh viên..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ maxWidth: 320 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {pendingItemsInView.length > 0 && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    pendingItemsInView.length > 0 &&
                    pendingItemsInView.every((it) => selectedStudentIds.includes(it.studentId))
                  }
                  onChange={toggleSelectAllPending}
                />
                Chọn tất cả chờ duyệt ({pendingItemsInView.length})
              </label>
            )}

            {selectedStudentIds.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleBulkApprove}
                disabled={bulkProcessing}
              >
                {bulkProcessing
                  ? 'Đang duyệt...'
                  : `✅ Duyệt tất cả đã chọn (${selectedStudentIds.length})`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Student List */}
      {loading ? (
        <div className="page-loading">
          <div className="spinner" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card empty-state" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            Không có sinh viên nào trong bộ lọc này
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Thử chuyển sang bộ lọc "Tất cả" hoặc xóa từ khóa tìm kiếm.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filteredItems.map((st) => {
            const isSelected = selectedStudentIds.includes(st.studentId);
            const isBusy = processingId === st.studentId;
            return (
              <div
                key={st.studentId}
                className="card"
                style={{
                  padding: 18,
                  border:
                    st.status === 'pending'
                      ? '1px solid #FDE68A'
                      : '1px solid var(--color-border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    marginBottom: st.photoSteps?.length ? 14 : 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {st.status === 'pending' && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectStudent(st.studentId)}
                        style={{ width: 17, height: 17, cursor: 'pointer' }}
                      />
                    )}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{st.studentName}</span>
                        <span
                          style={{
                            fontSize: 12.5,
                            color: 'var(--color-text-muted)',
                            background: '#F1F5F9',
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontWeight: 600,
                          }}
                        >
                          {st.loginId}
                        </span>
                        {renderStatusPill(st)}
                        {st.hasPreviousApproved && st.status !== 'approved' && (
                          <span
                            style={{
                              fontSize: 11.5,
                              color: '#059669',
                              background: '#ECFDF5',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontWeight: 600,
                            }}
                          >
                            Đang bảo lưu bản duyệt cũ
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        {st.updatedAt
                          ? `Đăng ký lúc: ${new Date(st.updatedAt).toLocaleString('vi-VN')}`
                          : 'Sinh viên chưa gửi 4 ảnh khuôn mặt mẫu'}
                        {st.reviewerName && ` • Duyệt bởi: ${st.reviewerName}`}
                      </div>
                      {st.status === 'rejected' && st.rejectReason && (
                        <div style={{ fontSize: 12.5, color: '#DC2626', marginTop: 4, fontWeight: 500 }}>
                          Lý do từ chối: {st.rejectReason}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Review Action Buttons */}
                  {st.status !== 'unregistered' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {st.status !== 'approved' && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleApproveSingle(st)}
                          disabled={isBusy}
                          style={{ background: '#059669', borderColor: '#059669' }}
                        >
                          {isBusy ? 'Đang xử lý...' : '✅ Duyệt'}
                        </button>
                      )}
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ color: '#DC2626', borderColor: '#FECACA' }}
                        onClick={() => {
                          setRejectTarget(st);
                          setRejectReason(st.rejectReason || '');
                        }}
                        disabled={isBusy}
                      >
                        ❌ Từ chối
                      </button>
                    </div>
                  )}
                </div>

                {/* 4 Photos Grid */}
                {st.photoSteps && st.photoSteps.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                      gap: 12,
                    }}
                  >
                    {[1, 2, 3, 4].map((step) => {
                      const key = `${st.studentId}_${step}`;
                      const url = photoUrls[key];
                      const label = STEP_LABELS[step] || `Bước ${step}`;
                      return (
                        <div
                          key={step}
                          onClick={() =>
                            url &&
                            setLightboxPhoto({
                              url,
                              studentName: `${st.studentName} (${st.loginId})`,
                              stepLabel: label,
                            })
                          }
                          style={{
                            aspectRatio: '4/3',
                            background: '#0F172A',
                            borderRadius: 10,
                            overflow: 'hidden',
                            position: 'relative',
                            cursor: url ? 'zoom-in' : 'default',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={label}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                transform: 'scaleX(-1)',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#94A3B8',
                                fontSize: 12,
                              }}
                            >
                              Đang tải...
                            </div>
                          )}
                          <span
                            style={{
                              position: 'absolute',
                              bottom: 6,
                              left: 6,
                              background: 'rgba(15, 23, 42, 0.78)',
                              color: '#fff',
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '2px 7px',
                              borderRadius: 5,
                            }}
                          >
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectTarget && (
        <div className="modal-overlay" onClick={() => setRejectTarget(null)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Từ chối hồ sơ khuôn mặt</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setRejectTarget(null)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleConfirmReject}>
              <div className="modal-body">
                <div style={{ fontSize: 14, marginBottom: 12 }}>
                  Sinh viên: <strong>{rejectTarget.studentName}</strong> ({rejectTarget.loginId})
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  Chọn nhanh lý do phổ biến:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {REJECT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setRejectReason(preset)}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        borderRadius: 8,
                        fontSize: 12.5,
                        border:
                          rejectReason === preset
                            ? '2px solid #DC2626'
                            : '1px solid var(--color-border)',
                        background: rejectReason === preset ? '#FEF2F2' : '#F8FAFC',
                        cursor: 'pointer',
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="form-group">
                  <label className="form-label">Lý do từ chối cụ thể *</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Nhập lý do để sinh viên biết cần chụp lại như thế nào..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setRejectTarget(null)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: '#DC2626', borderColor: '#DC2626' }}
                  disabled={processingId === rejectTarget.studentId}
                >
                  Xác nhận từ chối
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox Photo Modal */}
      {lightboxPhoto && (
        <div
          className="modal-overlay"
          onClick={() => setLightboxPhoto(null)}
          style={{ background: 'rgba(15, 23, 42, 0.85)' }}
        >
          <div
            className="modal"
            style={{ maxWidth: 680, padding: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{lightboxPhoto.studentName}</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                  {lightboxPhoto.stepLabel}
                </div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setLightboxPhoto(null)}>
                ✕
              </button>
            </div>
            <div
              style={{
                background: '#0F172A',
                borderRadius: 12,
                overflow: 'hidden',
                aspectRatio: '4/3',
              }}
            >
              <img
                src={lightboxPhoto.url}
                alt={lightboxPhoto.stepLabel}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  transform: 'scaleX(-1)',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
