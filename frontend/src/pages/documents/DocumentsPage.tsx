import React, { useEffect, useState, useMemo } from 'react';
import { documentApi, classApi } from '../../api';
import type { ClassInfo, DocCategoryRaw } from '../../types';
import Sidebar from '../../components/layout/Sidebar';

interface DocItem {
  id: number;
  file_name: string;
}

interface CategoryGroup {
  id: number;
  name: string;
  docs: DocItem[];
}

const BACKEND_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';

export default function DocumentsPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<number, boolean>>({});

  // Modals
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);

  const [editCat, setEditCat] = useState<CategoryGroup | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);

  const [uploadCat, setUploadCat] = useState<CategoryGroup | null>(null);
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [classRes, docRes] = await Promise.all([
        classApi.getAll(),
        documentApi.getAll(),
      ]);
      setClasses(classRes.data.data || []);

      // Group raw rows into CategoryGroup[]
      const rawData = docRes.data.data || [];
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

      const catList = Array.from(map.values());
      setCategories(catList);

      // Expand all by default
      const exp: Record<number, boolean> = {};
      catList.forEach((c) => { exp[c.id] = true; });
      setExpandedCategories(exp);
    } catch {
      console.error('Lỗi khi tải tài liệu');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setAddingCategory(true);
    try {
      await documentApi.createCategory(newCatName.trim());
      setNewCatName('');
      setShowAddCategory(false);
      await loadData();
    } catch {
      alert('Không thể tạo danh mục');
    } finally {
      setAddingCategory(false);
    }
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCat || !editCatName.trim()) return;
    setSavingCat(true);
    try {
      await documentApi.updateCategory(editCat.id, editCatName.trim());
      setEditCat(null);
      await loadData();
    } catch {
      alert('Không thể đổi tên danh mục');
    } finally {
      setSavingCat(false);
    }
  };

  const handleDeleteCategory = async (cat: CategoryGroup) => {
    if (!confirm(`Xác nhận xóa danh mục "${cat.name}" và toàn bộ tài liệu bên trong?`)) return;
    try {
      await documentApi.deleteCategory(cat.id);
      await loadData();
    } catch {
      alert('Không thể xóa danh mục');
    }
  };

  const handleUploadFiles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadCat || !uploadFiles || uploadFiles.length === 0) {
      alert('Vui lòng chọn tệp');
      return;
    }
    setUploading(true);
    try {
      await documentApi.upload(uploadCat.id, uploadFiles);
      setUploadCat(null);
      setUploadFiles(null);
      await loadData();
    } catch {
      alert('Tải lên thất bại');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (doc: DocItem, catName: string) => {
    const displayName = getDisplayFileName(doc.file_name);
    if (!confirm(`Xác nhận xóa tài liệu "${displayName}" khỏi danh mục "${catName}"?`)) return;
    try {
      await documentApi.deleteDoc(doc.id, doc.file_name);
      await loadData();
    } catch {
      alert('Không thể xóa tài liệu');
    }
  };

  const getDisplayFileName = (pathName: string) => {
    const raw = pathName.includes('/') ? pathName.split('/')[1] : pathName;
    return raw.includes('-') ? raw.substring(raw.indexOf('-') + 1) : raw;
  };

  const getFileUrl = (pathName: string) => {
    return `${BACKEND_URL}/uploads/${pathName}`;
  };

  // Filter categories and docs by search keyword
  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const query = search.toLowerCase();
    return categories
      .map((cat) => {
        const catMatch = cat.name.toLowerCase().includes(query);
        const matchedDocs = cat.docs.filter((d) =>
          getDisplayFileName(d.file_name).toLowerCase().includes(query)
        );
        if (catMatch) return cat;
        if (matchedDocs.length > 0) return { ...cat, docs: matchedDocs };
        return null;
      })
      .filter((cat): cat is CategoryGroup => cat !== null);
  }, [categories, search]);

  const totalDocs = categories.reduce((sum, c) => sum + c.docs.length, 0);

  return (
    <div className="app-layout">
      <Sidebar classes={classes} />
      <div className="main-content">
        {/* Header */}
        <header className="page-header">
          <div className="page-header-left">
            <div className="page-header-breadcrumb">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>Kho tài liệu</span>
            </div>
            <h1 className="page-header-title">Quản lý kho tài liệu</h1>
          </div>
          <button
            id="btn-add-category"
            className="btn btn-primary"
            onClick={() => { setNewCatName(''); setShowAddCategory(true); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Tạo danh mục mới
          </button>
        </header>

        {/* Content */}
        <main className="page-content">
          {/* Stats and search */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <div className="stat-card" style={{ padding: '12px 20px' }}>
                <div className="stat-icon" style={{ width: 40, height: 40, background: '#EEF2FF' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" width="20" height="20">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div className="stat-body">
                  <div className="stat-value" style={{ fontSize: 20 }}>{categories.length}</div>
                  <div className="stat-label">Danh mục</div>
                </div>
              </div>
              <div className="stat-card" style={{ padding: '12px 20px' }}>
                <div className="stat-icon" style={{ width: 40, height: 40, background: '#F0FDF4' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" width="20" height="20">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="stat-body">
                  <div className="stat-value" style={{ fontSize: 20 }}>{totalDocs}</div>
                  <div className="stat-label">Tài liệu đã lưu</div>
                </div>
              </div>
            </div>

            {/* Search Box */}
            <div style={{ minWidth: 260 }}>
              <input
                id="search-documents"
                type="text"
                className="form-input"
                placeholder="Tìm danh mục hoặc tài liệu..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="page-loading"><div className="spinner" /></div>
          ) : filteredCategories.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div className="empty-state-title">
                {search ? 'Không tìm thấy tài liệu phù hợp' : 'Chưa có danh mục tài liệu nào'}
              </div>
              <div className="empty-state-desc">
                {search ? 'Hãy thử tìm kiếm với từ khóa khác' : 'Nhấn "Tạo danh mục mới" để bắt đầu tải lên tài liệu'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {filteredCategories.map((cat) => {
                const isExpanded = !!expandedCategories[cat.id];
                return (
                  <div key={cat.id} id={`category-card-${cat.id}`} className="card" style={{ overflow: 'hidden' }}>
                    {/* Category Header */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 20px',
                        background: 'var(--color-bg-subtle, #f8fafc)',
                        borderBottom: isExpanded ? '1px solid var(--color-border)' : 'none',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                      onClick={() => toggleExpand(cat.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', color: 'var(--color-text-muted)' }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                            <polyline points="9 18 15 12 9 6"/>
                          </svg>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                            {cat.name}
                          </span>
                          <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                            {cat.docs.length} tệp
                          </span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="btn btn-secondary btn-sm"
                          title="Tải thêm tài liệu"
                          onClick={() => { setUploadCat(cat); setUploadFiles(null); }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          Tải lên
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Đổi tên danh mục"
                          onClick={() => { setEditCat(cat); setEditCatName(cat.name); }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Xóa danh mục"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={() => handleDeleteCategory(cat)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Category Documents List */}
                    {isExpanded && (
                      <div style={{ padding: '16px 20px' }}>
                        {cat.docs.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--color-text-muted)', fontSize: 13 }}>
                            Danh mục này chưa có tệp nào. Nhấn <strong>"Tải lên"</strong> để thêm tệp vào danh mục.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                            {cat.docs.map((doc) => {
                              const displayName = getDisplayFileName(doc.file_name);
                              return (
                                <div
                                  key={doc.id}
                                  id={`doc-item-${doc.id}`}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 14px',
                                    background: 'var(--color-bg)',
                                    borderRadius: 8,
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
                                      gap: 10,
                                      color: 'var(--color-text-primary)',
                                      textDecoration: 'none',
                                      fontSize: 13,
                                      fontWeight: 500,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      flex: 1,
                                    }}
                                    title={displayName}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0 }}>
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                      <polyline points="14 2 14 8 20 8"/>
                                    </svg>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {displayName}
                                    </span>
                                  </a>
                                  <button
                                    className="btn btn-ghost btn-icon btn-sm"
                                    title="Xóa tệp"
                                    style={{ color: 'var(--color-danger)', flexShrink: 0, marginLeft: 8 }}
                                    onClick={() => handleDeleteDoc(doc, cat.name)}
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                      <polyline points="3 6 5 6 21 6"/>
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                    </svg>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Add Category Modal */}
      {showAddCategory && (
        <div className="modal-overlay" onClick={() => setShowAddCategory(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tạo danh mục tài liệu mới</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAddCategory(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateCategory}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="new-cat-name">Tên danh mục</label>
                  <input
                    id="new-cat-name"
                    type="text"
                    className="form-input"
                    placeholder="VD: Giáo trình, Slide bài giảng, Tài liệu tham khảo..."
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddCategory(false)}>Hủy</button>
                <button id="btn-submit-create-category" type="submit" className="btn btn-primary" disabled={addingCategory}>
                  {addingCategory ? 'Đang tạo...' : 'Tạo danh mục'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editCat && (
        <div className="modal-overlay" onClick={() => setEditCat(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Đổi tên danh mục</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setEditCat(null)}>✕</button>
            </div>
            <form onSubmit={handleUpdateCategory}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-cat-name">Tên danh mục mới</label>
                  <input
                    id="edit-cat-name"
                    type="text"
                    className="form-input"
                    value={editCatName}
                    onChange={(e) => setEditCatName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setEditCat(null)}>Hủy</button>
                <button id="btn-submit-update-category" type="submit" className="btn btn-primary" disabled={savingCat}>
                  {savingCat ? 'Đang lưu...' : 'Cập nhật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Files Modal */}
      {uploadCat && (
        <div className="modal-overlay" onClick={() => setUploadCat(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tải tài liệu vào: {uploadCat.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setUploadCat(null)}>✕</button>
            </div>
            <form onSubmit={handleUploadFiles}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Chọn tệp tài liệu (có thể chọn nhiều tệp)</label>
                  <input
                    id="upload-doc-input"
                    type="file"
                    className="form-input"
                    multiple
                    onChange={(e) => setUploadFiles(e.target.files)}
                    required
                  />
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                    Hỗ trợ PDF, Word, Excel, PowerPoint, Zip, hình ảnh...
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setUploadCat(null)}>Hủy</button>
                <button id="btn-submit-upload-docs" type="submit" className="btn btn-primary" disabled={uploading}>
                  {uploading ? 'Đang tải lên...' : 'Tải lên ngay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
