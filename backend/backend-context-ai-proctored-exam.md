# Backend Context for AI-Proctored Online Exam Planning

Tài liệu này mô tả hiện trạng backend để dùng làm đầu vào cho Claude lập plan module thi online có giám sát bằng AI. Đây là tài liệu chỉ đọc; không thay đổi code hiện tại.

## 1. Tổng quan stack kỹ thuật

- Runtime: Node.js.
- Ngôn ngữ: TypeScript.
- HTTP framework: Express 4 (`express`), không dùng NestJS hoặc Fastify.
- Database: PostgreSQL.
- Database driver/query layer: `pg` (`Pool`), truy vấn SQL raw trực tiếp. Không dùng Prisma, TypeORM, Sequelize hoặc Knex.
- File upload: Multer (`multer`) với `diskStorage`.
- Authentication: `jsonwebtoken` + bcrypt.
- Cookie: `cookie-parser`.
- Realtime/WebRTC signaling: Socket.IO.
- CORS: cho phép frontend từ `FRONTEND_URL` và `https://localhost:5173`, có `credentials: true`.
- API prefix: `/api`.
- Default backend port: `3001`.
- TypeScript build: `tsc`; development: `tsx watch src/server.ts`.

Các route được mount trong `src/server.ts`:

- `/api/auth`
- `/api/classes`
- `/api/exercises`
- `/api/documents`
- `/api/meetings`
- `/api/health`

## 2. Database schema hiện tại

Database là PostgreSQL. Schema nằm trong `sql/schema.sql`. Schema hiện tại có lệnh `DROP TABLE IF EXISTS ... CASCADE` ở đầu file, nên file này đang có tính chất khởi tạo/reset schema, không phải migration incremental.

### 2.1. Users và authentication

#### `users`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `is_lecturer` | `BOOLEAN` | `NOT NULL`, default `FALSE`; phân biệt giảng viên/học viên |
| `name` | `VARCHAR(100)` | `NOT NULL` |
| `phone_number` | `VARCHAR(12)` | `UNIQUE`, nullable |
| `email` | `VARCHAR(100)` | `UNIQUE`, nullable |
| `password` | `VARCHAR(100)` | `NOT NULL`, lưu password hash |

#### `user_login_id`

Dùng cho định danh đăng nhập như MSSV, email, phone.

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `user_id` | `INTEGER` | FK tới `users(id)` |
| `login_id` | `VARCHAR(100)` | `NOT NULL`, `UNIQUE` |

#### `lecturers`

- `id INTEGER PRIMARY KEY REFERENCES users(id)`.
- Bảng role extension cho giảng viên.

#### `students`

- `id INTEGER PRIMARY KEY REFERENCES users(id)`.
- Bảng role extension cho học viên.

#### `refresh_tokens`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `user_id` | `INTEGER` | FK tới `users(id)` với `ON DELETE CASCADE` |
| `token` | `TEXT` | `NOT NULL`, `UNIQUE`; lưu refresh JWT |
| `expires_at` | `TIMESTAMP` | `NOT NULL` |
| `created_at` | `TIMESTAMP` | default `NOW()` |

Index hiện có: `idx_refresh_tokens_user` trên `user_id`.

### 2.2. Lớp học và thành viên

#### `classes`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `name` | `VARCHAR(100)` | `NOT NULL` |
| `lecturer_id` | `INTEGER` | `NOT NULL`, FK tới `lecturers(id)` |
| `invite_code_students` | `UUID` | `UNIQUE`, `NOT NULL`, default `uuid_generate_v4()` |
| `is_open_students` | `BOOLEAN` | default `TRUE` |

#### `class_collaborators`

- `id SERIAL PRIMARY KEY`.
- `class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE`.
- `lecturer_id INTEGER NOT NULL REFERENCES lecturers(id)`.
- Dùng cho giảng viên cộng tác.

#### `classes_n_students`

Bảng many-to-many giữa lớp và học viên.

- `class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE`.
- `student_id INTEGER NOT NULL REFERENCES students(id)`.
- Primary key kép: `(class_id, student_id)`.

Index hiện có:

- `idx_classes_lecturer` trên `classes(lecturer_id)`.
- `idx_classes_n_students_class` trên `classes_n_students(class_id)`.
- `idx_classes_n_students_student` trên `classes_n_students(student_id)`.

### 2.3. Tài liệu và file đính kèm

