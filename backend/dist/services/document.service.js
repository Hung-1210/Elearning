"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDocCategory = createDocCategory;
exports.updateDocCategoryName = updateDocCategoryName;
exports.deleteDocCategory = deleteDocCategory;
exports.getAllDocCategoriesAndDocs = getAllDocCategoriesAndDocs;
exports.getAllDocsByCategory = getAllDocsByCategory;
exports.createDoc = createDoc;
exports.deleteDoc = deleteDoc;
exports.checkDocOwnership = checkDocOwnership;
const database_js_1 = require("../config/database.js");
async function createDocCategory(lecturerId, name) {
    const row = await (0, database_js_1.queryOne)('INSERT INTO doc_categories (name, lecturer_id) VALUES ($1, $2) RETURNING *', [name, lecturerId]);
    if (!row)
        throw new Error('Không thể tạo danh mục tài liệu');
    return row;
}
async function updateDocCategoryName(categoryId, newName) {
    await (0, database_js_1.query)('UPDATE doc_categories SET name = $1 WHERE id = $2', [newName, categoryId]);
}
async function deleteDocCategory(categoryId) {
    // Cascade deletes docs automatically
    await (0, database_js_1.query)('DELETE FROM doc_categories WHERE id = $1', [categoryId]);
}
async function getAllDocCategoriesAndDocs(lecturerId) {
    return (0, database_js_1.query)(`SELECT dc.id AS doc_category_id, dc.name AS category_name,
            d.id AS doc_id, d.file_name
     FROM doc_categories dc
     LEFT JOIN docs d ON d.doc_category_id = dc.id
     WHERE dc.lecturer_id = $1
     ORDER BY dc.id, d.id`, [lecturerId]);
}
async function getAllDocsByCategory(categoryId) {
    return (0, database_js_1.query)('SELECT id, file_name, doc_category_id FROM docs WHERE doc_category_id = $1 ORDER BY id', [categoryId]);
}
async function createDoc(fileName, docCategoryId) {
    const row = await (0, database_js_1.queryOne)('INSERT INTO docs (file_name, doc_category_id) VALUES ($1, $2) RETURNING *', [fileName, docCategoryId]);
    if (!row)
        throw new Error('Không thể tạo tài liệu');
    return row;
}
async function deleteDoc(docId) {
    await (0, database_js_1.query)('DELETE FROM docs WHERE id = $1', [docId]);
}
async function checkDocOwnership(lecturerId, docCategoryId) {
    const row = await (0, database_js_1.queryOne)('SELECT 1 FROM doc_categories WHERE id = $1 AND lecturer_id = $2', [docCategoryId, lecturerId]);
    return !!row;
}
//# sourceMappingURL=document.service.js.map