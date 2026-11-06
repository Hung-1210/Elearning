"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMeetingsOfClass = getMeetingsOfClass;
exports.getMeetingById = getMeetingById;
exports.createMeeting = createMeeting;
exports.updateMeeting = updateMeeting;
exports.deleteMeeting = deleteMeeting;
exports.getMeetingByCode = getMeetingByCode;
const meetingService = __importStar(require("../services/meeting.service.js"));
const p = (v) => parseInt(Array.isArray(v) ? v[0] : v, 10);
async function getMeetingsOfClass(req, res) {
    try {
        const classId = p(req.params.classId);
        const meetings = await meetingService.getAllMeetingsOfClass(classId);
        res.json({ success: true, data: meetings });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getMeetingById(req, res) {
    try {
        const meetingId = p(req.params.id);
        const meeting = await meetingService.getMeetingById(meetingId);
        if (!meeting) {
            res.status(404).json({ success: false, error: 'Không tìm thấy buổi học' });
            return;
        }
        res.json({ success: true, data: meeting });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function createMeeting(req, res) {
    try {
        const { classId, name, description, startTime, endTime } = req.body;
        const meeting = await meetingService.createMeeting(parseInt(classId, 10), startTime, endTime, name, description ?? '');
        res.status(201).json({ success: true, data: meeting });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function updateMeeting(req, res) {
    try {
        const meetingId = p(req.params.id);
        const { name, description, startTime, endTime } = req.body;
        await meetingService.updateMeeting(meetingId, startTime, endTime, name, description ?? '');
        const updated = await meetingService.getMeetingById(meetingId);
        res.json({ success: true, data: updated });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function deleteMeeting(req, res) {
    try {
        const meetingId = p(req.params.id);
        await meetingService.deleteMeeting(meetingId);
        res.json({ success: true, message: 'Xóa buổi học thành công' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
async function getMeetingByCode(req, res) {
    try {
        const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
        const meeting = await meetingService.getMeetingByCode(code);
        if (!meeting) {
            res.status(404).json({ success: false, error: 'Không tìm thấy phòng học' });
            return;
        }
        res.json({ success: true, data: meeting });
    }
    catch {
        res.status(500).json({ success: false, error: 'Lỗi máy chủ' });
    }
}
//# sourceMappingURL=meeting.controller.js.map