#### `doc_categories`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `name` | `VARCHAR(100)` | `NOT NULL` |
| `lecturer_id` | `INTEGER` | `NOT NULL`, FK tới `lecturers(id)` |

#### `docs`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `file_name` | `TEXT` | `NOT NULL`; lưu path tương đối, ví dụ `2/1788439877353-file.txt` |
| `doc_category_id` | `INTEGER` | `NOT NULL`, FK tới `doc_categories(id) ON DELETE CASCADE` |

#### `class_attach_files`

- `class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE`.
- `doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE`.
- Primary key kép: `(class_id, doc_id)`.

#### `exercise_attach_files`

- `exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE`.
- `doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE`.
- Primary key kép: `(exercise_id, doc_id)`.

Index hiện có: `idx_docs_category` trên `docs(doc_category_id)`.

### 2.4. Buổi học online

#### `meetings`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `class_id` | `INTEGER` | `NOT NULL`, FK tới `classes(id) ON DELETE CASCADE` |
| `start_time` | `TIMESTAMP` | `NOT NULL` |
| `end_time` | `TIMESTAMP` | `NOT NULL` |
| `name` | `VARCHAR(200)` | `NOT NULL` |
| `description` | `TEXT` | nullable |
| `meeting_code` | `UUID` | `UNIQUE`, `NOT NULL`, default `uuid_generate_v4()` |

Index hiện có: `idx_meetings_class` trên `meetings(class_id)`.

Backend hiện dùng Socket.IO cho signaling WebRTC. Room được quản lý trong memory theo `roomId`; participant gồm `socketId`, `userId`, `userName`. Chưa có bảng persistence cho room/participant.

### 2.5. Bài tập và bài nộp

#### `exercises`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `class_id` | `INTEGER` | `NOT NULL`, FK tới `classes(id) ON DELETE CASCADE` |
| `start_time` | `TIMESTAMP` | `NOT NULL` |
| `end_time` | `TIMESTAMP` | `NOT NULL` |
| `name` | `TEXT` | `NOT NULL` |
| `description` | `TEXT` | nullable |

Index hiện có: `idx_exercises_class` trên `exercises(class_id)`.

#### `submitted_exercises`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `student_id` | `INTEGER` | `NOT NULL`, FK tới `students(id) ON DELETE CASCADE` |
| `exercise_id` | `INTEGER` | `NOT NULL`, FK tới `exercises(id) ON DELETE CASCADE` |
| `submit_time` | `TIMESTAMP` | default `NOW()` |
| `is_submitted` | `BOOLEAN` | default `FALSE` |

Có unique constraint trên `(student_id, exercise_id)`.

#### `submitted_exercise_attach_file`

| Column | Type | Constraint / ý nghĩa |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `submitted_exercises_id` | `INTEGER` | `NOT NULL`, FK tới `submitted_exercises(id) ON DELETE CASCADE` |
| `file_name` | `TEXT` | nullable; path tương đối trong `uploads` |

Index hiện có:

- `idx_submitted_exercises_student` trên `submitted_exercises(student_id)`.
- `idx_submitted_exercises_exercise` trên `submitted_exercises(exercise_id)`.

### 2.6. Những gì schema chưa có cho module thi AI

Hiện chưa có bảng riêng cho:

- Kỳ thi/đề thi/câu hỏi/đáp án.
- Lần làm bài hoặc attempt của học viên.
- Trạng thái bắt đầu, nộp bài, hết giờ, chấm điểm.
- Phiên giám sát/proctoring.
- Sự kiện vi phạm hoặc flag từ AI.
- Ảnh/video frame bằng chứng vi phạm.
- Audit log cho các thao tác quan trọng.
- Kết quả AI, confidence score, loại vi phạm hoặc trạng thái review của giảng viên.

Khi thiết kế schema mới cần xác định rõ FK về `users`/`students`, `classes`, và entity kỳ thi; quy tắc xóa cascade; uniqueness của attempt; timezone; retention của ảnh bằng chứng; và index cho truy vấn theo attempt/student/exam/time.

## 3. Authentication và authorization

### Access token

- Dùng JWT.
- Secret: `JWT_SECRET`.
- Expiration: `JWT_EXPIRES_IN`, mặc định `15m`.
- Payload hiện tại:

```ts
{
  userId: number;
  name: string;
  isLecturer: boolean;
}
```

- Client gửi access token bằng header:

