import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff, FiMonitor, FiMessageSquare,
  FiUsers, FiPhoneOff, FiX, FiSend, FiCopy, FiCheck,
} from 'react-icons/fi';
import { MdOutlinePanTool, MdPanTool, MdPushPin, MdOutlinePushPin } from 'react-icons/md';
import { useAuthStore } from '../../store/authStore';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';
const ICE_SERVERS: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ── Types ────────────────────────────────────────────────────
interface Participant {
  socketId: string;
  userId: string;
  userName: string;
}

interface ChatMessage {
  sender: string;
  text: string;
  isOwn: boolean;
  timestamp: number;
}

interface DataChannelMessage {
  type: 'MESSAGE' | 'CAMERA_OFF' | 'CAMERA_ON' | 'MIC_OFF' | 'MIC_ON' | 'SCREEN_SHARING_STARTED' | 'SCREEN_SHARING_STOPPED' | 'RISE_HAND' | 'LOWER_HAND';
  sender?: string;
  message?: string;
}

// ── Placeholder Track Utilities ──────────────────────────────
const placeholderTracks = new WeakSet<MediaStreamTrack>();

function createPlaceholderVideoTrack(): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1A1A2E';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Draw a subtle icon in the center
  ctx.fillStyle = '#2D2D4A';
  ctx.beginPath();
  ctx.arc(320, 240, 60, 0, Math.PI * 2);
  ctx.fill();
  const stream = canvas.captureStream(1);
  const track = stream.getVideoTracks()[0];
  placeholderTracks.add(track);
  return track;
}

function createSilentAudioTrack(): MediaStreamTrack {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const dst = ctx.createMediaStreamDestination();
  oscillator.connect(dst);
  oscillator.start();
  const track = dst.stream.getAudioTracks()[0];
  track.enabled = false; // silent
  placeholderTracks.add(track);
  return track;
}

function isPlaceholderTrack(track: MediaStreamTrack): boolean {
  return placeholderTracks.has(track);
}

