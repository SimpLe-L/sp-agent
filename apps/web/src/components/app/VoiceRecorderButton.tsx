import React, { useEffect, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { AudioLines, GripHorizontal, Mic, Radio, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiBase, fetchJson } from "@/app/api";
import { pendingVoiceResponses } from "@/app/voice-cache";
import type { ProviderStatus, VoiceChatResponse, VoiceStatus } from "@/app/types";
import { cn } from "@/lib/utils";

export function VoiceRecorderButton() {
  const aui = useAui();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const threadId = useAuiState((state) => state.threadListItem.remoteId ?? state.threads.mainThreadId);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "recording" | "sending" | "playing" | "degraded">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [continuousCall, setContinuousCall] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const continuousCallRef = useRef(false);
  const silenceFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const lastVoiceAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const heardVoiceRef = useRef(false);
  const voiceCallPanelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadVoiceStatus() {
      try {
        const status = await fetchJson<VoiceStatus>(`${apiBase}/voice/status`);
        if (cancelled) return;
        setVoiceStatus(status);
        if (!status.ready) {
          setState("degraded");
          setMessage(status.degradedReason ?? "Voice providers unavailable");
        }
      } catch (error) {
        if (cancelled) return;
        setState("degraded");
        setMessage(error instanceof Error ? error.message : "Voice status unavailable");
      }
    }
    void loadVoiceStatus();
    return () => {
      cancelled = true;
      stopSilenceMonitor();
      stopStream(streamRef.current);
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (open) void refreshVoiceDiagnostics();
  }, [open, threadId]);

  const voiceUnavailableReason = voiceStatus ? voiceNotReadyReason(voiceStatus) : "正在检查语音服务";
  const disabled = isRunning || state === "sending" || state === "playing" || !voiceStatus?.ready;
  const tooltip = state === "recording"
    ? "Stop recording"
    : isRunning
      ? "助手正在回复，稍后再试"
      : voiceStatus?.ready
      ? "Open voice call"
      : voiceUnavailableReason;
  const callStatus = voiceCallStatusLabel(state, voiceStatus, message);

  function openVoiceCall() {
    if (isRunning) {
      setMessage("助手正在回复，稍后再试");
      return;
    }
    if (!voiceStatus?.ready) {
      setMessage(voiceUnavailableReason);
      void refreshVoiceDiagnostics();
      return;
    }
    setOpen(true);
  }

  async function refreshVoiceDiagnostics() {
    try {
      const status = await fetchJson<VoiceStatus>(`${apiBase}/voice/status`);
      setVoiceStatus(status);
      if (!status.ready) {
        setState("degraded");
        setMessage(status.degradedReason ?? "Voice providers unavailable");
      }
    } catch (error) {
      setState("degraded");
      setMessage(error instanceof Error ? error.message : "Voice diagnostics unavailable");
    }
  }

  async function startContinuousCall() {
    if (disabled) return;
    continuousCallRef.current = true;
    setContinuousCall(true);
    setMessage(null);
    await startRecording({ autoStopOnSilence: true });
  }

  function stopContinuousCall() {
    continuousCallRef.current = false;
    setContinuousCall(false);
    stopSilenceMonitor();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    chunksRef.current = [];
    audioRef.current?.pause();
    if (state !== "degraded") setState("idle");
  }

  async function startRecording(options: { autoStopOnSilence?: boolean } = {}) {
    if (disabled && state !== "recording") return;
    setMessage(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is not available in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopSilenceMonitor();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        stopStream(streamRef.current);
        streamRef.current = null;
        if (continuousCallRef.current && !heardVoiceRef.current) {
          setMessage("Listening");
          void startRecording({ autoStopOnSilence: true });
          return;
        }
        void sendVoiceBlob(blob);
      };
      recorder.start(250);
      if (options.autoStopOnSilence) startSilenceMonitor(stream, recorder);
      setState("recording");
    } catch (error) {
      setState("degraded");
      setMessage(error instanceof Error ? error.message : "Microphone capture failed");
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setState("sending");
    stopSilenceMonitor();
    recorder.stop();
  }

  async function sendVoiceBlob(blob: Blob) {
    setState("sending");
    try {
      if (blob.size < 900) {
        if (continuousCallRef.current) {
          setMessage("Listening");
          await startRecording({ autoStopOnSilence: true });
          return;
        }
        throw new Error("Voice recording was too short.");
      }
      const audioBase64 = await blobToBase64(blob);
      const response = await fetchJson<VoiceChatResponse>(`${apiBase}/voice/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audioBase64,
          mimeType: blob.type || "audio/webm",
          sessionId: threadId
        })
      });
      if (!response.transcript) throw new Error(response.degradedReason ?? "Voice transcript was empty.");
      logVoiceTiming(response.timing);
      pendingVoiceResponses.set(`${threadId ?? "new"}:${response.transcript}`, response);
      aui.thread().append({
        content: [{ type: "text", text: response.transcript }],
        runConfig: aui.composer().getState().runConfig
      });
      if (response.audioBase64 && response.mimeType) await playAudio(response.audioBase64, response.mimeType);
      setMessage(response.degradedReason ?? null);
      if (response.degradedReason) {
        setState("degraded");
        continuousCallRef.current = false;
        setContinuousCall(false);
      } else if (continuousCallRef.current && open) {
        await startRecording({ autoStopOnSilence: true });
      } else {
        setState("idle");
      }
      void refreshVoiceDiagnostics();
    } catch (error) {
      setState("degraded");
      continuousCallRef.current = false;
      setContinuousCall(false);
      setMessage(error instanceof Error ? error.message : "Voice chat failed");
      void refreshVoiceDiagnostics();
    }
  }

  function closeCall() {
    continuousCallRef.current = false;
    setContinuousCall(false);
    stopSilenceMonitor();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    chunksRef.current = [];
    audioRef.current?.pause();
    setOpen(false);
    if (state !== "degraded") setState("idle");
  }

  function startPanelDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const bounds = voiceCallPanelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const margin = 12;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panelPosition.x,
      originY: panelPosition.y,
      minX: panelPosition.x + margin - bounds.left,
      maxX: panelPosition.x + window.innerWidth - margin - bounds.right,
      minY: panelPosition.y + margin - bounds.top,
      maxY: panelPosition.y + window.innerHeight - margin - bounds.bottom
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function movePanel(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const panel = voiceCallPanelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    setPanelPosition({
      x: Math.min(Math.max(drag.originX + deltaX, drag.minX), drag.maxX),
      y: Math.min(Math.max(drag.originY + deltaY, drag.minY), drag.maxY)
    });
  }

  function endPanelDrag(event: React.PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }

  async function playAudio(audioBase64: string, mimeType: string) {
    if (!mimeType.startsWith("audio/")) return;
    setState("playing");
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audioRef.current = audio;
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.onpause = () => resolve();
      void audio.play().catch(() => resolve());
    });
  }

  function startSilenceMonitor(stream: MediaStream, recorder: MediaRecorder) {
    stopSilenceMonitor();
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    audioContextRef.current = audioContext;
    audioSourceRef.current = source;
    const samples = new Uint8Array(analyser.fftSize);
    recordingStartedAtRef.current = Date.now();
    lastVoiceAtRef.current = Date.now();
    heardVoiceRef.current = false;

    const tick = () => {
      if (recorder.state !== "recording") return;
      analyser.getByteTimeDomainData(samples);
      const level = rootMeanSquare(samples);
      const now = Date.now();
      if (level > 0.018) {
        heardVoiceRef.current = true;
        lastVoiceAtRef.current = now;
      }
      const elapsed = now - recordingStartedAtRef.current;
      const silenceMs = now - lastVoiceAtRef.current;
      if ((heardVoiceRef.current && elapsed > 900 && silenceMs > 1250) || elapsed > 20_000) {
        stopRecording();
        return;
      }
      silenceFrameRef.current = window.requestAnimationFrame(tick);
    };
    silenceFrameRef.current = window.requestAnimationFrame(tick);
  }

  function stopSilenceMonitor() {
    if (silenceFrameRef.current !== null) window.cancelAnimationFrame(silenceFrameRef.current);
    silenceFrameRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-8 rounded-full text-foreground voiceButton", state)}
              title={tooltip}
              aria-disabled={isRunning || !voiceStatus?.ready}
              data-testid="voice-slot"
              data-voice-state={state}
              onClick={openVoiceCall}
            />
          }
        >
          {state === "sending" ? <Upload size={20} /> : <Mic size={21} />}
        </TooltipTrigger>
        <TooltipContent>{message ?? tooltip}</TooltipContent>
      </Tooltip>
      {open && (
        <div className="voiceCallBackdrop" data-testid="voice-call-overlay" role="presentation">
          <section
            ref={voiceCallPanelRef}
            className={cn("voiceCallPanel", dragging && "dragging")}
            role="dialog"
            aria-modal="false"
            aria-label="Voice call"
            data-voice-state={state}
            style={{ transform: `translate3d(${panelPosition.x}px, ${panelPosition.y}px, 0)` }}
          >
            <header className="voiceCallHeader" onPointerDown={startPanelDrag} onPointerMove={movePanel} onPointerUp={endPanelDrag} onPointerCancel={endPanelDrag}>
              <div className="voiceCallIdentity" aria-hidden="true"><Radio size={13} /><span>VOICE LINK</span></div>
              <div className="voiceCallDragHandle" title="Drag to move"><GripHorizontal size={19} /></div>
              <Button variant="ghost" size="icon" className="voiceCallClose" onClick={closeCall} aria-label="Close voice call">
                <X size={18} />
              </Button>
            </header>
            <div className="voiceCallBody">
              <button
                type="button"
                className={cn("voiceAvatar", state === "recording" && "listening", state === "playing" && "speaking")}
                disabled={disabled && state !== "recording" && !continuousCall}
                onClick={continuousCall || state === "recording" ? stopContinuousCall : () => void startContinuousCall()}
                aria-label={continuousCall || state === "recording" ? "Stop Call" : "Start Call"}
              >
                <AudioLines size={44} />
                <span aria-hidden="true" />
              </button>
              <p className="voiceCallStatus">{callStatus}</p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function voiceCallStatusLabel(state: "idle" | "recording" | "sending" | "playing" | "degraded", status: VoiceStatus | null, message: string | null) {
  if (!status?.ready) return message ?? status?.degradedReason ?? "语音不可用";
  if (state === "recording") return "正在聆听";
  if (state === "sending") return "正在思考";
  if (state === "playing") return "正在回答";
  if (state === "degraded") return message ?? "语音异常";
  return "准备就绪";
}

function voiceNotReadyReason(status: VoiceStatus) {
  const reasons = [
    providerNotReadyReason("STT", status.stt),
    providerNotReadyReason("TTS", status.tts)
  ].filter(Boolean);
  return reasons.length > 0 ? reasons.join("；") : status.degradedReason ?? "语音服务未就绪";
}

function providerNotReadyReason(label: "STT" | "TTS", provider: ProviderStatus & { name: string }) {
  if (!provider.configured) return `${label} 未配置：${provider.degradedReason ?? provider.name}`;
  if (!provider.reachable) return `${label} 未就绪：${provider.degradedReason ?? provider.name}`;
  return undefined;
}

function logVoiceTiming(timing: VoiceChatResponse["timing"]) {
  if (!timing) return;
  console.info("[voice.chat timing]", {
    stt: formatMs(timing.sttMs),
    agent: formatMs(timing.agentMs),
    tts: formatMs(timing.ttsMs),
    total: formatMs(timing.totalMs)
  });
}

function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function pickAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function rootMeanSquare(samples: Uint8Array) {
  let sum = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / samples.length);
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] ?? "" : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio blob."));
    reader.readAsDataURL(blob);
  });
}