```http
Authorization: Bearer <accessToken>
```

- Middleware `requireLogin` chỉ đọc Bearer token từ `Authorization` header.
- Access token không được lưu trong cookie bởi backend hiện tại.

### Refresh token

- Dùng JWT riêng với `JWT_REFRESH_SECRET`.
- Expiration: `JWT_REFRESH_EXPIRES_IN`, mặc định `7d`.
- Refresh token được lưu đồng thời trong bảng `refresh_tokens`.
- Client nhận refresh token qua cookie tên `refreshToken`.
- Cookie được set với `httpOnly: true`, `sameSite: 'lax'`, và `secure: true` khi `NODE_ENV=production`.
- Endpoint refresh đọc cookie qua `req.cookies`.

### Role middleware

- `requireLogin`: yêu cầu access JWT hợp lệ.
- `requireLecturer`: yêu cầu `req.user.isLecturer === true`.
- `requireStudent`: từ chối user có `isLecturer === true`.

Lưu ý: một số controller/service hiện tại chịu trách nhiệm kiểm tra quyền sở hữu class/resource; route middleware chỉ đảm bảo login hoặc role ở mức cơ bản. Module mới nên kiểm tra cả quyền truy cập vào đúng class/exam/attempt, không chỉ kiểm tra role.

## 4. Convention response và lỗi

### Thành công

Convention chính là object có `success: true`:

```json
{
  "success": true,
  "data": {},
  "message": "..."
}
```

`data` và `message` tùy endpoint. Các dạng thường gặp:

- Danh sách: `{ "success": true, "data": [...] }`
- Một resource: `{ "success": true, "data": {...} }`
- Mutation chỉ thông báo: `{ "success": true, "message": "..." }`
- Một số endpoint trả file trực tiếp bằng `res.download`, không bọc JSON.

`ApiResponse<T>` hiện được định nghĩa là:

```ts
interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
```

### Lỗi

Convention lỗi:

```json
{
  "success": false,
  "error": "Thông báo lỗi bằng tiếng Việt"
}
```

Status code đang dùng:

- `400`: input thiếu/sai hoặc lỗi nghiệp vụ trong signup.
- `401`: chưa đăng nhập, access token sai/hết hạn, login thất bại, refresh token sai/hết hạn.
- `403`: sai role hoặc không có quyền.
- `404`: resource không tồn tại ở một số endpoint.
- `500`: lỗi máy chủ chung, thường trả thông báo `Lỗi máy chủ`.

Backend hiện chưa có một error handler trung tâm; nhiều controller tự `try/catch` và tự trả JSON. Endpoint mới nên giữ format trên để đồng bộ.

## 5. Danh sách endpoint hiện có

Tất cả đường dẫn dưới đây đã bao gồm prefix `/api`.

### 5.1. Health

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `GET` | `/api/health` | Public | Health check, trả `{ status: "ok", timestamp }`; đây là ngoại lệ không dùng `{ success, data }` |

### 5.2. Auth

| Method | Path | Auth | Body / cookie | Response chính |
|---|---|---|---|---|
| `POST` | `/api/auth/signup` | Public | JSON `{ name, loginId, password }` | HTTP `200`, `success: true`, `data: { accessToken, user }`; set refresh cookie |
| `POST` | `/api/auth/login` | Public | JSON `{ loginId, password }` | `success: true`, `data: { accessToken, user }`; set refresh cookie |
| `POST` | `/api/auth/refresh` | Refresh cookie | Cookie `refreshToken` | `success: true`, `data: { accessToken }` |
| `POST` | `/api/auth/logout` | Không bắt buộc access token | Cookie `refreshToken` | `success: true`, `message` |
| `GET` | `/api/auth/me` | `requireLogin` | Bearer access token | `success: true`, `data: { user }` |

`signup` hiện tạo tài khoản lecturer. Học viên được tạo qua luồng import học viên của class.

### 5.3. Classes và học viên

Router `/api/classes` dùng `requireLogin` cho toàn bộ endpoint.

