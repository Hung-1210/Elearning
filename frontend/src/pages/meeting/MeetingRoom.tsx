import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
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
  type: 'MESSAGE' | 'CAMERA_OFF' | 'CAMERA_ON' | 'SCREEN_SHARING_STARTED' | 'SCREEN_SHARING_STOPPED' | 'RISE_HAND' | 'LOWER_HAND';
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
      case 'SCREEN_SHARING_STARTED':
        setPinnedPeer(peerId);
        break;
      case 'SCREEN_SHARING_STOPPED':
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
    if (isInitiator) {
      const dc = pc.createDataChannel('data-channel');
      dataChannelsRef.current.set(peerId, dc);
      dc.onmessage = (e) => handleDataChannelMessage(peerId, e);
    } else {
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        dataChannelsRef.current.set(peerId, dc);
        dc.onmessage = (ev) => handleDataChannelMessage(peerId, ev);
      };
    }

    // ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) sock.emit('candidate', peerId, e.candidate);
    };

    // Remote tracks
    pc.ontrack = (e) => {
      setPeerStreams(prev => {
        const m = new Map(prev);
        m.set(peerId, e.streams[0]);
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
        const pc = createPeer(fromSocketId, sock, localStreamRef.current!, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sock.emit('answer', fromSocketId, answer);
      });

      // Received answer
      sock.on('answer', async (fromSocketId: string, answer: RTCSessionDescriptionInit) => {
        if (!mounted) return;
        const pc = peersRef.current.get(fromSocketId);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
      });

      // ICE candidate
      sock.on('candidate', async (fromSocketId: string, candidate: RTCIceCandidateInit) => {
        if (!mounted) return;
        const pc = peersRef.current.get(fromSocketId);
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error('addIceCandidate failed:', err);
          }
        }
      });

      // Peer disconnected
      sock.on('user-disconnected', (peerSocketId: string) => {
        if (!mounted) return;
        peersRef.current.get(peerSocketId)?.close();
        peersRef.current.delete(peerSocketId);
        dataChannelsRef.current.delete(peerSocketId);
        setPeerStreams(prev => { const m = new Map(prev); m.delete(peerSocketId); return m; });
        setPeerCamOff(prev => { const s = new Set(prev); s.delete(peerSocketId); return s; });
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
    broadcastData({ type: 'MESSAGE', sender: senderName, message: text });
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

  // ── Build Video Tiles ──────────────────────────────────────
  const peerEntries = Array.from(peerStreams.entries());
  const totalVideos = peerEntries.length + 1;

  // Sort: pinned first, then raised hands
  const sortedPeerEntries = [...peerEntries].sort((a, b) => {
    if (a[0] === pinnedPeer) return -1;
    if (b[0] === pinnedPeer) return 1;
    const aHand = raisedHands.has(a[0]) ? -1 : 0;
    const bHand = raisedHands.has(b[0]) ? -1 : 0;
    return aHand - bHand;
  });

  const gridClass = pinnedPeer
    ? 'video-grid video-grid-pinned'
    : `video-grid video-grid-${Math.min(totalVideos, 6)}`;

  return (
    <div className="meeting-room">
      {/* ── Video Grid ────────────────────────────────────── */}
      <div className={gridClass}>
        {/* Local video */}
        <div className={`video-tile ${handRaised ? 'hand-raised' : ''} ${pinnedPeer === '__self' ? 'pinned' : ''}`} onDoubleClick={() => setPinnedPeer(prev => prev === '__self' ? null : '__self')}>
          <video ref={localVideoRef} autoPlay muted playsInline />
          {!camOn && (
            <div className="video-placeholder">
              <div className="video-avatar">{user?.name?.[0]?.toUpperCase() || '?'}</div>
            </div>
          )}
          <div className="video-tile-label">
            <span>{user?.name || 'Bạn'} (Bạn)</span>
            {!micOn && <span className="mic-off-icon">🔇</span>}
            {handRaised && <span className="hand-icon">✋</span>}
          </div>
          {screenSharing && <div className="sharing-badge">Đang chia sẻ màn hình</div>}
        </div>

        {/* Remote videos */}
        {sortedPeerEntries.map(([id, stream]) => (
          <RemoteVideoTile
            key={id}
            peerId={id}
            stream={stream}
            name={peerNames.get(id) || `User ${id.slice(0, 6)}`}
            camOff={peerCamOff.has(id)}
            handUp={raisedHands.has(id)}
            isPinned={pinnedPeer === id}
            onTogglePin={() => setPinnedPeer(prev => prev === id ? null : id)}
          />
        ))}
      </div>

      {/* ── Chat Panel ────────────────────────────────────── */}
      <div className={`chat-panel ${chatOpen ? 'open' : ''}`}>
        <div className="chat-header">
          <h3>💬 Tin nhắn trong cuộc họp</h3>
          <button type="button" className="chat-close-btn" onClick={(e) => { e.stopPropagation(); setChatOpen(false); }}>✕</button>
        </div>
        <div className="chat-messages">
          {chatMessages.length === 0 && (
            <div className="chat-empty">
              <span>💬</span>
              <p>Chưa có tin nhắn nào</p>
              <p className="chat-empty-sub">Gửi tin nhắn cho mọi người trong phòng</p>
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.isOwn ? 'own' : 'other'}`}>
              {!msg.isOwn && <div className="chat-msg-sender">{msg.sender}</div>}
              <div className="chat-msg-text">{msg.text}</div>
              <div className="chat-msg-time">{new Date(msg.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="chat-input-area">
          <form onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }}>
            <input
              ref={chatInputRef}
              type="text"
              placeholder="Nhập tin nhắn..."
              autoComplete="off"
            />
            <button type="submit" className="chat-send-btn">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </button>
          </form>
        </div>
      </div>

      {/* ── Participants Panel ────────────────────────────── */}
      {showParticipants && (
        <div className="participants-drawer">
          <div className="drawer-header">
            <span>👥 Người tham gia ({participants.length})</span>
            <button onClick={() => setShowParticipants(false)}>✕</button>
          </div>
          <div className="drawer-body">
            {participants.map((p) => (
              <div key={p.socketId} className="participant-item">
                <div className="participant-avatar">{p.userName[0]?.toUpperCase() || '?'}</div>
                <span>{p.userName}</span>
                {p.socketId === socketRef.current?.id && <span className="you-badge">(Bạn)</span>}
                {raisedHands.has(p.socketId) && <span className="hand-icon-small">✋</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Control Dock ──────────────────────────────────── */}
      <div className="control-dock">
        <div className="meeting-info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span>Phòng: {meetingCode?.slice(0, 8)}...</span>
        </div>

        <div className="control-buttons">
          {/* Mic */}
          <button className={`control-btn ${!micOn ? 'control-btn-off' : ''}`} onClick={toggleMic} title={micOn ? 'Tắt mic' : 'Bật mic'}>
            {micOn
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>}
            <span>{micOn ? 'Tắt mic' : 'Bật mic'}</span>
          </button>

          {/* Camera */}
          <button className={`control-btn ${!camOn ? 'control-btn-off' : ''}`} onClick={toggleCam} disabled={screenSharing} title={camOn ? 'Tắt camera' : 'Bật camera'}>
            {camOn
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /><line x1="1" y1="1" x2="23" y2="23" /></svg>}
            <span>{camOn ? 'Tắt camera' : 'Bật camera'}</span>
          </button>

          {/* Screen Share */}
          <button className={`control-btn ${screenSharing ? 'control-btn-active' : ''}`} onClick={toggleScreenShare} title={screenSharing ? 'Dừng chia sẻ' : 'Chia sẻ màn hình'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              {screenSharing && <><line x1="4" y1="5" x2="20" y2="15" /><line x1="20" y1="5" x2="4" y2="15" /></>}
            </svg>
            <span>{screenSharing ? 'Dừng chia sẻ' : 'Chia sẻ'}</span>
          </button>

          {/* Raise Hand */}
          <button className={`control-btn ${handRaised ? 'control-btn-active' : ''}`} onClick={toggleHand} title={handRaised ? 'Hạ tay' : 'Giơ tay'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 10V6a2 2 0 0 0-4 0v1M14 7V4a2 2 0 0 0-4 0v6M10 6V3a2 2 0 0 0-4 0v8" />
              <path d="M18 10a2 2 0 0 1 4 0v5a8 8 0 0 1-8 8h-2c-2.5 0-4.5-1-6.2-2.8L3 17.5a2 2 0 0 1 2.8-2.8L8 17V5" />
            </svg>
            <span>{handRaised ? 'Hạ tay' : 'Giơ tay'}</span>
          </button>

          {/* Chat */}
          <button className={`control-btn ${chatOpen ? 'control-btn-active' : ''}`} onClick={() => { setChatOpen(!chatOpen); setShowParticipants(false); }} title="Tin nhắn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Tin nhắn</span>
          </button>

          {/* Participants */}
          <button className={`control-btn ${showParticipants ? 'control-btn-active' : ''}`} onClick={() => { setShowParticipants(!showParticipants); setChatOpen(false); }} title="Người tham gia">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>({participants.length})</span>
          </button>

          {/* Leave */}
          <button className="control-btn control-btn-danger" onClick={leaveRoom} title="Rời phòng">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Rời phòng</span>
          </button>
        </div>

        <div style={{ minWidth: 120 }} />
      </div>

      <style>{meetingStyles}</style>
    </div>
  );
}

// ── Remote Video Tile Component ──────────────────────────────
function RemoteVideoTile({ peerId: _peerId, stream, name, camOff, handUp, isPinned, onTogglePin }: {
  peerId: string;
  stream: MediaStream;
  name: string;
  camOff: boolean;
  handUp: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className={`video-tile ${handUp ? 'hand-raised' : ''} ${isPinned ? 'pinned' : ''}`} onDoubleClick={onTogglePin}>
      <video ref={ref} autoPlay playsInline />
      {camOff && (
        <div className="video-placeholder">
          <div className="video-avatar">{name[0]?.toUpperCase() || '?'}</div>
        </div>
      )}
      <div className="video-tile-label">
        <span>{name}</span>
        {handUp && <span className="hand-icon">✋</span>}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────
const meetingStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  .meeting-room {
    width: 100vw; height: 100vh;
    background: #0F0F1A;
    display: flex; flex-direction: column;
    position: relative; overflow: hidden;
    font-family: 'Inter', sans-serif;
  }

  /* ── Video Grid ──────────────────────────────────────── */
  .video-grid {
    flex: 1; display: grid; gap: 8px;
    padding: 12px; overflow: hidden;
    transition: all 0.3s ease;
  }
  .video-grid-1 { grid-template-columns: 1fr; }
  .video-grid-2 { grid-template-columns: 1fr 1fr; }
  .video-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .video-grid-3 .video-tile:first-child { grid-column: 1 / -1; }
  .video-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .video-grid-5, .video-grid-6 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .video-grid-pinned { grid-template-columns: 1fr; grid-template-rows: 3fr 1fr; }
  .video-grid-pinned .video-tile:not(.pinned) { max-height: 120px; }

  .video-tile {
    background: #1A1A2E; border-radius: 12px;
    position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid transparent;
    transition: border-color 0.3s ease, box-shadow 0.3s ease;
  }
  .video-tile:hover { border-color: rgba(255,255,255,0.1); }
  .video-tile.pinned {
    border-color: rgba(79, 70, 229, 0.6);
    box-shadow: 0 0 20px rgba(79, 70, 229, 0.2);
    grid-column: 1 / -1;
  }
  .video-tile.hand-raised {
    border-color: rgba(251, 191, 36, 0.6);
    animation: hand-pulse 1.5s ease-in-out infinite;
  }
  @keyframes hand-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.3); }
    50% { box-shadow: 0 0 0 8px rgba(251, 191, 36, 0); }
  }
  .video-tile video {
    width: 100%; height: 100%;
    object-fit: cover; transform: scaleX(-1);
  }
  .video-tile-label {
    position: absolute; bottom: 10px; left: 10px;
    background: rgba(0,0,0,0.65);
    color: white; padding: 4px 12px; border-radius: 8px;
    font-size: 12px; font-weight: 500;
    display: flex; align-items: center; gap: 6px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .mic-off-icon { font-size: 11px; }
  .hand-icon { font-size: 14px; animation: hand-wave 0.6s ease-in-out infinite alternate; }
  @keyframes hand-wave {
    0% { transform: rotate(-10deg); }
    100% { transform: rotate(10deg); }
  }
  .sharing-badge {
    position: absolute; top: 10px; left: 10px;
    background: linear-gradient(135deg, #4F46E5, #7C3AED);
    color: white; padding: 4px 12px; border-radius: 8px;
    font-size: 11px; font-weight: 600;
    animation: pulse-badge 2s ease-in-out infinite;
  }
  @keyframes pulse-badge {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  .video-placeholder {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #1A1A2E, #16162A);
  }
  .video-avatar {
    width: 72px; height: 72px; border-radius: 50%;
    background: linear-gradient(135deg, #4F46E5, #7C3AED);
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 700; color: white;
    box-shadow: 0 4px 20px rgba(79, 70, 229, 0.4);
  }

  /* ── Control Dock ────────────────────────────────────── */
  .control-dock {
    height: 80px;
    background: rgba(15, 15, 26, 0.97);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .meeting-info {
    display: flex; align-items: center; gap: 8px;
    color: rgba(255, 255, 255, 0.4); font-size: 13px;
    min-width: 200px;
  }
  .meeting-info svg { opacity: 0.5; }
  .control-buttons { display: flex; align-items: center; gap: 6px; }
  .control-btn {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 8px 14px; border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.75);
    transition: all 0.2s ease;
    cursor: pointer; border: none; font-family: inherit;
  }
  .control-btn svg { width: 20px; height: 20px; }
  .control-btn span { font-size: 10px; font-weight: 500; white-space: nowrap; }
  .control-btn:hover { background: rgba(255, 255, 255, 0.12); color: white; transform: translateY(-1px); }
  .control-btn:active { transform: translateY(0); }
  .control-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .control-btn-off { background: rgba(239, 68, 68, 0.15); color: #EF4444; }
  .control-btn-off:hover { background: rgba(239, 68, 68, 0.25); color: #F87171; }
  .control-btn-active { background: rgba(79, 70, 229, 0.25); color: #A5B4FC; }
  .control-btn-active:hover { background: rgba(79, 70, 229, 0.35); color: #C7D2FE; }
  .control-btn-danger { background: #EF4444; color: white; }
  .control-btn-danger:hover { background: #DC2626; transform: translateY(-1px); }

  /* ── Chat Panel ──────────────────────────────────────── */
  .chat-panel {
    position: absolute; top: 0; right: 0;
    width: 340px; height: calc(100% - 80px);
    background: #1A1A2E;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 20;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.3);
  }
  .chat-panel.open { transform: translateX(0); }
  .chat-header {
    padding: 16px 18px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(26, 26, 46, 0.95);
  }
  .chat-header h3 {
    color: white; font-size: 14px; font-weight: 600; margin: 0;
  }
  .chat-close-btn {
    color: rgba(255, 255, 255, 0.4); cursor: pointer;
    background: none; border: none; font-size: 18px;
    width: 28px; height: 28px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .chat-close-btn:hover { background: rgba(255,255,255,0.08); color: white; }
  .chat-messages {
    flex: 1; padding: 16px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 8px;
  }
  .chat-empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: rgba(255, 255, 255, 0.3); text-align: center;
  }
  .chat-empty span { font-size: 40px; margin-bottom: 12px; opacity: 0.4; }
  .chat-empty p { margin: 0; font-size: 14px; font-weight: 500; }
  .chat-empty-sub { font-size: 12px !important; margin-top: 4px !important; opacity: 0.7; }
  .chat-msg {
    max-width: 85%; padding: 8px 12px; border-radius: 12px;
    font-size: 13px; line-height: 1.4; word-break: break-word;
  }
  .chat-msg.own {
    align-self: flex-end;
    background: linear-gradient(135deg, #4F46E5, #6366F1);
    color: white; border-bottom-right-radius: 4px;
  }
  .chat-msg.other {
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.06); color: #E2E8F0;
    border-bottom-left-radius: 4px;
  }
  .chat-msg-sender {
    font-size: 11px; font-weight: 600; color: #A5B4FC;
    margin-bottom: 2px;
  }
  .chat-msg-text { word-break: break-word; }
  .chat-msg-time {
    font-size: 10px; opacity: 0.5; margin-top: 4px;
    text-align: right;
  }
  .chat-input-area {
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(26, 26, 46, 0.95);
  }
  .chat-input-area form {
    display: flex; gap: 8px; align-items: center;
  }
  .chat-input-area input {
    flex: 1; padding: 10px 14px; border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: white; font-size: 13px; outline: none;
    font-family: inherit;
    transition: border-color 0.2s ease;
  }
  .chat-input-area input:focus { border-color: rgba(79, 70, 229, 0.5); }
  .chat-input-area input::placeholder { color: rgba(255,255,255,0.3); }
  .chat-send-btn {
    width: 38px; height: 38px; border-radius: 10px;
    background: linear-gradient(135deg, #4F46E5, #6366F1);
    color: white; border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s ease; flex-shrink: 0;
  }
  .chat-send-btn:hover { transform: scale(1.05); box-shadow: 0 2px 12px rgba(79, 70, 229, 0.4); }

  /* ── Participants Drawer ─────────────────────────────── */
  .participants-drawer {
    position: absolute; top: 0; right: 0;
    width: 300px; height: calc(100% - 80px);
    background: #1A1A2E;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
    display: flex; flex-direction: column; z-index: 20;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.3);
    animation: slide-in-right 0.3s ease;
  }
  @keyframes slide-in-right {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .drawer-header {
    padding: 16px 18px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    color: white; font-weight: 600; font-size: 14px;
  }
  .drawer-header button {
    color: rgba(255, 255, 255, 0.4); cursor: pointer;
    background: none; border: none; font-size: 18px;
    width: 28px; height: 28px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .drawer-header button:hover { background: rgba(255,255,255,0.08); color: white; }
  .drawer-body { padding: 12px; overflow-y: auto; flex: 1; }
  .participant-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 10px;
    color: rgba(255, 255, 255, 0.8); font-size: 13px;
    transition: background 0.15s ease;
  }
  .participant-item:hover { background: rgba(255, 255, 255, 0.04); }
  .participant-avatar {
    width: 34px; height: 34px; border-radius: 50%;
    background: linear-gradient(135deg, #4F46E5, #7C3AED);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; color: white; flex-shrink: 0;
  }
  .you-badge {
    font-size: 11px; color: rgba(255, 255, 255, 0.3);
    margin-left: auto;
  }
  .hand-icon-small { margin-left: auto; font-size: 16px; }

  /* ── Scrollbar ───────────────────────────────────────── */
  .chat-messages::-webkit-scrollbar,
  .drawer-body::-webkit-scrollbar { width: 4px; }
  .chat-messages::-webkit-scrollbar-thumb,
  .drawer-body::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.15); border-radius: 4px;
  }
  .chat-messages::-webkit-scrollbar-track,
  .drawer-body::-webkit-scrollbar-track { background: transparent; }

  /* ── Responsive ──────────────────────────────────────── */
  @media (max-width: 768px) {
    .chat-panel { width: 100%; }
    .participants-drawer { width: 100%; }
    .control-dock { padding: 0 8px; height: 70px; }
    .control-btn { padding: 6px 10px; }
    .control-btn span { display: none; }
    .meeting-info { display: none; }
    .video-grid { padding: 6px; gap: 4px; }
  }
`;
