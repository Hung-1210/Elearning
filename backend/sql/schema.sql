-- PostgreSQL Schema for Elearning App
-- Replaces MySQL tables.sql + all stored procedures (logic moved to backend)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables (in reverse dependency order)
DROP TABLE IF EXISTS submitted_exercise_attach_file CASCADE;
DROP TABLE IF EXISTS submitted_exercises CASCADE;
DROP TABLE IF EXISTS exercise_attach_files CASCADE;
DROP TABLE IF EXISTS exercises CASCADE;
DROP TABLE IF EXISTS meetings CASCADE;
DROP TABLE IF EXISTS class_attach_files CASCADE;
DROP TABLE IF EXISTS docs CASCADE;
DROP TABLE IF EXISTS doc_categories CASCADE;
DROP TABLE IF EXISTS classes_n_students CASCADE;
DROP TABLE IF EXISTS class_collaborators CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS user_login_id CASCADE;
DROP TABLE IF EXISTS lecturers CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    is_lecturer BOOLEAN NOT NULL DEFAULT FALSE,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(12) UNIQUE,
    email VARCHAR(100) UNIQUE,
    password VARCHAR(100) NOT NULL
);

-- User login identifiers (MSSV, email, phone, etc.)
CREATE TABLE user_login_id (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    login_id VARCHAR(100) NOT NULL UNIQUE
);

-- Lecturer role table
CREATE TABLE lecturers (
    id INTEGER PRIMARY KEY REFERENCES users(id)
);

-- Student role table
CREATE TABLE students (
    id INTEGER PRIMARY KEY REFERENCES users(id)
);

-- Refresh tokens for JWT
CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Classes
CREATE TABLE classes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    lecturer_id INTEGER NOT NULL REFERENCES lecturers(id),
    invite_code_students UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    is_open_students BOOLEAN DEFAULT TRUE
);

-- Class collaborators (co-lecturers)
CREATE TABLE class_collaborators (
    id SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    lecturer_id INTEGER NOT NULL REFERENCES lecturers(id)
);

-- Students in classes (many-to-many)
CREATE TABLE classes_n_students (
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id),
    PRIMARY KEY (class_id, student_id)
);

-- Document categories (per lecturer)
CREATE TABLE doc_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    lecturer_id INTEGER NOT NULL REFERENCES lecturers(id)
);

-- Documents
CREATE TABLE docs (
    id SERIAL PRIMARY KEY,
    file_name TEXT NOT NULL,
    doc_category_id INTEGER NOT NULL REFERENCES doc_categories(id) ON DELETE CASCADE
);

-- Files attached to a class
CREATE TABLE class_attach_files (
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    PRIMARY KEY (class_id, doc_id)
);

-- Meetings / online sessions
CREATE TABLE meetings (
    id SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    meeting_code UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4()
);

-- Exercises
CREATE TABLE exercises (
    id SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    name TEXT NOT NULL,
    description TEXT
);

-- Files attached to exercises
CREATE TABLE exercise_attach_files (
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    PRIMARY KEY (exercise_id, doc_id)
);

-- Student exercise submissions
CREATE TABLE submitted_exercises (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    submit_time TIMESTAMP DEFAULT NOW(),
    is_submitted BOOLEAN DEFAULT FALSE,
    UNIQUE(student_id, exercise_id)
);

-- Files attached to submissions
CREATE TABLE submitted_exercise_attach_file (
    id SERIAL PRIMARY KEY,
    submitted_exercises_id INTEGER NOT NULL REFERENCES submitted_exercises(id) ON DELETE CASCADE,
    file_name TEXT
);

-- Indexes for performance
CREATE INDEX idx_classes_lecturer ON classes(lecturer_id);
CREATE INDEX idx_classes_n_students_class ON classes_n_students(class_id);
CREATE INDEX idx_classes_n_students_student ON classes_n_students(student_id);
CREATE INDEX idx_exercises_class ON exercises(class_id);
CREATE INDEX idx_meetings_class ON meetings(class_id);
CREATE INDEX idx_docs_category ON docs(doc_category_id);
CREATE INDEX idx_submitted_exercises_student ON submitted_exercises(student_id);
CREATE INDEX idx_submitted_exercises_exercise ON submitted_exercises(exercise_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