| Method | Path | Role | Body / file | Mô tả |
|---|---|---|---|---|
| `GET` | `/api/classes` | Login | - | Lấy các lớp của user hiện tại; lecturer/student có luồng query khác nhau |
| `POST` | `/api/classes` | Lecturer | JSON `{ name }` | Tạo lớp |
| `POST` | `/api/classes/join` | Login | JSON `{ inviteCode }` | Học viên tham gia lớp bằng invite code |
| `GET` | `/api/classes/:id` | Login | - | Lấy thông tin lớp |
| `PUT` | `/api/classes/:id/name` | Lecturer | JSON `{ name }` | Đổi tên lớp |
| `PUT` | `/api/classes/:id/invite-status` | Lecturer | JSON `{ isOpen }` | Bật/tắt việc mời học viên |
| `GET` | `/api/classes/:id/students` | Login | - | Lấy danh sách học viên |
| `POST` | `/api/classes/:id/students/import` | Lecturer | multipart field `file` | Import học viên từ Excel; response là file Excel download |
| `DELETE` | `/api/classes/:id/students/:studentId` | Lecturer | - | Xóa học viên khỏi lớp |
| `GET` | `/api/classes/:id/attach-files` | Login | - | Lấy file đính kèm của lớp |
| `POST` | `/api/classes/:id/attach-files` | Lecturer | Form/multipart `{ docId }` | Đính kèm tài liệu vào lớp |
| `DELETE` | `/api/classes/:id/attach-files` | Lecturer | Form/multipart `{ docId }` | Gỡ tài liệu khỏi lớp |

### 5.4. Documents và file tài liệu

Router `/api/documents` dùng `requireLogin`; hầu hết thao tác là lecturer-only.

| Method | Path | Role | Body / file | Mô tả |
|---|---|---|---|---|
| `GET` | `/api/documents` | Lecturer | - | Lấy category và tài liệu của lecturer |
| `POST` | `/api/documents/categories` | Lecturer | form `{ name }` | Tạo category |
| `PUT` | `/api/documents/categories/:id` | Lecturer | form `{ name }` | Đổi tên category |
| `DELETE` | `/api/documents/categories/:id` | Lecturer | - | Xóa category và file liên quan |
| `GET` | `/api/documents/categories/:id/docs` | Login | - | Lấy tài liệu theo category |
| `POST` | `/api/documents/upload` | Lecturer | multipart array field `files`, form `docCategoryId` | Upload nhiều tài liệu |
| `DELETE` | `/api/documents/:id` | Lecturer | form `{ fileName }` | Xóa tài liệu và file vật lý |

### 5.5. Exercises/submissions, liên quan đến mô hình attempt

Router `/api/exercises` dùng `requireLogin`.

| Method | Path | Role | Body / file | Mô tả |
|---|---|---|---|---|
| `GET` | `/api/exercises/class/:classId` | Login | - | Lấy bài tập của lớp |
| `POST` | `/api/exercises` | Lecturer | form `classId, name, description, startTime, endTime, attachFileIds` | Tạo bài tập |
| `PUT` | `/api/exercises/:id` | Lecturer | form `name, description, startTime, endTime, attachFileIds` | Sửa bài tập |
| `DELETE` | `/api/exercises/:id` | Lecturer | - | Xóa bài tập và file bài nộp |
| `GET` | `/api/exercises/:id` | Lecturer | - | Lấy chi tiết bài tập cho lecturer |
| `GET` | `/api/exercises/class/:classId/submissions/:exerciseId` | Lecturer | - | Xem trạng thái nộp của học viên |
| `GET` | `/api/exercises/class/:classId/submissions/:exerciseId/download` | Lecturer | - | Download zip bài nộp |
| `POST` | `/api/exercises/:exerciseId/submit` | Student | multipart array field `files` | Nộp file; response gồm files và submissionStatus |
| `DELETE` | `/api/exercises/:exerciseId/submit` | Student | form có `exerciseId` | Hủy nộp bài và xóa file |
| `GET` | `/api/exercises/:exerciseId/submit` | Student | - | Lấy file đã nộp |
| `DELETE` | `/api/exercises/:exerciseId/submit/file` | Student | form `{ fileId, exerciseId, fileName }` | Xóa một file bài nộp |

### 5.6. Meetings

Router `/api/meetings` dùng `requireLogin`.

| Method | Path | Role | Body | Mô tả |
|---|---|---|---|---|
| `GET` | `/api/meetings/class/:classId` | Login | - | Lấy các buổi học của lớp |
| `GET` | `/api/meetings/code/:code` | Login | - | Lấy buổi học theo UUID meeting code |
| `GET` | `/api/meetings/:id` | Login | - | Lấy buổi học theo id |
| `POST` | `/api/meetings` | Lecturer | form `classId, name, description, startTime, endTime` | Tạo buổi học |
| `PUT` | `/api/meetings/:id` | Lecturer | form `name, description, startTime, endTime` | Sửa buổi học |
| `DELETE` | `/api/meetings/:id` | Lecturer | - | Xóa buổi học |

