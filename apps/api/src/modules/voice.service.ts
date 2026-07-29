import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  VoiceChatInput,
  VoiceChatResponse,
  VoiceStatus,
  VoiceSynthesizeInput,
  VoiceSynthesizeResponse,
  VoiceTranscribeInput,
  VoiceTranscribeResponse
} from "@sp-agent/shared";
import { AgentShellService } from "./agent-shell.service.js";
import { SpeechIoService } from "./speech-io.service.js";

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    @Inject(AgentShellService) private readonly agentShellService: AgentShellService,
    @Inject(SpeechIoService) private readonly speechIoService: SpeechIoService
  ) {}

  async status(): Promise<VoiceStatus> {
    return this.speechIoService.status();
  }

  async audit(sessionId?: string) {
    return this.speechIoService.audit(sessionId);
  }

  async transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResponse> {
    return this.speechIoService.transcribe(input);
  }

  async synthesize(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResponse> {
    return this.speechIoService.synthesize(input);
  }

  async chat(input: VoiceChatInput): Promise<VoiceChatResponse> {
    const startedAt = Date.now();
    const transcript = await this.transcribe(input);
    const transcribedAt = Date.now();
    if (!transcript.transcript) {
      const timing = {
        sttMs: transcribedAt - startedAt,
        agentMs: 0,
        ttsMs: 0,
        totalMs: transcribedAt - startedAt
      };
      this.logger.warn(`voice.chat degraded timing stt=${timing.sttMs}ms agent=0ms tts=0ms total=${timing.totalMs}ms reason=${transcript.degradedReason ?? "missing transcript"}`);
      return {
        sessionId: input.sessionId ?? "",
        assistantText: "",
        timing,
        degradedReason: transcript.degradedReason ?? "STT provider did not return a transcript."
      };
    }

    const assistant = await this.agentShellService.runMessage({
      content: transcript.transcript,
      sessionId: input.sessionId,
      extensionIds: []
    }, {
      source: "voice",
      sttProvider: transcript.provider,
      audioPersisted: false
    });
    const agentCompletedAt = Date.now();
    const audio = await this.synthesize({
      text: assistant.content,
      voice: input.voice,
      sessionId: assistant.sessionId
    });
    const completedAt = Date.now();
    const timing = {
      sttMs: transcribedAt - startedAt,
      agentMs: agentCompletedAt - transcribedAt,
      ttsMs: completedAt - agentCompletedAt,
      totalMs: completedAt - startedAt
    };
    this.logger.log(`voice.chat timing stt=${timing.sttMs}ms agent=${timing.agentMs}ms tts=${timing.ttsMs}ms total=${timing.totalMs}ms session=${assistant.sessionId}`);
    return {
      sessionId: assistant.sessionId,
      transcript: transcript.transcript,
      assistantText: assistant.content,
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
      timing,
      degradedReason: [transcript.degradedReason, assistant.degradedReason, audio.degradedReason].filter(Boolean).join(" ") || undefined
    };
  }
}
