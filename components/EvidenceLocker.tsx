
import React, { useState, useRef, useEffect } from 'react';
import { EvidenceItem, EvidenceType } from '../types';
import { generateHash } from '../services/cryptoUtils';
import { analyzeEvidence } from '../services/geminiService';
import { useAthenaAgent } from '../lib/useAthenaAgent';
import { uploadBase64ToIPFS, uploadTextToIPFS, generateCertificate, getEvidenceUrl } from '../lib/ipfs-service';
import { auth, saveEvidence, loadEvidence, loadEscapePlan, mergeCaseListingEvidenceStats } from '../lib/firebase';
import { Lock, Wifi, WifiOff, Loader2, Download, ExternalLink } from 'lucide-react';
import { isSolana, getExplorer } from '../lib/chain-router';

/** Firma de transacción Solana en base58 (~87–88 chars). Nunca es el hash SHA-256 del contenido. */
function isSolanaTransactionSignature(s: string | undefined): boolean {
  if (!s || s.startsWith('demo_')) return false;
  const len = s.length;
  if (len < 81 || len > 89) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

export const EvidenceLocker: React.FC = () => {
  const { secureEvidence, isOnline, isLoading: agentLoading } = useAthenaAgent();
  const [logs, setLogs] = useState<EvidenceItem[]>([]);
  const [activeTab, setActiveTab] = useState<EvidenceType>('TEXT');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(true);

  // Load evidence from Firestore on mount
  useEffect(() => {
    const loadSavedEvidence = async () => {
      const user = auth.currentUser;
      if (user) {
        try {
          const savedEvidence = await loadEvidence(user.uid);
          setLogs(savedEvidence as EvidenceItem[]);
        } catch (e) {
          console.warn('[EvidenceLocker] Failed to load evidence:', e);
        }
      }
      setIsLoadingEvidence(false);
    };
    loadSavedEvidence();
  }, []);

  // TEXT INPUT STATE
  const [inputText, setInputText] = useState('');

  // IMAGE INPUT STATE
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputCameraRef = useRef<HTMLInputElement>(null);
  const fileInputGalleryRef = useRef<HTMLInputElement>(null);

  // VIDEO INPUT STATE
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const videoInputCameraRef = useRef<HTMLInputElement>(null);
  const videoInputGalleryRef = useRef<HTMLInputElement>(null);

  // AUDIO INPUT STATE
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const [liveCapture, setLiveCapture] = useState<null | 'photo' | 'video'>(null);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);

  const mimeFromDataUrl = (dataUrl: string, fallback: string): string => {
    const m = dataUrl.match(/^data:([^;]+);/);
    return m ? m[1] : fallback;
  };

  const pickAudioMime = (): string => {
    const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const o of opts) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(o)) return o;
    }
    return '';
  };

  const pickVideoMime = (): string => {
    const opts = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    for (const o of opts) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(o)) return o;
    }
    return '';
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  };

  const closeLiveCapture = () => {
    try {
      if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
        videoRecorderRef.current.stop();
      }
    } catch { /* ignore */ }
    videoRecorderRef.current = null;
    videoChunksRef.current = [];
    stopStream();
    setLiveCapture(null);
    setIsRecordingVideo(false);
  };

  useEffect(() => {
    if (!liveCapture || !streamRef.current || !liveVideoRef.current) return;
    const v = liveVideoRef.current;
    v.srcObject = streamRef.current;
    v.setAttribute('playsinline', 'true');
    v.playsInline = true;
    v.muted = liveCapture === 'video';
    void v.play();
  }, [liveCapture]);

  useEffect(() => {
    return () => {
      try {
        if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
          videoRecorderRef.current.stop();
        }
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    };
  }, []);

  const openLivePhoto = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setLiveCapture('photo');
    } catch (e) {
      console.error(e);
      alert('No se pudo abrir la cámara. Permite el acceso o usa Galería.');
    }
  };

  const capturePhotoFromLive = () => {
    const v = liveVideoRef.current;
    if (!v || v.readyState < 2) return;
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    setSelectedImage(canvas.toDataURL('image/jpeg', 0.92));
    closeLiveCapture();
  };

  const openLiveVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      videoChunksRef.current = [];
      setIsRecordingVideo(false);
      setLiveCapture('video');
    } catch (e) {
      console.error(e);
      alert('No se pudo acceder a cámara/micrófono. Revisa permisos del navegador.');
    }
  };

  const startVideoRecording = () => {
    if (!streamRef.current) return;
    const mime = pickVideoMime();
    const rec = mime
      ? new MediaRecorder(streamRef.current, { mimeType: mime })
      : new MediaRecorder(streamRef.current);
    videoRecorderRef.current = rec;
    videoChunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) videoChunksRef.current.push(ev.data);
    };
    rec.start(250);
    setIsRecordingVideo(true);
  };

  const stopVideoRecording = async () => {
    const rec = videoRecorderRef.current;
    if (!rec || rec.state === 'inactive') {
      setIsRecordingVideo(false);
      return;
    }
    await new Promise<void>((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true });
      rec.stop();
    });
    setIsRecordingVideo(false);
    const blob = new Blob(videoChunksRef.current, {
      type: videoChunksRef.current[0]?.type || pickVideoMime() || 'video/webm',
    });
    const dataUrl = await blobToBase64(blob);
    setSelectedVideo(dataUrl);
    closeLiveCapture();
  };

  // --- HELPERS ---

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // --- HANDLERS ---

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const base64 = await fileToBase64(file);
      setSelectedImage(base64);
    }
    resetInput(e.target);
  };

  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const base64 = await fileToBase64(file);
      setSelectedVideo(base64);
    }
    resetInput(e.target);
  };

  const handleAudioSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAudioUrl(URL.createObjectURL(file));
      setAudioBlob(file);
    }
    resetInput(e.target);
  };

  const resetInput = (el: EventTarget & HTMLInputElement) => {
    el.value = '';
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      chunksRef.current = [];
      const mime = pickAudioMime();
      const mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mediaRecorder.mimeType || pickAudioMime() || 'audio/webm',
        });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        audioStreamRef.current?.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
      };

      mediaRecorder.start(250);
      setIsRecording(true);
    } catch (err) {
      console.error('Mic Error:', err);
      alert('Se necesita permiso del micrófono para grabar notas de voz.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSave = async () => {
    setIsProcessing(true);
    setProcessingStatus('Encrypting Data...');

    let content = '';
    let mediaData = undefined;

    // Prepare data based on active tab
    if (activeTab === 'TEXT') {
      if (!inputText.trim()) { setIsProcessing(false); return; }
      content = inputText;
    } else if (activeTab === 'IMAGE') {
      if (!selectedImage) { setIsProcessing(false); return; }
      content = "Photo Evidence";
      mediaData = selectedImage;
    } else if (activeTab === 'VIDEO') {
      if (!selectedVideo) { setIsProcessing(false); return; }
      content = "Video Evidence";
      mediaData = selectedVideo;
    } else if (activeTab === 'AUDIO') {
      if (!audioBlob) { setIsProcessing(false); return; }
      content = "Audio Evidence";
      mediaData = await blobToBase64(audioBlob);
    }

    // 0. Upload to IPFS first
    setProcessingStatus('Uploading to IPFS...');
    let ipfsResult = null;
    try {
      if (activeTab === 'TEXT') {
        ipfsResult = await uploadTextToIPFS(content, {
          type: 'TEXT',
          description: content.substring(0, 100),
          timestamp: Date.now()
        });
      } else if (mediaData) {
        const fallback =
          activeTab === 'IMAGE' ? 'image/jpeg' :
          activeTab === 'VIDEO' ? 'video/webm' :
          'audio/webm';
        const mimeType = mediaData.startsWith('data:') ? mimeFromDataUrl(mediaData, fallback) : fallback;
        ipfsResult = await uploadBase64ToIPFS(mediaData, mimeType, {
          type: activeTab,
          description: inputText || `${activeTab} Evidence`,
          timestamp: Date.now()
        });
      }
      if (ipfsResult?.success) {
        console.log('[IPFS] Uploaded:', ipfsResult.cid);
      }
    } catch (e) {
      console.warn('[IPFS] Upload failed, continuing with hash only:', e);
    }

    // 1. AI Analysis
    setProcessingStatus('AI Forensic Analysis...');
    // Only send to AI if we have mediaData or text
    const analysisData = mediaData || content;
    const analysis = await analyzeEvidence(activeTab, analysisData);

    // 2. Generate Hash locally first
    setProcessingStatus('Hashing Evidence...');
    const rawData = content + (mediaData || '') + Date.now().toString();
    const hash = await generateHash(rawData);

    // 3. Store hash on-chain using AthenaAgent (real blockchain or fallback)
    setProcessingStatus(
      isOnline
        ? `Storing on ${isSolana() ? 'Solana Devnet (Memo Program)' : 'Fraxtal L2'}...`
        : 'Simulating blockchain...'
    );

    try {
      // Use the agent to secure evidence on-chain
      const evidenceRecord = await secureEvidence(
        rawData,
        activeTab,
        analysis ? {
          category: analysis.category,
          riskLevel: analysis.riskLevel,
          summary: analysis.summary
        } : undefined
      );

      const newItem: EvidenceItem = {
        id: evidenceRecord.id || Date.now().toString(),
        timestamp: Date.now(),
        content: activeTab === 'TEXT' ? content : (inputText || content),
        type: activeTab,
        mediaData: mediaData,
        hash: evidenceRecord.hash || hash,
        txHash: evidenceRecord.txHash,
        status: (evidenceRecord.status === 'ON_CHAIN' || ipfsResult?.cid) ? 'SECURED_ON_CHAIN' : 'PENDING',
        analysis: analysis || undefined,
        ipfsCid: ipfsResult?.cid,
        ipfsUrl: ipfsResult?.gatewayUrl
      };

      // Save to Firestore for persistence
      const user = auth.currentUser;
      if (user) {
        await saveEvidence(user.uid, {
          id: newItem.id,
          timestamp: newItem.timestamp,
          content: newItem.content,
          type: newItem.type,
          hash: newItem.hash,
          txHash: newItem.txHash,
          status: newItem.status,
          ipfsCid: newItem.ipfsCid,
          ipfsUrl: newItem.ipfsUrl,
          analysis: newItem.analysis
        });
        try {
          const plan = await loadEscapePlan(user.uid);
          if (plan?.caseId) {
            await mergeCaseListingEvidenceStats(user.uid, String(plan.caseId));
          }
        } catch {
          /* no bloquear locker */
        }
      }

      setLogs([newItem, ...logs]);
    } catch (error) {
      // Fallback if agent fails
      console.error('[EvidenceLocker] Agent failed, using local storage:', error);

      const newItem: EvidenceItem = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        content: activeTab === 'TEXT' ? content : (inputText || content),
        type: activeTab,
        mediaData: mediaData,
        hash: hash,
        status: 'PENDING',
        analysis: analysis || undefined
      };

      setLogs([newItem, ...logs]);
    }

    // Reset States
    setInputText('');
    setSelectedImage(null);
    setSelectedVideo(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setIsProcessing(false);
    setProcessingStatus('');
  };

  return (
    <div className="flex flex-col h-full bg-neutral-950 relative">
      {liveCapture && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/95">
          <video
            ref={liveVideoRef}
            className="flex-1 w-full object-contain bg-black min-h-[40vh]"
            playsInline
            autoPlay
            muted={liveCapture === 'video'}
          />
          <div className="p-4 flex flex-wrap gap-2 justify-center border-t border-solana-violet/30 bg-neutral-950/95">
            {liveCapture === 'photo' && (
              <button
                type="button"
                onClick={capturePhotoFromLive}
                className="px-4 py-3 rounded-xl font-bold text-black bg-gradient-to-r from-solana-mint to-emerald-400 shadow-lg"
              >
                Capturar foto
              </button>
            )}
            {liveCapture === 'video' && !isRecordingVideo && (
              <button
                type="button"
                onClick={startVideoRecording}
                className="px-4 py-3 rounded-xl font-bold text-white bg-solana-violet"
              >
                Iniciar grabación
              </button>
            )}
            {liveCapture === 'video' && isRecordingVideo && (
              <button
                type="button"
                onClick={() => void stopVideoRecording()}
                className="px-4 py-3 rounded-xl font-bold text-white bg-red-600 animate-pulse"
              >
                Parar y usar video
              </button>
            )}
            <button
              type="button"
              onClick={closeLiveCapture}
              className="px-4 py-3 rounded-xl font-bold border border-neutral-600 text-gray-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Header Area */}
      <div className="p-6 pb-0">
        <div className="flex justify-between items-start mb-2 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/solana-mark.png" alt="" className="w-10 h-10 shrink-0 rounded-lg object-contain hidden sm:block" />
            <div>
              <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-solana-mint via-white to-solana-violet bg-clip-text text-transparent">
                Immutable Locker
              </h2>
              <p className="text-[10px] text-solana-mint/80 font-mono">Anchored on Solana Devnet · IPFS Pinata</p>
            </div>
          </div>
          {/* Connection Status */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono ${isOnline ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isOnline ? 'ON-CHAIN' : 'PENDING'}
          </div>
        </div>
        <p className="text-gray-400 text-xs mb-4">
          Photos, video & voice are analyzed by Vertex AI, stored on IPFS, and a proof hash is written on-chain on <strong className="text-solana-mint">Solana</strong>.
        </p>

        {/* Tabs */}
        <div className="flex bg-neutral-900 p-1 rounded-xl mb-6 border border-solana-violet/20 overflow-x-auto">
          {(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO'] as EvidenceType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 min-w-[60px] py-2 text-[10px] font-bold rounded-lg transition ${activeTab === tab
                ? 'bg-gradient-to-r from-solana-violet to-solana-mint text-black shadow-lg'
                : 'text-gray-500 hover:text-white'
                }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Input Area */}
      <div className="px-6 pb-4 border-b border-neutral-800">

        {/* TEXT INPUT */}
        {activeTab === 'TEXT' && (
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Describe details safely here..."
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-white focus:outline-none focus:border-athena-500 h-48 resize-none text-sm"
          />
        )}

        {/* IMAGE INPUT */}
        {activeTab === 'IMAGE' && (
          <div className="flex flex-col gap-3">
            {/* Hidden Inputs */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputCameraRef}
              className="hidden"
              onChange={handleImageSelect}
            />
            <input type="file" accept="image/*" ref={fileInputGalleryRef} className="hidden" onChange={handleImageSelect} />

            {selectedImage ? (
              <div className="relative h-48 w-full rounded-xl overflow-hidden border border-neutral-700 bg-black">
                <img src={selectedImage} alt="Evidence Preview" className="h-full w-full object-contain" />
                <button
                  onClick={() => setSelectedImage(null)}
                  className="absolute top-2 right-2 bg-black/70 text-white p-1 rounded-full"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-h-[5.5rem]">
                  <button
                    type="button"
                    onClick={() => fileInputCameraRef.current?.click()}
                    className="border border-dashed border-solana-mint/40 rounded-xl flex flex-col items-center justify-center gap-1 py-3 hover:bg-solana-violet/10 transition text-solana-mint"
                  >
                    <span className="font-bold text-xs">Cámara (sistema)</span>
                    <span className="text-[9px] text-gray-500">móvil / permiso nativo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void openLivePhoto()}
                    className="border border-dashed border-solana-violet/50 rounded-xl flex flex-col items-center justify-center gap-1 py-3 hover:bg-solana-violet/10 transition text-white"
                  >
                    <span className="font-bold text-xs">Vista en vivo</span>
                    <span className="text-[9px] text-gray-500">PC &amp; navegador</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputGalleryRef.current?.click()}
                    className="border border-dashed border-neutral-600 rounded-xl flex flex-col items-center justify-center gap-1 py-3 hover:border-solana-mint/40 transition text-gray-300"
                  >
                    <span className="font-bold text-xs">Galería / archivo</span>
                  </button>
                </div>
              </div>
            )}

            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Optional caption..."
              className="bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm text-white focus:border-athena-500 outline-none"
            />
          </div>
        )}

        {/* VIDEO INPUT */}
        {activeTab === 'VIDEO' && (
          <div className="flex flex-col gap-3">
            {/* Hidden Inputs */}
            <input
              type="file"
              accept="video/*"
              capture="environment"
              ref={videoInputCameraRef}
              className="hidden"
              onChange={handleVideoSelect}
            />
            <input type="file" accept="video/*" ref={videoInputGalleryRef} className="hidden" onChange={handleVideoSelect} />

            {selectedVideo ? (
              <div className="relative h-48 w-full rounded-xl overflow-hidden border border-neutral-700 bg-black">
                <video src={selectedVideo} controls className="h-full w-full object-contain" />
                <button
                  onClick={() => setSelectedVideo(null)}
                  className="absolute top-2 right-2 bg-black/70 text-white p-1 rounded-full z-10"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-h-[5.5rem]">
                  <button
                    type="button"
                    onClick={() => videoInputCameraRef.current?.click()}
                    className="border border-dashed border-solana-mint/40 rounded-xl flex flex-col items-center justify-center gap-1 py-3 hover:bg-solana-violet/10 transition text-solana-mint"
                  >
                    <span className="font-bold text-xs">Video (sistema)</span>
                    <span className="text-[9px] text-gray-500">cámara nativa</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void openLiveVideo()}
                    className="border border-dashed border-solana-violet/50 rounded-xl flex flex-col items-center justify-center gap-1 py-3 hover:bg-solana-violet/10 transition text-white"
                  >
                    <span className="font-bold text-xs">Grabar en vivo</span>
                    <span className="text-[9px] text-gray-500">MediaRecorder</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => videoInputGalleryRef.current?.click()}
                    className="border border-dashed border-neutral-600 rounded-xl flex flex-col items-center justify-center gap-1 py-3 hover:border-solana-mint/40 transition text-gray-300"
                  >
                    <span className="font-bold text-xs">Subir archivo</span>
                  </button>
                </div>
              </div>
            )}

            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Optional video details..."
              className="bg-neutral-900 border border-neutral-700 rounded-lg p-2 text-sm text-white focus:border-athena-500 outline-none"
            />
          </div>
        )}

        {/* AUDIO INPUT */}
        {activeTab === 'AUDIO' && (
          <div className="flex flex-col items-center justify-center gap-6 py-4 bg-neutral-900 rounded-xl border border-neutral-800 relative">
            <input type="file" accept="audio/*" ref={audioInputRef} className="hidden" onChange={handleAudioSelect} />

            {/* Upload Button Absolute positioned for layout */}
            {!audioUrl && (
              <button
                onClick={() => audioInputRef.current?.click()}
                className="absolute top-2 right-2 text-gray-500 hover:text-white text-xs flex items-center gap-1 border border-neutral-700 px-2 py-1 rounded"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                Upload
              </button>
            )}

            {audioUrl ? (
              <div className="w-full px-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-green-400 font-bold">Audio Ready</span>
                  <button onClick={() => { setAudioUrl(null); setAudioBlob(null); }} className="text-xs text-gray-500 hover:text-white">Delete</button>
                </div>
                <audio src={audioUrl} controls className="w-full h-10" />
              </div>
            ) : (
              <>
                <div className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-900/20' : 'bg-neutral-800'}`}>
                  {isRecording && <div className="absolute inset-0 rounded-full bg-red-500/30 animate-ping"></div>}
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-transform active:scale-95 ${isRecording ? 'bg-red-600' : 'bg-gradient-to-br from-solana-mint to-solana-violet'}`}
                  >
                    {isRecording ? (
                      <div className="w-8 h-8 bg-white rounded-md"></div>
                    ) : (
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-400 font-mono">
                  {isRecording ? "RECORDING..." : "Tap Mic or Upload"}
                </p>
              </>
            )}

            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Optional audio note..."
              className="w-[90%] bg-black border border-neutral-700 rounded-lg p-2 text-sm text-white focus:border-athena-500 outline-none"
            />
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={isProcessing || (activeTab === 'TEXT' && !inputText) || (activeTab === 'IMAGE' && !selectedImage) || (activeTab === 'VIDEO' && !selectedVideo) || (activeTab === 'AUDIO' && !audioBlob)}
          className={`w-full mt-4 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition
            ${isProcessing ? 'bg-neutral-800 text-gray-500 cursor-wait' : 'bg-gradient-to-r from-solana-violet to-solana-mint text-black hover:opacity-95 shadow-lg shadow-solana-violet/25'}
          `}
        >
          {isProcessing ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              <span>{processingStatus}</span>
            </div>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              Secure Evidence
            </>
          )}
        </button>
      </div>

      {/* Timeline / History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Secured Log</h3>

        {logs.map(log => (
          <div key={log.id} className="bg-neutral-900 rounded-xl p-4 border-l-4 border-solana-mint shadow-sm relative overflow-hidden group">
            {/* Subtle Chain Icon bg */}
            <div className="absolute top-2 right-2 opacity-5">
              <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            </div>

            <div className="flex justify-between items-start mb-3 relative z-10 gap-2">
              <span className="text-[10px] text-gray-400 font-mono">
                {new Date(log.timestamp).toLocaleString()}
              </span>
              <div className="flex flex-col items-end gap-1 max-w-[60%]">
                {isSolanaTransactionSignature(log.txHash) ? (
                  <a
                    href={getExplorer().txUrl(log.txHash as string)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] bg-black/50 text-solana-mint hover:text-emerald-300 px-2 py-0.5 rounded font-mono border border-solana-violet/30 transition flex items-center gap-1"
                    title={`Ver transacción en ${getExplorer().name} (SPL Memo)`}
                  >
                    Solana: {(log.txHash as string).slice(0, 8)}…
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ) : log.txHash?.startsWith('demo_') ? (
                  <span
                    className="text-[9px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded font-mono border border-amber-500/30 text-right"
                    title="Entrada antigua en modo demo. Las nuevas evidencias sin clave no generan firma ficticia."
                  >
                    Demo (histórico)
                  </span>
                ) : (
                  <span
                    className="text-[9px] bg-neutral-800 text-gray-400 px-2 py-0.5 rounded font-mono border border-neutral-700 text-right"
                    title="Producción: SOLANA_AGENT_KEYPAIR_BASE58 en Vercel + POST /api/solana/memo. Local: VITE_SOLANA_KEYPAIR_BASE58 o proxy a /api."
                  >
                    Sin tx en cadena
                  </span>
                )}
              </div>
            </div>

            {(log.ipfsUrl || log.ipfsCid) && (
              <div className="flex flex-wrap items-center gap-2 mb-2 relative z-10">
                <a
                  href={log.ipfsUrl || getEvidenceUrl(log.ipfsCid || '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] font-bold text-solana-violet hover:text-solana-mint flex items-center gap-1 border border-solana-violet/30 rounded px-2 py-1 bg-solana-violet/10"
                >
                  Ver evidencia en IPFS
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
                {log.ipfsCid && (
                  <span className="text-[9px] text-gray-500 font-mono truncate max-w-[200px]" title={log.ipfsCid}>
                    CID {log.ipfsCid.slice(0, 14)}…
                  </span>
                )}
              </div>
            )}

            <div className="relative z-10">
              {/* TYPE: TEXT */}
              {log.type === 'TEXT' && (
                <p className="text-gray-200 text-sm whitespace-pre-wrap">{log.content}</p>
              )}

              {/* TYPE: IMAGE */}
              {log.type === 'IMAGE' && log.mediaData && (
                <div className="space-y-2">
                  <img src={log.mediaData} alt="Secured Evidence" className="w-full rounded-lg border border-neutral-700 max-h-48 object-cover" />
                  {log.content !== 'Photo Evidence' && <p className="text-gray-300 text-sm italic">{log.content}</p>}
                </div>
              )}

              {/* TYPE: VIDEO */}
              {log.type === 'VIDEO' && log.mediaData && (
                <div className="space-y-2">
                  <video src={log.mediaData} controls className="w-full rounded-lg border border-neutral-700 max-h-64 bg-black" />
                  {log.content !== 'Video Evidence' && <p className="text-gray-300 text-sm italic">{log.content}</p>}
                </div>
              )}

              {/* TYPE: AUDIO */}
              {log.type === 'AUDIO' && log.mediaData && (
                <div className="space-y-2">
                  <div className="bg-black/40 p-2 rounded-lg flex items-center gap-2">
                    <div className="w-8 h-8 bg-athena-600 rounded-full flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                    </div>
                    <audio src={log.mediaData} controls className="w-full h-8" />
                  </div>
                  {log.content !== 'Audio Evidence' && <p className="text-gray-300 text-sm italic">{log.content}</p>}
                </div>
              )}

              {/* --- AI ANALYSIS SECTION --- */}
              {log.analysis && (
                <div className="mt-4 pt-3 border-t border-white/5 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center gap-1 bg-athena-900/40 px-2 py-0.5 rounded text-[10px] text-athena-300 border border-athena-500/20">
                      <span className={`w-1.5 h-1.5 rounded-full ${log.analysis.riskLevel >= 7 ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`}></span>
                      <span className="font-bold tracking-wider">RISK LEVEL {log.analysis.riskLevel}/10</span>
                    </div>
                    <span className="text-[10px] text-gray-500 uppercase font-bold border border-neutral-800 px-2 py-0.5 rounded">{log.analysis.category}</span>
                  </div>

                  <p className="text-gray-400 text-xs italic mb-2">"{log.analysis.summary}"</p>

                  <div className="flex flex-wrap gap-1">
                    {log.analysis.keywords.map((kw, i) => (
                      <span key={i} className="text-[9px] text-gray-500 bg-neutral-800 px-1.5 py-0.5 rounded">#{kw}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