Lưu ý thứ tự route meeting: `/code/:code` được khai báo trước `/:id`.

## 6. File/image storage hiện tại

### Cách lưu

- Local disk, không dùng S3, Cloudinary hay object storage.
- Root directory: `path.join(process.cwd(), 'uploads')`.
- Express expose trực tiếp thư mục này tại:

```http
GET /uploads/<relative-file-path>
```

- Multer lưu file theo thư mục user:

```text
uploads/<userId>/<timestamp>-<originalFilename>
```

Ví dụ:

```text
uploads/2/1788439877353-Assignment 1 - 2024.txt
```

- Trong database, backend thường lưu path tương đối, ví dụ:

```text
2/1788439877353-Assignment 1 - 2024.txt
```

- URL truy cập thường được ghép từ backend base URL và `/uploads/` + path tương đối.

### Middleware upload

File hiện tại: `src/middleware/upload.middleware.ts`.

- `uploadSingle`: multipart field `file`.
- `uploadArray`: multipart field `files`.
- `uploadFields(...)`: nhiều field tùy cấu hình.
- `formOnly`: parse form nhưng không lưu file.
- Tên file được tạo bằng `${Date.now()}-${file.originalname}`.
- Có xử lý chuyển filename từ Latin-1 sang UTF-8.
- Thư mục user được tạo tự động.

### Các điểm cần tính khi lưu frame vi phạm AI

Module mới nên tiếp tục dùng local disk nếu mục tiêu là đồng bộ convention hiện tại, nhưng không nên đặt frame vi phạm lẫn với file tài liệu/bài nộp nếu cần lifecycle và phân quyền khác. Nên cân nhắc thư mục riêng, ví dụ:

```text
uploads/proctoring/<attemptId>/<timestamp>-<uuid>.jpg
```

Database nên lưu path tương đối hoặc object key, không lưu absolute path. Một record bằng chứng nên có tối thiểu: attempt/session id, loại flag, timestamp của event, path ảnh, thời điểm server nhận, AI confidence, metadata tùy chọn, và trạng thái review của lecturer.

Vì `/uploads` hiện đang public qua `express.static`, ảnh bằng chứng sẽ không tự động private. Nếu bằng chứng chứa hình ảnh khuôn mặt hoặc dữ liệu nhạy cảm, module mới cần thiết kế endpoint download/stream có `requireLogin` và kiểm tra quyền thay vì expose trực tiếp, hoặc thay đổi cách serve file có kiểm soát.

## 7. Các convention quan trọng cho plan module mới

1. Đặt route mới dưới `/api/...`, dùng Express Router.
2. Dùng `requireLogin` và role middleware hiện có; bổ sung kiểm tra user có thuộc class và có quyền trên đúng exam/attempt.
3. Dùng raw SQL qua helper `query`/`queryOne` trong `src/config/database.ts`.
4. Dùng số nguyên `SERIAL` cho ID quan hệ nội bộ, UUID cho mã public/invite nếu cần khó đoán.
5. Response JSON thành công dùng `{ success: true, data?, message? }`.
6. Response lỗi dùng `{ success: false, error: string }`, thông báo hiện tại chủ yếu bằng tiếng Việt.
7. Không đưa password vào response; auth payload hiện trả `userId`, `name`, `isLecturer`.
8. Access token đi qua `Authorization: Bearer`; refresh token đi qua `httpOnly` cookie.
9. File upload hiện dùng multipart và Multer local disk; frame ảnh cần quy định rõ format, kích thước, naming, retention và quyền truy cập.
10. Cần xử lý transaction cho các thao tác tạo attempt, lưu answer, ghi violation và hoàn tất/nộp bài nếu một request cập nhật nhiều bảng.
11. Schema hiện dùng `TIMESTAMP` không nêu timezone; module thi nên thống nhất quy ước timezone trước khi triển khai timer và event timestamp.
12. Socket.IO hiện có sẵn cho realtime signaling, nhưng room state đang ở memory; nếu module giám sát dùng realtime event, cần thiết kế riêng việc xác thực socket, reconnect và persistence.
