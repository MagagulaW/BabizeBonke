import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate } from '../lib';
import { connectRealtime } from '../realtime';

type ChatPayload = {
  contact: {
    customerName?: string | null;
    customerPhone?: string | null;
    driverName?: string | null;
    driverPhone?: string | null;
    restaurantName?: string | null;
  };
  messages: Array<{ id: string; sender_name: string; sender_user_id: string; message_body: string; created_at: string }>;
};

type CallSession = {
  id: string;
  status: string;
  caller_user_id: string;
  callee_user_id: string;
  offer_sdp: string | null;
  answer_sdp: string | null;
  caller_ice_candidates: any[];
  callee_ice_candidates: any[];
};

const defaultRtcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export function OrderCommunicationPanel({ orderId, token, currentUserId, roleLabel }: { orderId: string; token: string; currentUserId: string; roleLabel: string }) {
  const [payload, setPayload] = useState<ChatPayload | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [call, setCall] = useState<CallSession | null>(null);
  const [callError, setCallError] = useState('');
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const handledCallerCandidates = useRef(0);
  const handledCalleeCandidates = useRef(0);
  const [rtcConfig, setRtcConfig] = useState<RTCConfiguration>(defaultRtcConfig);

  async function loadChat() {
    const data = await api<ChatPayload>(`/communications/orders/${orderId}/chat`, {}, token);
    setPayload(data);
  }

  async function loadCall() {
    const active = await api<CallSession | null>(`/communications/orders/${orderId}/call/active`, {}, token);
    setCall(active);
  }

  useEffect(() => {
    void loadChat();
    void loadCall();
    const t = window.setInterval(() => { void loadChat(); void loadCall(); }, 2500);
    return () => window.clearInterval(t);
  }, [orderId, token]);

  useEffect(() => {
    if (!call) return;
    void syncCall(call);
  }, [call?.id, call?.status, call?.offer_sdp, call?.answer_sdp, JSON.stringify(call?.caller_ice_candidates ?? []), JSON.stringify(call?.callee_ice_candidates ?? [])]);

  useEffect(() => {
    let mounted = true;
    api<{ turn?: { urls?: string[]; username?: string; credential?: string } }>(`/realtime/config`, {}, token).then((cfg) => {
      const turnUrls = cfg?.turn?.urls || [];
      if (!mounted || !turnUrls.length) return;
      setRtcConfig({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: turnUrls, username: cfg.turn?.username, credential: cfg.turn?.credential }
        ]
      });
    }).catch(() => undefined);

    const socket = connectRealtime(token);
    socket.emit('order:join', orderId);
    socket.on('chat:new_message', (event) => { if (event?.orderId === orderId) void loadChat(); });
    socket.on('call:started', (event) => { if (event?.order_id === orderId || event?.orderId === orderId) setCall(event); });
    socket.on('call:updated', (event) => { if (event?.order_id === orderId || event?.orderId === orderId) setCall(event); });
    socket.on('call:ended', (event) => { if (event?.order_id === orderId || event?.orderId === orderId) { setCall(event); cleanupCall(); } });
    return () => {
      mounted = false;
      socket.emit('order:leave', orderId);
      socket.disconnect();
    };
  }, [orderId, token]);

  async function ensurePeer(callId: string) {
    if (peerRef.current) return peerRef.current;
    const peer = new RTCPeerConnection(rtcConfig);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play().catch(() => undefined);
      }
    };
    peer.onicecandidate = async (event) => {
      if (event.candidate) {
        await api(`/communications/calls/${callId}/candidate`, { method: 'POST', body: JSON.stringify({ candidate: event.candidate.toJSON() }) }, token);
      }
    };
    peerRef.current = peer;
    return peer;
  }

  async function syncCall(session: CallSession) {
    try {
      const peer = await ensurePeer(session.id);
      const isCaller = session.caller_user_id === currentUserId;
      const isCallee = session.callee_user_id === currentUserId;

      if (isCallee && session.offer_sdp && !peer.remoteDescription) {
        await peer.setRemoteDescription({ type: 'offer', sdp: session.offer_sdp });
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await api(`/communications/calls/${session.id}/answer`, { method: 'POST', body: JSON.stringify({ sdp: answer.sdp }) }, token);
      }

      if (isCaller && session.answer_sdp && peer.localDescription && !peer.remoteDescription) {
        await peer.setRemoteDescription({ type: 'answer', sdp: session.answer_sdp });
      }

      const remoteCandidates = isCaller ? (session.callee_ice_candidates ?? []) : (session.caller_ice_candidates ?? []);
      const handledCountRef = isCaller ? handledCalleeCandidates : handledCallerCandidates;
      while (handledCountRef.current < remoteCandidates.length) {
        const candidate = remoteCandidates[handledCountRef.current];
        handledCountRef.current += 1;
        try { await peer.addIceCandidate(candidate); } catch { /* ignore duplicate/early candidates */ }
      }

      if (session.status === 'ended') cleanupCall();
    } catch (error) {
      setCallError(error instanceof Error ? error.message : 'Unable to sync call');
    }
  }

  async function startCall() {
    try {
      setCallError('');
      const created = await api<CallSession>(`/communications/orders/${orderId}/call/start`, { method: 'POST' }, token);
      const peer = await ensurePeer(created.id);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const saved = await api<CallSession>(`/communications/calls/${created.id}/offer`, { method: 'POST', body: JSON.stringify({ sdp: offer.sdp }) }, token);
      setCall(saved);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : 'Unable to start call');
    }
  }

  async function endCall() {
    if (call) await api(`/communications/calls/${call.id}/end`, { method: 'POST' }, token);
    cleanupCall();
    await loadCall();
  }

  function cleanupCall() {
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    handledCallerCandidates.current = 0;
    handledCalleeCandidates.current = 0;
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    try {
      await api(`/communications/orders/${orderId}/chat`, { method: 'POST', body: JSON.stringify({ message }) }, token);
      setMessage('');
      await loadChat();
    } finally {
      setLoading(false);
    }
  }

  const contactLine = useMemo(() => {
    const c = payload?.contact;
    if (!c) return 'Driver and customer messaging becomes available once the order exists.';
    return `${c.restaurantName ?? 'Order'} · Driver ${c.driverName ?? 'Pending'}${c.driverPhone ? ` (${c.driverPhone})` : ''} · Customer ${c.customerName ?? 'Pending'}${c.customerPhone ? ` (${c.customerPhone})` : ''}`;
  }, [payload]);

  return (
    <section className="panel communication-panel">
      <div className="panel-header"><h3>Chat & call</h3><span className="muted">{roleLabel}</span></div>
      <div className="muted">{contactLine}</div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="primary-btn" type="button" onClick={startCall}>Start in-app voice call</button>
        {call ? <button className="secondary-btn" type="button" onClick={endCall}>End call</button> : null}
        {payload?.contact.driverPhone ? <a className="chip-btn" href={`tel:${payload.contact.driverPhone}`}>Phone driver</a> : null}
        {payload?.contact.customerPhone ? <a className="chip-btn" href={`tel:${payload.contact.customerPhone}`}>Phone customer</a> : null}
      </div>
      {call ? <div className="call-status-bar">Call status: <strong>{call.status}</strong></div> : null}
      {callError ? <div className="error-box">{callError}</div> : null}
      <audio ref={remoteAudioRef} autoPlay />
      <div className="chat-feed">
        {payload?.messages?.length ? payload.messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble ${msg.sender_user_id === currentUserId ? 'mine' : ''}`}>
            <strong>{msg.sender_name}</strong>
            <div>{msg.message_body}</div>
            <small>{formatDate(msg.created_at)}</small>
          </div>
        )) : <div className="muted">No messages yet.</div>}
      </div>
      <form className="chat-composer" onSubmit={sendMessage}>
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type a message about pickup, gate code, or delivery instructions" />
        <button className="primary-btn" disabled={loading}>{loading ? 'Sending...' : 'Send'}</button>
      </form>
    </section>
  );
}
