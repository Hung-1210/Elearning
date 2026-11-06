import { MeetingWithStatus } from '../models/types.js';
export declare function createMeeting(classId: number, startTime: string, endTime: string, name: string, description: string): Promise<MeetingWithStatus>;
export declare function updateMeeting(meetingId: number, startTime: string, endTime: string, name: string, description: string): Promise<void>;
export declare function deleteMeeting(meetingId: number): Promise<void>;
export declare function getMeetingById(meetingId: number): Promise<MeetingWithStatus | null>;
export declare function getMeetingByCode(meetingCode: string): Promise<MeetingWithStatus | null>;
export declare function getAllMeetingsOfClass(classId: number): Promise<MeetingWithStatus[]>;
//# sourceMappingURL=meeting.service.d.ts.map