import { Request, Response } from 'express';
import * as meetingService from '../services/meeting.service.js';
import { ApiResponse } from '../models/types.js';

const p = (v: string | string[]) => parseInt(Array.isArray(v) ? v[0] : v, 10);

export async function getMeetingsOfClass(req: Request, res: Response): Promise<void> {
  try {
    const classId = p(req.params.classId);
    const meetings = await meetingService.getAllMeetingsOfClass(classId);
    res.json({ success: true, data: meetings } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getMeetingById(req: Request, res: Response): Promise<void> {
  try {
    const meetingId = p(req.params.id);
    const meeting = await meetingService.getMeetingById(meetingId);
    if (!meeting) {
      res.status(404).json({ success: false, error: 'Không tìm thấy buổi học' });
      return;
    }
    res.json({ success: true, data: meeting } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function createMeeting(req: Request, res: Response): Promise<void> {
  try {
    const { classId, name, description, startTime, endTime } = req.body;
    const meeting = await meetingService.createMeeting(
      parseInt(classId, 10), startTime, endTime, name, description ?? ''
    );
    res.status(201).json({ success: true, data: meeting } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function updateMeeting(req: Request, res: Response): Promise<void> {
  try {
    const meetingId = p(req.params.id);
    const { name, description, startTime, endTime } = req.body;
    await meetingService.updateMeeting(meetingId, startTime, endTime, name, description ?? '');
    const updated = await meetingService.getMeetingById(meetingId);
    res.json({ success: true, data: updated } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function deleteMeeting(req: Request, res: Response): Promise<void> {
  try {
    const meetingId = p(req.params.id);
    await meetingService.deleteMeeting(meetingId);
    res.json({ success: true, message: 'Xóa buổi học thành công' } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}

export async function getMeetingByCode(req: Request, res: Response): Promise<void> {
  try {
    const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    const meeting = await meetingService.getMeetingByCode(code);
    if (!meeting) {
      res.status(404).json({ success: false, error: 'Không tìm thấy phòng học' });
      return;
    }
    res.json({ success: true, data: meeting } satisfies ApiResponse);
  } catch {
    res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
  }
}
