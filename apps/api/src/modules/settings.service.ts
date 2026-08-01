import { Inject, Injectable } from "@nestjs/common";
import { getAgentRuntimeStatus } from "@sp-agent/agent-runtime";
import { getSpeechStatus } from "@sp-agent/speech";
import type { AppSettings, ProviderReadinessItem } from "@sp-agent/shared";
import { MemoryIntelligenceService } from "./memory-intelligence.service.js";
import { MemoryVectorService } from "./memory-vector.service.js";

@Injectable()
export class SettingsService {
  constructor(
    @Inject(MemoryVectorService) private readonly memoryVectorService: MemoryVectorService,
    @Inject(MemoryIntelligenceService) private readonly memoryIntelligenceService: MemoryIntelligenceService
  ) {}

  private settings: AppSettings = {
    llmProvider: "pi",
    model: process.env.LLM_MODEL || process.env.PI_MODEL_ID || "deepseek-v4-flash",
    dataRetentionDays: 365
  };

  get() {
    return this.settings;
  }

  async readiness(): Promise<{ items: ProviderReadinessItem[] }> {
    const piRuntime = await getAgentRuntimeStatus(process.env);
    const speech = await getSpeechStatus(process.env);
    const memoryVector = this.memoryVectorService.getStatus();
    const memoryIntelligence = this.memoryIntelligenceService.getStatus();
    return {
      items: [
        {
          id: "pi-runtime",
          label: "Pi SDK Agent runtime",
          status: piRuntime.reachable ? "ready" : piRuntime.configured ? "degraded" : "missing",
          capability: "Default runtime adapter for local personal-agent turns",
          envVars: [
            "AGENT_RUNTIME_PROVIDER",
            "PI_MODEL_PROVIDER",
            "PI_MODEL_ID",
            "LLM_BASE_URL",
            "LLM_MODEL",
            "LLM_API_KEY",
            "PI_AGENT_RUNTIME_TIMEOUT_MS",
            "PI_THINKING_LEVEL",
            "PI_WORKING_DIR"
          ],
          envTemplate: [
            "AGENT_RUNTIME_PROVIDER=pi",
            "PI_MODEL_PROVIDER=deepseek",
            "PI_MODEL_ID=deepseek-v4-flash",
            "LLM_BASE_URL=https://api.deepseek.com",
            "LLM_MODEL=deepseek-v4-flash",
            "LLM_API_KEY=",
            "PI_AGENT_RUNTIME_TIMEOUT_MS=120000",
            "PI_THINKING_LEVEL=off",
            "PI_WORKING_DIR="
          ].join("\n"),
          action: piRuntime.reachable
            ? "Runtime adapter is ready."
            : "Fill LLM_API_KEY, then restart the API.",
          docsHint: piRuntime.degradedReason
        },
        {
          id: "memory-layer",
          label: "Local long-term memory",
          status: "ready",
          capability: "App-owned memory search, write candidates, update, and forget",
          envVars: ["SP_AGENT_DATA_DIR"],
          action: "Memory is ready for local use.",
          docsHint: "Memory is persisted as local JSON in SP_AGENT_DATA_DIR or .sp-agent-data by default."
        },
        {
          id: "memory-vector-index",
          label: "Memory vector index",
          status: memoryVector.enabled ? readinessStatus(memoryVector.embedding.configured, memoryVector.embedding.reachable) : "manual",
          capability: "Optional LanceDB retrieval accelerator using deterministic or SiliconFlow BGE-M3 embeddings",
          envVars: [
            "MEMORY_VECTOR_PROVIDER",
            "MEMORY_LANCEDB_URI",
            "MEMORY_EMBEDDING_PROVIDER",
            "SILICONFLOW_BASE_URL",
            "SILICONFLOW_API_KEY",
            "SILICONFLOW_EMBEDDING_MODEL",
            "MEMORY_EMBEDDING_TIMEOUT_MS"
          ],
          envTemplate: [
            "MEMORY_VECTOR_PROVIDER=lancedb",
            "MEMORY_LANCEDB_URI=.sp-agent-data/lancedb",
            "# Leave unset to use SiliconFlow automatically when SILICONFLOW_API_KEY is present.",
            "MEMORY_EMBEDDING_PROVIDER=siliconflow",
            "SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1",
            "SILICONFLOW_EMBEDDING_MODEL=BAAI/bge-m3",
            "SILICONFLOW_API_KEY="
          ].join("\n"),
          action: memoryVector.enabled
            ? "Vector-backed memory reranking is enabled."
            : "Set MEMORY_VECTOR_PROVIDER=lancedb to enable vector-backed memory reranking.",
          docsHint: memoryVector.enabled
            ? memoryVector.embedding.degradedReason ?? `Current memory embedding provider: ${memoryVector.embedding.name}.`
            : "Vector search is optional; JSON-backed lexical/temporal memory search remains available when disabled."
        },
        {
          id: "memory-intelligence",
          label: "Memory intelligence",
          status: readinessStatus(memoryIntelligence.configured, memoryIntelligence.reachable),
          capability: "Optional LLM-backed memory extraction and summarization with deterministic fallback",
          envVars: [
            "MEMORY_INTELLIGENCE_PROVIDER",
            "MEMORY_INTELLIGENCE_MODEL",
            "MEMORY_INTELLIGENCE_TIMEOUT_MS",
            "SILICONFLOW_BASE_URL",
            "SILICONFLOW_API_KEY"
          ],
          envTemplate: [
            "# Leave deterministic unless you explicitly want provider-backed extraction/summarization.",
            "MEMORY_INTELLIGENCE_PROVIDER=deterministic",
            "# MEMORY_INTELLIGENCE_PROVIDER=siliconflow",
            "MEMORY_INTELLIGENCE_MODEL=deepseek-ai/DeepSeek-V4-Flash",
            "SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1",
            "SILICONFLOW_API_KEY="
          ].join("\n"),
          action: memoryIntelligence.reachable
            ? "Memory extraction/summarization can use the configured intelligence provider; deterministic fallback remains available."
            : "Set MEMORY_INTELLIGENCE_PROVIDER=deterministic, or configure SILICONFLOW_API_KEY for provider-backed extraction.",
          docsHint: memoryIntelligence.degradedReason ?? `Current memory intelligence provider: ${memoryIntelligence.name}.`
        },
        {
          id: "speech-stt",
          label: "Speech STT provider",
          status: readinessStatus(speech.stt.configured, speech.stt.reachable),
          capability: "Transcribe recorded audio before it enters the normal agent message path",
          envVars: [
            "SPEECH_STT_PROVIDER",
            "OPENAI_TRANSCRIPTIONS_STT_URL",
            "OPENAI_TRANSCRIPTIONS_STT_MODEL",
            "OPENAI_TRANSCRIPTIONS_STT_API_KEY",
            "OPENAI_COMPATIBLE_STT_URL",
            "OPENAI_COMPATIBLE_STT_API_KEY",
            "OPENAI_COMPATIBLE_STT_MODEL"
          ],
          envTemplate: [
            "SPEECH_STT_PROVIDER=openai-audio-transcriptions-stt",
            "OPENAI_TRANSCRIPTIONS_STT_URL=http://127.0.0.1:8000/v1/audio/transcriptions",
            "OPENAI_TRANSCRIPTIONS_STT_MODEL=sensevoice",
            "OPENAI_TRANSCRIPTIONS_STT_API_KEY=",
            "OPENAI_TRANSCRIPTIONS_STT_RESPONSE_FORMAT=verbose_json"
          ].join("\n"),
          action: speech.stt.reachable
            ? "STT provider is ready."
            : "Configure SPEECH_STT_PROVIDER and the selected STT provider environment variables, then restart the API.",
          docsHint: speech.stt.degradedReason ?? "Raw audio is not persisted by default."
        },
        {
          id: "speech-tts",
          label: "Speech TTS provider",
          status: readinessStatus(speech.tts.configured, speech.tts.reachable),
          capability: "Synthesize assistant text into audio after the normal agent response",
          envVars: [
            "SPEECH_TTS_PROVIDER",
            "MINIMAX_API_KEY",
            "MINIMAX_GROUP_ID",
            "MINIMAX_TTS_URL",
            "MINIMAX_TTS_MODEL",
            "MINIMAX_TTS_VOICE_ID",
            "MINIMAX_TTS_FORMAT",
            "MIMO_TTS_URL",
            "MIMO_API_KEY",
            "MIMO_TTS_MODEL",
            "MIMO_TTS_VOICE",
            "MIMO_TTS_FORMAT",
            "MIMO_TTS_STYLE_PROMPT",
            "GPT_SOVITS_TTS_URL",
            "GPT_SOVITS_REF_AUDIO_PATH",
            "GPT_SOVITS_PROMPT_TEXT",
            "GPT_SOVITS_TEXT_LANG",
            "GPT_SOVITS_PROMPT_LANG",
            "GPT_SOVITS_TEXT_SPLIT_METHOD"
          ],
          envTemplate: [
            "# Cloud TTS path for machines that cannot run GPT-SoVITS locally.",
            "SPEECH_TTS_PROVIDER=minimax-t2a-v2",
            "MINIMAX_TTS_URL=https://api.minimax.chat/v1/t2a_v2",
            "MINIMAX_API_KEY=",
            "MINIMAX_GROUP_ID=",
            "MINIMAX_TTS_MODEL=speech-02-hd",
            "MINIMAX_TTS_VOICE_ID=",
            "MINIMAX_TTS_FORMAT=mp3",
            "",
            "# Xiaomi MiMo cloud TTS path.",
            "# SPEECH_TTS_PROVIDER=mimo-v2.5-tts",
            "MIMO_TTS_URL=https://api.xiaomimimo.com/v1/chat/completions",
            "MIMO_API_KEY=",
            "MIMO_TTS_MODEL=mimo-v2.5-tts",
            "MIMO_TTS_VOICE=mimo_default",
            "MIMO_TTS_FORMAT=mp3",
            "MIMO_TTS_STYLE_PROMPT=",
            "",
            "# Optional local TTS path.",
            "# SPEECH_TTS_PROVIDER=gpt-sovits-api",
            "# GPT_SOVITS_TTS_URL=http://127.0.0.1:9880/tts",
            "# GPT_SOVITS_REF_AUDIO_PATH=",
            "# GPT_SOVITS_PROMPT_TEXT=",
            "# GPT_SOVITS_TEXT_LANG=zh",
            "# GPT_SOVITS_PROMPT_LANG=zh",
            "# GPT_SOVITS_TEXT_SPLIT_METHOD=cut0"
          ].join("\n"),
          action: speech.tts.reachable
            ? "TTS provider is ready."
            : "Configure SPEECH_TTS_PROVIDER=minimax-t2a-v2 for cloud TTS, or gpt-sovits-api for a local service, then restart the API.",
          docsHint: speech.tts.degradedReason ?? "TTS is optional; cloud TTS is supported through the same API-owned speech boundary."
        }
      ]
    };
  }

  update(next: Partial<AppSettings>) {
    this.settings = {
      ...this.settings,
      ...next
    };
    return this.settings;
  }
}

function readinessStatus(configured: boolean, reachable: boolean): ProviderReadinessItem["status"] {
  if (reachable) return "ready";
  return configured ? "degraded" : "missing";
}
