import { query, queryOne } from '../config/database.js';
import { MeetingRow, MeetingWithStatus } from '../models/types.js';

function computeStatus(startTime: Date, endTime: Date): 'not-started' | 'started' | 'ended' {
  const now = new Date();
  if (now < startTime) return 'not-started';
  if (now >= startTime && now <= endTime) return 'started';
  return 'ended';
}

function addStatusToMeeting(meeting: MeetingRow): MeetingWithStatus {
  return {
    ...meeting,
    status: computeStatus(new Date(meeting.start_time), new Date(meeting.end_time)),
  };
}

export async function createMeeting(
  classId: number,
  startTime: string,
  endTime: string,
  name: string,
  description: string
): Promise<MeetingWithStatus> {
  const row = await queryOne<MeetingRow>(
    `INSERT INTO meetings (class_id, start_time, end_time, name, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [classId, startTime, endTime, name, description]
  );
  if (!row) throw new Error('Không thể tạo buổi học');
  return addStatusToMeeting(row);
}

export async function updateMeeting(
  meetingId: number,
  startTime: string,
  endTime: string,
  name: string,
  description: string
): Promise<void> {
  await query(
    `UPDATE meetings
     SET start_time = $1, end_time = $2, name = $3, description = $4
     WHERE id = $5`,
    [startTime, endTime, name, description, meetingId]
  );
}

export async function deleteMeeting(meetingId: number): Promise<void> {
  await query('DELETE FROM meetings WHERE id = $1', [meetingId]);
}

export async function getMeetingById(meetingId: number): Promise<MeetingWithStatus | null> {
  const row = await queryOne<MeetingRow>(
    'SELECT * FROM meetings WHERE id = $1',
    [meetingId]
  );
  if (!row) return null;
  return addStatusToMeeting(row);
}

export async function getMeetingByCode(meetingCode: string): Promise<MeetingWithStatus | null> {
  const row = await queryOne<MeetingRow>(
    'SELECT * FROM meetings WHERE meeting_code = $1',
    [meetingCode]
  );
  if (!row) return null;
  return addStatusToMeeting(row);
}

export async function getAllMeetingsOfClass(classId: number): Promise<MeetingWithStatus[]> {
  const rows = await query<MeetingRow>(
    `SELECT * FROM meetings WHERE class_id = $1 ORDER BY start_time ASC`,
    [classId]
  );
  return rows.map(addStatusToMeeting);
}
