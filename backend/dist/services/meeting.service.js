"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMeeting = createMeeting;
exports.updateMeeting = updateMeeting;
exports.deleteMeeting = deleteMeeting;
exports.getMeetingById = getMeetingById;
exports.getMeetingByCode = getMeetingByCode;
exports.getAllMeetingsOfClass = getAllMeetingsOfClass;
const database_js_1 = require("../config/database.js");
function computeStatus(startTime, endTime) {
    const now = new Date();
    if (now < startTime)
        return 'not-started';
    if (now >= startTime && now <= endTime)
        return 'started';
    return 'ended';
}
function addStatusToMeeting(meeting) {
    return {
        ...meeting,
        status: computeStatus(new Date(meeting.start_time), new Date(meeting.end_time)),
    };
}
async function createMeeting(classId, startTime, endTime, name, description) {
    const row = await (0, database_js_1.queryOne)(`INSERT INTO meetings (class_id, start_time, end_time, name, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`, [classId, startTime, endTime, name, description]);
    if (!row)
        throw new Error('Không thể tạo buổi học');
    return addStatusToMeeting(row);
}
async function updateMeeting(meetingId, startTime, endTime, name, description) {
    await (0, database_js_1.query)(`UPDATE meetings
     SET start_time = $1, end_time = $2, name = $3, description = $4
     WHERE id = $5`, [startTime, endTime, name, description, meetingId]);
}
async function deleteMeeting(meetingId) {
    await (0, database_js_1.query)('DELETE FROM meetings WHERE id = $1', [meetingId]);
}
async function getMeetingById(meetingId) {
    const row = await (0, database_js_1.queryOne)('SELECT * FROM meetings WHERE id = $1', [meetingId]);
    if (!row)
        return null;
    return addStatusToMeeting(row);
}
async function getMeetingByCode(meetingCode) {
    const row = await (0, database_js_1.queryOne)('SELECT * FROM meetings WHERE meeting_code = $1', [meetingCode]);
    if (!row)
        return null;
    return addStatusToMeeting(row);
}
async function getAllMeetingsOfClass(classId) {
    const rows = await (0, database_js_1.query)(`SELECT * FROM meetings WHERE class_id = $1 ORDER BY start_time ASC`, [classId]);
    return rows.map(addStatusToMeeting);
}
//# sourceMappingURL=meeting.service.js.map