// ── Main Component ───────────────────────────────────────────
export default function MeetingRoom() {
  const { classId, meetingCode } = useParams<{ classId: string; meetingCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Refs for mutable state that shouldn't trigger re-renders
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // UI state
  const [peerStreams, setPeerStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [peerNames, setPeerNames] = useState<Map<string, string>>(new Map());
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [peerCamOff, setPeerCamOff] = useState<Set<string>>(new Set());
  const [pinnedPeer, setPinnedPeer] = useState<string | null>(null);
  const [peerSharing, setPeerSharing] = useState<Set<string>>(new Set());
  const [peerMicOff, setPeerMicOff] = useState<Set<string>>(new Set());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [copied, setCopied] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const micOnRef = useRef(true);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const [unreadChat, setUnreadChat] = useState(0);

  // Refs phản chiếu state để dùng trong callback bất đồng bộ (tránh stale closure)
  const camOnRef = useRef(true);
  const handRaisedRef = useRef(false);
  const chatOpenRef = useRef(false);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  useEffect(() => { camOnRef.current = camOn; }, [camOn]);
  useEffect(() => { handRaisedRef.current = handRaised; }, [handRaised]);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setUnreadChat(0); }, [chatOpen]);

  const flushPendingCandidates = async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(peerId);
    if (!queued?.length) return;
    pendingCandidatesRef.current.delete(peerId);
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); }
      catch (err) { console.error('flush addIceCandidate failed:', err); }
    }
  };

  // ── Broadcast Data via DataChannels ────────────────────────
  const broadcastData = useCallback((data: DataChannelMessage) => {
    const json = JSON.stringify(data);
    dataChannelsRef.current.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(json);
      }
    });
  }, []);

  // ── Handle DataChannel Messages ────────────────────────────
  const handleDataChannelMessage = useCallback((peerId: string, event: MessageEvent) => {
    const msg: DataChannelMessage = JSON.parse(event.data);
    switch (msg.type) {
      case 'MESSAGE':
        setChatMessages(prev => [...prev, {
          sender: msg.sender || peerId.slice(0, 6),
          text: msg.message || '',
          isOwn: false,
          timestamp: Date.now(),
        }]);
        break;
      case 'CAMERA_OFF':
        setPeerCamOff(prev => new Set(prev).add(peerId));
        break;
      case 'CAMERA_ON':
        setPeerCamOff(prev => { const s = new Set(prev); s.delete(peerId); return s; });
        break;
      case 'MIC_OFF':
        setPeerMicOff(prev => new Set(prev).add(peerId));
        break;
      case 'MIC_ON':
        setPeerMicOff(prev => { const s = new Set(prev); s.delete(peerId); return s; });
        break;
      case 'SCREEN_SHARING_STARTED':
        setPeerSharing(prev => new Set(prev).add(peerId));
        setPinnedPeer(peerId);
        break;
      case 'SCREEN_SHARING_STOPPED':
        setPeerSharing(prev => { const s = new Set(prev); s.delete(peerId); return s; });
        setPinnedPeer(prev => prev === peerId ? null : prev);
        break;
      case 'RISE_HAND':
        setRaisedHands(prev => new Set(prev).add(peerId));
        break;
      case 'LOWER_HAND':
        setRaisedHands(prev => { const s = new Set(prev); s.delete(peerId); return s; });
        break;
    }
  }, []);

  // ── Create Peer Connection ─────────────────────────────────
  const createPeer = useCallback((peerId: string, sock: Socket, stream: MediaStream, isInitiator: boolean): RTCPeerConnection => {
    // Prevent duplicate peer connections
    if (peersRef.current.has(peerId)) {
      peersRef.current.get(peerId)!.close();
      peersRef.current.delete(peerId);
      dataChannelsRef.current.delete(peerId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current.set(peerId, pc);

    // Add local tracks
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    // DataChannel setup
    const setupDataChannel = (dc: RTCDataChannel) => {
      dataChannelsRef.current.set(peerId, dc);
      dc.onmessage = (e) => handleDataChannelMessage(peerId, e);
      // Khi kênh mở, gửi trạng thái hiện tại để người kia hiển thị đúng ngay
      dc.onopen = () => {
        if (!camOnRef.current) dc.send(JSON.stringify({ type: 'CAMERA_OFF' }));
        if (!micOnRef.current) dc.send(JSON.stringify({ type: 'MIC_OFF' }));
        if (handRaisedRef.current) dc.send(JSON.stringify({ type: 'RISE_HAND' }));
        if (screenStreamRef.current) dc.send(JSON.stringify({ type: 'SCREEN_SHARING_STARTED' }));
      };
    };
    if (isInitiator) {
      setupDataChannel(pc.createDataChannel('data-channel'));
    } else {
      pc.ondatachannel = (e) => setupDataChannel(e.channel);
    }

    // ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) sock.emit('candidate', peerId, e.candidate);
    };

    // Remote tracks (audio + video cùng một stream)
    pc.ontrack = (e) => {
      const remote = e.streams[0] ?? new MediaStream([e.track]);
      setPeerStreams(prev => {
        const m = new Map(prev);
        m.set(peerId, remote);
        return m;
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pc.close();
        peersRef.current.delete(peerId);
        dataChannelsRef.current.delete(peerId);
        setPeerStreams(prev => { const m = new Map(prev); m.delete(peerId); return m; });
      }
    };

    return pc;
  }, [handleDataChannelMessage]);

  // ── Replace Track in All Peers (with addTrack fallback) ────
  const replaceTrackInPeers = useCallback((newTrack: MediaStreamTrack, kind: 'video' | 'audio' = 'video') => {
    peersRef.current.forEach((pc) => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === kind);
      if (sender) {
        sender.replaceTrack(newTrack).catch(err => console.error('replaceTrack failed:', err));
      } else {
        // No sender for this kind yet — add the track
        const stream = localStreamRef.current;
        if (stream) {
          try { pc.addTrack(newTrack, stream); } catch (e) { console.error('addTrack failed:', e); }
        }
      }
    });
  }, []);

  // ── Connect Socket & Start WebRTC ─────────────────────────
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Get local media — ALWAYS ensure stream has video+audio tracks
      // (even if placeholders) so SDP has media descriptions for peer connections
      let stream: MediaStream;
      let hasRealVideo = false;
      let hasRealAudio = false;

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        hasRealVideo = true;
        hasRealAudio = true;
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          hasRealAudio = true;
        } catch {
          stream = new MediaStream();
        }
      }

      // Add placeholder tracks for any missing kind so peer connections have senders
      if (!hasRealVideo) {
        stream.addTrack(createPlaceholderVideoTrack());
      }
      if (!hasRealAudio) {
        stream.addTrack(createSilentAudioTrack());
      }

      if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCamOn(hasRealVideo);
      setMicOn(hasRealAudio);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // Connect socket
      const sock = io(SOCKET_URL, { withCredentials: true });
      socketRef.current = sock;

      sock.on('connect', () => {
        if (!mounted) return;
        // Join room with socket.id as the signaling ID, plus user info for display
        sock.emit('join-room', meetingCode, user?.userId?.toString() || sock.id, user?.name || 'Ẩn danh');
      });

      // Receive updated participant list from server
      sock.on('room-participants', (list: Participant[]) => {
        if (!mounted) return;
        setParticipants(list);
        // Build name map
        const nm = new Map<string, string>();
        list.forEach(p => nm.set(p.socketId, p.userName));
        setPeerNames(nm);
      });

      // New peer joined — we are the initiator (create offer)
      sock.on('user-connected', async (peerSocketId: string, peerName: string) => {
        if (!mounted || !localStreamRef.current) return;
        setPeerNames(prev => new Map(prev).set(peerSocketId, peerName));

        const pc = createPeer(peerSocketId, sock, localStreamRef.current!, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sock.emit('offer', peerSocketId, offer);
      });

      // Received offer — we are the answerer
      sock.on('offer', async (fromSocketId: string, offer: RTCSessionDescriptionInit) => {
        if (!mounted || !localStreamRef.current) return;
        try {
          const pc = createPeer(fromSocketId, sock, localStreamRef.current!, false);
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          await flushPendingCandidates(fromSocketId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sock.emit('answer', fromSocketId, answer);
        } catch (err) {
          console.error('Handle offer failed:', err);
        }
      });

      // Received answer
      sock.on('answer', async (fromSocketId: string, answer: RTCSessionDescriptionInit) => {
        if (!mounted) return;
        const pc = peersRef.current.get(fromSocketId);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await flushPendingCandidates(fromSocketId, pc);
        } catch (err) {
          console.error('Handle answer failed:', err);
        }
      });

      // ICE candidate (có thể đến trước khi remoteDescription được set → xếp hàng)
      sock.on('candidate', async (fromSocketId: string, candidate: RTCIceCandidateInit) => {
        if (!mounted) return;
        const pc = peersRef.current.get(fromSocketId);
        if (!pc || !pc.remoteDescription) {
          const q = pendingCandidatesRef.current.get(fromSocketId) ?? [];
          q.push(candidate);
          pendingCandidatesRef.current.set(fromSocketId, q);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('addIceCandidate failed:', err);
        }
      });

      // Chat qua socket (không phụ thuộc DataChannel)
      sock.on('chat-message', (m: { sender: string; text: string; timestamp: number }) => {
        if (!mounted) return;
        setChatMessages(prev => [...prev, {
          sender: m.sender,
          text: m.text,
          isOwn: false,
          timestamp: m.timestamp || Date.now(),
        }]);
        setUnreadChat(prev => (chatOpenRef.current ? 0 : prev + 1));
      });

      // Peer disconnected
      sock.on('user-disconnected', (peerSocketId: string) => {
        if (!mounted) return;
        peersRef.current.get(peerSocketId)?.close();
        peersRef.current.delete(peerSocketId);
        dataChannelsRef.current.delete(peerSocketId);
        pendingCandidatesRef.current.delete(peerSocketId);
        setPeerStreams(prev => { const m = new Map(prev); m.delete(peerSocketId); return m; });
        setPeerCamOff(prev => { const s = new Set(prev); s.delete(peerSocketId); return s; });
        setPeerSharing(prev => { const s = new Set(prev); s.delete(peerSocketId); return s; });
        setPeerMicOff(prev => { const s = new Set(prev); s.delete(peerSocketId); return s; });
        setRaisedHands(prev => { const s = new Set(prev); s.delete(peerSocketId); return s; });
        setPinnedPeer(prev => prev === peerSocketId ? null : prev);
      });
    };

    init();

    return () => {
      mounted = false;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      peersRef.current.forEach(pc => pc.close());
      socketRef.current?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Control Handlers ───────────────────────────────────────
  const toggleMic = async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const audioTrack = stream.getAudioTracks()[0];

    if (audioTrack && !isPlaceholderTrack(audioTrack)) {
      // Has real mic — just toggle enabled
      audioTrack.enabled = !audioTrack.enabled;
      setMicOn(audioTrack.enabled);
      broadcastData({ type: audioTrack.enabled ? 'MIC_ON' : 'MIC_OFF' });
    } else {
      // Currently placeholder or no audio → try to get real mic
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newAudioTrack = newStream.getAudioTracks()[0];
        // Remove old placeholder
        stream.getAudioTracks().forEach(t => { stream.removeTrack(t); t.stop(); });
        stream.addTrack(newAudioTrack);
        replaceTrackInPeers(newAudioTrack, 'audio');
        setMicOn(true);
        broadcastData({ type: 'MIC_ON' });
      } catch (err) {
        console.error('Cannot enable mic:', err);
      }
    }
  };

  const toggleCam = async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const videoTrack = stream.getVideoTracks()[0];

    if (videoTrack && !isPlaceholderTrack(videoTrack)) {
      // Turn off camera → replace with placeholder
      videoTrack.stop();
      const placeholder = createPlaceholderVideoTrack();
      stream.removeTrack(videoTrack);
      stream.addTrack(placeholder);
      replaceTrackInPeers(placeholder, 'video');
      broadcastData({ type: 'CAMERA_OFF' });
      setCamOn(false);
    } else {
      // Turn on camera → get new video track
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = newStream.getVideoTracks()[0];
        stream.getVideoTracks().forEach(t => { stream.removeTrack(t); t.stop(); });
        stream.addTrack(newVideoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        replaceTrackInPeers(newVideoTrack, 'video');
        broadcastData({ type: 'CAMERA_ON' });
        setCamOn(true);
      } catch (err) {
        console.error('Cannot enable camera:', err);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!screenStreamRef.current) {
      // Start sharing
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;

        const screenTrack = screenStream.getVideoTracks()[0];
        screenTrack.onended = () => stopScreenSharing();

        // Replace video track in all peers
        replaceTrackInPeers(screenTrack);
        // Hiển thị màn hình đang chia sẻ ngay trên tile của mình
        if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;
        broadcastData({ type: 'SCREEN_SHARING_STARTED' });
        setScreenSharing(true);
      } catch (err) {
        console.error('Screen sharing failed:', err);
      }
    } else {
      stopScreenSharing();
    }
  };

  const stopScreenSharing = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;

      // Restore camera track
      const stream = localStreamRef.current;
      if (stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) replaceTrackInPeers(videoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }

      broadcastData({ type: 'SCREEN_SHARING_STOPPED' });
      setScreenSharing(false);
    }
  };

  const toggleHand = () => {
    if (handRaised) {
      broadcastData({ type: 'LOWER_HAND' });
      setHandRaised(false);
    } else {
      broadcastData({ type: 'RISE_HAND' });
      setHandRaised(true);
    }
  };

  const sendChatMessage = () => {
    const text = chatInputRef.current?.value?.trim();
    if (!text) return;

    const senderName = user?.name || 'Bạn';
    socketRef.current?.emit('chat-message', text);
    setChatMessages(prev => [...prev, {
      sender: senderName,
      text,
      isOwn: true,
      timestamp: Date.now(),
    }]);
    if (chatInputRef.current) chatInputRef.current.value = '';
  };

  const leaveRoom = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    peersRef.current.forEach(pc => pc.close());
    socketRef.current?.disconnect();
    navigate(`/class/${classId}`);
  };

  // ── Đo kích thước vùng hiển thị để chia lưới vừa khít (không cuộn) ──
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStageSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const copyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* trình duyệt chặn clipboard */ }
  };

  // ── Dựng danh sách tile ────────────────────────────────────
  const SELF_ID = '__self';
  const selfName = user?.name || 'Bạn';
  const selfStream = screenSharing ? screenStreamRef.current : localStream;

  interface TileInfo {
    id: string; name: string; stream: MediaStream | null; isSelf: boolean;
    showVideo: boolean; micOff: boolean; handUp: boolean; presenting: boolean;
  }

  const peerTiles: TileInfo[] = Array.from(peerStreams.entries()).map(([id, stream]) => ({
    id,
    name: peerNames.get(id) || `User ${id.slice(0, 6)}`,
    stream,
    isSelf: false,
    showVideo: !peerCamOff.has(id) || peerSharing.has(id),
    micOff: peerMicOff.has(id),
    handUp: raisedHands.has(id),
    presenting: peerSharing.has(id),
  }));
  // Người giơ tay / đang trình bày lên trước
  peerTiles.sort((a, b) => {
    const wa = (a.presenting ? 2 : 0) + (a.handUp ? 1 : 0);
    const wb = (b.presenting ? 2 : 0) + (b.handUp ? 1 : 0);
    return wb - wa;
  });
  const selfTile: TileInfo = {
    id: SELF_ID, name: `${selfName} (Bạn)`, stream: selfStream, isSelf: true,
    showVideo: camOn || screenSharing, micOff: !micOn, handUp: handRaised, presenting: screenSharing,
  };
  const allTiles: TileInfo[] = [...peerTiles, selfTile];

  const mainId = pinnedPeer && allTiles.some(t => t.id === pinnedPeer)
    ? pinnedPeer
    : (screenSharing ? SELF_ID : null);
  const presenter = allTiles.find(t => t.presenting);
  const totalPeople = participants.length || allTiles.length;

  // ── Tính lưới vừa khít cho chế độ lưới ─────────────────────
  const GAP = 8;
  const MAX_TILES = 16;
  const RATIO = 16 / 9;
  const overflowCount = Math.max(0, allTiles.length - MAX_TILES);
  const visibleTiles = overflowCount > 0 ? allTiles.slice(0, MAX_TILES - 1).concat(
    allTiles.some((t, i) => i >= MAX_TILES - 1 && t.isSelf) ? [selfTile] : [],
  ) : allTiles;
  const hiddenCount = allTiles.length - visibleTiles.length;
  const slotCount = visibleTiles.length + (hiddenCount > 0 ? 1 : 0);

  const computeGrid = (n: number, W: number, H: number) => {
    let best = { cols: 1, tw: 0, th: 0 };
    if (W <= 0 || H <= 0 || n <= 0) return best;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cw = (W - GAP * (cols - 1)) / cols;
      const ch = (H - GAP * (rows - 1)) / rows;
      const tw = Math.min(cw, ch * RATIO);
      if (tw > best.tw) best = { cols, tw, th: tw / RATIO };
    }
    return best;
  };
  const grid = computeGrid(slotCount, stageSize.w, stageSize.h);
  const gridWidth = grid.cols * grid.tw + (grid.cols - 1) * GAP;

  const renderTile = (t: TileInfo, style?: CSSProperties) => (
    <VideoTile
      key={t.id}
      name={t.name}
      stream={t.stream}
      isSelf={t.isSelf}
      showVideo={t.showVideo}
      micOff={t.micOff}
      handUp={t.handUp}
      presenting={t.presenting}
      pinned={mainId === t.id}
      onTogglePin={() => setPinnedPeer(prev => (prev === t.id ? null : t.id))}
      style={style}
    />
  );

  const mainTile = mainId ? allTiles.find(t => t.id === mainId) : null;
  const sideTiles = mainId ? allTiles.filter(t => t.id !== mainId) : [];
  const panelOpen = chatOpen || showParticipants;
  const timeLabel = clock.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="gm-root">
      <div className="gm-body">
        {/* ── Vùng hiển thị video ──────────────────────────── */}
        <div className="gm-stage" ref={stageRef}>
          {presenter && (
            <div className="gm-present-chip">
              {presenter.isSelf ? 'Bạn đang trình bày' : `${presenter.name} đang trình bày`}
            </div>
          )}

          {mainTile ? (
            <div className="gm-present-layout">
              <div className="gm-present-main">{renderTile(mainTile, { width: '100%', height: '100%' })}</div>
              <div className="gm-present-side">
                {sideTiles.map(t => renderTile(t, { width: '100%', aspectRatio: '16 / 9' }))}
              </div>
            </div>
          ) : (
            <div className="gm-grid" style={{ width: gridWidth > 0 ? gridWidth : '100%' }}>
              {visibleTiles.map(t => renderTile(t, { width: grid.tw, height: grid.th }))}
              {hiddenCount > 0 && (
                <div className="gm-tile gm-more" style={{ width: grid.tw, height: grid.th }}>
                  <div className="gm-more-avatar">+{hiddenCount}</div>
                  <div className="gm-more-text">{hiddenCount} người khác</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Panel bên phải (Chat / Người tham gia) ───────── */}
        {panelOpen && (
          <aside className="gm-panel">
            <div className="gm-panel-header">
              <h3>{chatOpen ? 'Tin nhắn trong cuộc họp' : 'Mọi người'}</h3>
              <button type="button" className="gm-icon-btn-plain" onClick={() => { setChatOpen(false); setShowParticipants(false); }} aria-label="Đóng">
                <FiX size={20} />
              </button>
            </div>

            {chatOpen && (
              <>
                <div className="gm-chat-note">Tin nhắn chỉ hiển thị với người đang ở trong cuộc họp và sẽ mất khi bạn rời phòng.</div>
                <div className="gm-chat-list">
                  {chatMessages.length === 0 && (
                    <div className="gm-chat-empty">Chưa có tin nhắn nào</div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className="gm-chat-item">
                      <div className="gm-chat-meta">
                        <strong>{msg.isOwn ? 'Bạn' : msg.sender}</strong>
                        <span>{new Date(msg.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="gm-chat-text">{msg.text}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form className="gm-chat-form" onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }}>
                  <input ref={chatInputRef} type="text" placeholder="Gửi tin nhắn" autoComplete="off" />
                  <button type="submit" className="gm-chat-send" aria-label="Gửi"><FiSend size={18} /></button>
                </form>
              </>
            )}

            {showParticipants && (
              <div className="gm-people-list">
                <div className="gm-people-title">Trong cuộc họp ({totalPeople})</div>
                {participants.map(p => {
                  const isMe = p.socketId === socketRef.current?.id;
                  const muted = isMe ? !micOn : peerMicOff.has(p.socketId);
                  return (
                    <div key={p.socketId} className="gm-person">
                      <div className="gm-person-avatar" style={{ background: colorFor(p.userName).avatar }}>
                        {initialOf(p.userName)}
                      </div>
                      <span className="gm-person-name">{p.userName}{isMe ? ' (Bạn)' : ''}</span>
                      {(isMe ? handRaised : raisedHands.has(p.socketId)) && <MdPanTool size={16} color="#f9ab00" />}
                      {muted ? <FiMicOff size={16} color="#5f6368" /> : <FiMic size={16} color="#5f6368" />}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ── Thanh điều khiển ───────────────────────────────── */}
      <footer className="gm-bar">
        <div className="gm-bar-left">
          <span>{timeLabel}</span>
          <span className="gm-bar-sep">|</span>
          <span className="gm-bar-code" title={meetingCode}>{meetingCode?.slice(0, 12)}</span>
          <button type="button" className="gm-icon-btn-plain" onClick={copyMeetingLink} title="Sao chép liên kết cuộc họp">
            {copied ? <FiCheck size={16} /> : <FiCopy size={16} />}
          </button>
        </div>

        <div className="gm-bar-center">
          <button type="button" className={`gm-btn ${!micOn ? 'is-off' : ''}`} onClick={toggleMic} title={micOn ? 'Tắt micrô' : 'Bật micrô'}>
            {micOn ? <FiMic size={20} /> : <FiMicOff size={20} />}
          </button>
          <button type="button" className={`gm-btn ${!camOn ? 'is-off' : ''}`} onClick={toggleCam} disabled={screenSharing} title={camOn ? 'Tắt camera' : 'Bật camera'}>
            {camOn ? <FiVideo size={20} /> : <FiVideoOff size={20} />}
          </button>
          <button type="button" className={`gm-btn ${screenSharing ? 'is-active' : ''}`} onClick={toggleScreenShare} title={screenSharing ? 'Dừng trình bày' : 'Trình bày ngay bây giờ'}>
            <FiMonitor size={20} />
          </button>
          <button type="button" className={`gm-btn ${handRaised ? 'is-active' : ''}`} onClick={toggleHand} title={handRaised ? 'Hạ tay xuống' : 'Giơ tay'}>
            {handRaised ? <MdPanTool size={22} /> : <MdOutlinePanTool size={22} />}
          </button>
          <button type="button" className="gm-btn gm-btn-leave" onClick={leaveRoom} title="Rời khỏi cuộc họp">
            <FiPhoneOff size={22} />
          </button>
        </div>

        <div className="gm-bar-right">
          <button type="button" className={`gm-btn-side ${showParticipants ? 'is-active' : ''}`}
            onClick={() => { setShowParticipants(!showParticipants); setChatOpen(false); }} title="Mọi người">
            <FiUsers size={20} />
            <span className="gm-badge gm-badge-count">{totalPeople}</span>
          </button>
          <button type="button" className={`gm-btn-side ${chatOpen ? 'is-active' : ''}`}
            onClick={() => { setChatOpen(!chatOpen); setShowParticipants(false); }} title="Trò chuyện với mọi người">
            <FiMessageSquare size={20} />
            {unreadChat > 0 && !chatOpen && <span className="gm-badge gm-badge-unread">{unreadChat}</span>}
          </button>
        </div>
      </footer>

      <style>{meetingStyles}</style>
    </div>
  );
}

// ── Màu avatar / nền tile theo tên (giống Google Meet) ───────
const TILE_COLORS = [
  { bg: 'radial-gradient(circle at 50% 40%, #a8421c, #5e2410)', avatar: '#f4511e' },
  { bg: 'radial-gradient(circle at 50% 40%, #15518f, #0b2d52)', avatar: '#1a73e8' },
  { bg: 'radial-gradient(circle at 50% 40%, #0f7a86, #084a52)', avatar: '#12a4af' },
  { bg: 'radial-gradient(circle at 50% 40%, #2f7a2f, #1a4a1a)', avatar: '#34a853' },
  { bg: 'radial-gradient(circle at 50% 40%, #6a3a99, #3a2054)', avatar: '#8e44ad' },
  { bg: 'radial-gradient(circle at 50% 40%, #7a6a1c, #4a410f)', avatar: '#c9a227' },
  { bg: 'radial-gradient(circle at 50% 40%, #9a3562, #5a1f3a)', avatar: '#d81b60' },
];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}
function initialOf(name: string) {
  return (name.trim()[0] || '?').toUpperCase();
}

// ── Video Tile (dùng cho cả mình và người khác) ──────────────
function VideoTile({ name, stream, isSelf, showVideo, micOff, handUp, presenting, pinned, onTogglePin, style }: {
  name: string;
  stream: MediaStream | null;
  isSelf: boolean;
  showVideo: boolean;
  micOff: boolean;
  handUp: boolean;
  presenting: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => { /* autoplay bị chặn */ });
  }, [stream]);

  const palette = colorFor(name);
  const mirrored = isSelf && !presenting;

  return (
    <div
      className={`gm-tile ${handUp ? 'is-hand' : ''} ${pinned ? 'is-pinned' : ''}`}
      style={{ ...style, background: palette.bg }}
      onDoubleClick={onTogglePin}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isSelf}
        style={{
          opacity: showVideo ? 1 : 0,
          objectFit: presenting ? 'contain' : 'cover',
          transform: mirrored ? 'scaleX(-1)' : 'none',
          background: presenting ? '#000' : 'transparent',
        }}
      />
      {!showVideo && (
        <div className="gm-avatar" style={{ background: palette.avatar }}>{initialOf(name)}</div>
      )}

      {handUp && <div className="gm-hand-chip"><MdPanTool size={16} /></div>}
      {micOff && <div className="gm-mic-chip"><FiMicOff size={14} /></div>}

      <button type="button" className="gm-pin-btn" onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
        title={pinned ? 'Bỏ ghim' : 'Ghim'}>
        {pinned ? <MdPushPin size={20} /> : <MdOutlinePushPin size={20} />}
      </button>

      <div className="gm-name">{name}</div>
    </div>
  );
}

// ── Styles (phong cách Google Meet) ──────────────────────────
const meetingStyles = `
  .gm-root {
    width: 100vw; height: 100vh; background: #202124; color: #fff;
    display: flex; flex-direction: column; overflow: hidden;
    font-family: 'Google Sans', 'Segoe UI', Roboto, Arial, sans-serif;
  }
  .gm-body { flex: 1; min-height: 0; display: flex; gap: 8px; padding: 8px 8px 0; }
  .gm-stage { flex: 1; min-width: 0; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; }

  /* Lưới video: tile vừa khít, canh giữa */
  .gm-grid { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-content: center; max-width: 100%; max-height: 100%; }

  /* Chế độ trình bày / ghim */
  .gm-present-layout { display: flex; gap: 8px; width: 100%; height: 100%; }
  .gm-present-main { flex: 1; min-width: 0; height: 100%; }
  .gm-present-side {
    width: 300px; flex-shrink: 0; overflow-y: auto; height: 100%;
    display: grid; grid-template-columns: 1fr; align-content: start; gap: 8px; padding-right: 2px;
  }
  .gm-present-side::-webkit-scrollbar { width: 6px; }
  .gm-present-side::-webkit-scrollbar-thumb { background: #5f6368; border-radius: 3px; }
  @media (min-width: 1400px) { .gm-present-side { width: 340px; grid-template-columns: 1fr 1fr; } }
  .gm-present-chip {
    position: absolute; top: 10px; left: 10px; z-index: 5;
    background: rgba(32,33,36,0.85); color: #fff; padding: 6px 14px; border-radius: 18px;
    font-size: 13px; font-weight: 500; backdrop-filter: blur(6px);
  }

  /* Tile */
  .gm-tile {
    position: relative; border-radius: 12px; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid transparent; box-sizing: border-box; flex-shrink: 0;
  }
  .gm-tile video { position: absolute; inset: 0; width: 100%; height: 100%; transition: opacity .2s; }
  .gm-tile.is-hand { border-color: #f9ab00; }
  .gm-tile.is-pinned { border-color: #8ab4f8; }
  .gm-avatar {
    position: relative; z-index: 1;
    width: 22%; max-width: 110px; min-width: 44px; aspect-ratio: 1; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: clamp(20px, 3.2vw, 44px); font-weight: 500; color: #fff;
  }
  .gm-name {
    position: absolute; left: 12px; bottom: 8px; z-index: 2; max-width: 75%;
    font-size: 13px; font-weight: 500; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.8);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .gm-mic-chip {
    position: absolute; top: 8px; right: 8px; z-index: 2;
    width: 26px; height: 26px; border-radius: 50%; background: rgba(32,33,36,.75);
    display: flex; align-items: center; justify-content: center; color: #fff;
  }
  .gm-hand-chip {
    position: absolute; top: 8px; left: 8px; z-index: 2;
    width: 28px; height: 28px; border-radius: 50%; background: #fff; color: #f9ab00;
    display: flex; align-items: center; justify-content: center;
  }
  .gm-pin-btn {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 3;
    width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer;
    background: rgba(32,33,36,.75); color: #fff; display: none; align-items: center; justify-content: center;
  }
  .gm-pin-btn:hover { background: rgba(60,64,67,.95); }
  .gm-tile:hover .gm-pin-btn { display: flex; }
  .gm-more { background: #3c4043 !important; flex-direction: column; gap: 8px; }
  .gm-more-avatar {
    width: 64px; height: 64px; border-radius: 50%; background: #5f6368;
    display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 500;
  }
  .gm-more-text { font-size: 14px; color: #e8eaed; }

  /* Panel bên phải */
  .gm-panel {
    width: 360px; flex-shrink: 0; background: #fff; color: #202124;
    border-radius: 16px; display: flex; flex-direction: column; overflow: hidden;
    margin-bottom: 8px;
  }
  .gm-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 12px 8px 24px; }
  .gm-panel-header h3 { margin: 0; font-size: 18px; font-weight: 500; }
  .gm-icon-btn-plain {
    background: transparent; border: none; color: inherit; cursor: pointer;
    width: 36px; height: 36px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  }
  .gm-icon-btn-plain:hover { background: rgba(128,128,128,.2); }
  .gm-chat-note {
    margin: 4px 16px 8px; padding: 10px 14px; background: #f1f3f4; border-radius: 8px;
    font-size: 12px; color: #5f6368; text-align: center;
  }
  .gm-chat-list { flex: 1; overflow-y: auto; padding: 8px 20px; display: flex; flex-direction: column; gap: 14px; }
  .gm-chat-empty { margin: auto; color: #80868b; font-size: 14px; }
  .gm-chat-meta { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .gm-chat-meta strong { font-weight: 600; }
  .gm-chat-meta span { color: #5f6368; font-size: 12px; }
  .gm-chat-text { font-size: 14px; margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
  .gm-chat-form {
    margin: 8px 16px 16px; display: flex; align-items: center; gap: 4px;
    background: #f1f3f4; border-radius: 24px; padding: 4px 6px 4px 18px;
  }
  .gm-chat-form input { flex: 1; border: none; background: transparent; outline: none; font-size: 14px; padding: 10px 0; color: #202124; }
  .gm-chat-send {
    width: 38px; height: 38px; border-radius: 50%; border: none; background: transparent; color: #1a73e8; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .gm-chat-send:hover { background: rgba(26,115,232,.1); }
  .gm-people-list { flex: 1; overflow-y: auto; padding: 4px 12px 16px; }
  .gm-people-title { font-size: 13px; color: #5f6368; padding: 8px 12px; font-weight: 500; }
  .gm-person { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; }
  .gm-person:hover { background: #f1f3f4; }
  .gm-person-avatar {
    width: 36px; height: 36px; border-radius: 50%; color: #fff; font-weight: 500;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .gm-person-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Thanh điều khiển */
  .gm-bar { height: 80px; flex-shrink: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 16px; }
  .gm-bar-left { display: flex; align-items: center; gap: 10px; font-size: 14px; color: #e8eaed; min-width: 0; }
  .gm-bar-left .gm-icon-btn-plain { color: #bdc1c6; width: 30px; height: 30px; }
  .gm-bar-sep { color: #5f6368; }
  .gm-bar-code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm-bar-center { display: flex; align-items: center; gap: 10px; }
  .gm-bar-right { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
  .gm-btn {
    width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer;
    background: #3c4043; color: #e8eaed; display: flex; align-items: center; justify-content: center;
    transition: background .15s, border-radius .15s;
  }
  .gm-btn:hover:not(:disabled) { background: #4a4e51; }
  .gm-btn:disabled { opacity: .45; cursor: not-allowed; }
  .gm-btn.is-off { background: #ea4335; color: #fff; }
  .gm-btn.is-off:hover:not(:disabled) { background: #d93025; }
  .gm-btn.is-active { background: #8ab4f8; color: #202124; }
  .gm-btn-leave { width: 64px; border-radius: 24px; background: #ea4335; color: #fff; }
  .gm-btn-leave:hover { background: #d93025 !important; }
  .gm-btn-side {
    position: relative; width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer;
    background: transparent; color: #e8eaed; display: flex; align-items: center; justify-content: center;
  }
  .gm-btn-side:hover { background: rgba(255,255,255,.1); }
  .gm-btn-side.is-active { color: #8ab4f8; }
  .gm-badge {
    position: absolute; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
    font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center;
  }
  .gm-badge-count { right: 2px; bottom: 4px; background: #5f6368; color: #fff; }
  .gm-badge-unread { right: 2px; top: 4px; background: #1a73e8; color: #fff; }

  @media (max-width: 900px) {
    .gm-panel { position: fixed; right: 8px; top: 8px; bottom: 88px; width: calc(100vw - 16px); max-width: 360px; z-index: 20; }
    .gm-present-side { width: 140px; }
    .gm-bar { grid-template-columns: auto 1fr; }
    .gm-bar-left { display: none; }
  }
`;


