// src/sockets/attendance.socket.ts
import type { Server as SocketIOServer } from 'socket.io';

let mainIo: SocketIOServer | null = null;

export function registerMeetingIo(io: SocketIOServer) {
  mainIo = io;
}

export function getMeetingIo(): SocketIOServer | null {
  return mainIo;
}

export function emitToMeetingRoom(meetingCode: string, event: string, payload: unknown) {
  if (!mainIo || !meetingCode) return;
  mainIo.to(meetingCode).emit(event, payload);
}

