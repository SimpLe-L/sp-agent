import { Module } from "@nestjs/common";
import { AgentShellController } from "./agent-shell.controller.js";
import { AgentShellService } from "./agent-shell.service.js";
import { ApprovalsController } from "./approvals.controller.js";
import { ApprovalsService } from "./approvals.service.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { ExtensionsController } from "./extensions.controller.js";
import { ExtensionsService } from "./extensions.service.js";
import { HealthController } from "./health.controller.js";
import { LocalJsonStore } from "./local-json-store.service.js";
import { LocalSkillsController } from "./local-skills.controller.js";
import { LocalSkillsService } from "./local-skills.service.js";
import { MemoryController } from "./memory.controller.js";
import { MemoryEmbeddingService } from "./memory-embedding.service.js";
import { MemoryIntelligenceService } from "./memory-intelligence.service.js";
import { MemoryService } from "./memory.service.js";
import { MemoryVectorService } from "./memory-vector.service.js";
import { ProvidersController } from "./providers.controller.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";
import { VoiceAuditService } from "./voice-audit.service.js";
import { VoiceController } from "./voice.controller.js";
import { VoiceService } from "./voice.service.js";
import { WorkflowsController } from "./workflows.controller.js";
import { WorkflowsService } from "./workflows.service.js";
import { WorkspaceService } from "./workspace.service.js";
import { LangGraphWorkflowEngine } from "./langgraph-workflow-engine.service.js";
import { SkillScriptService } from "./skill-script.service.js";
import { CapabilityAuditService } from "./capability-audit.service.js";
import { CapabilityAuditController } from "./capability-audit.controller.js";
import { McpController } from "./mcp.controller.js";
import { McpService } from "./mcp.service.js";
import { SpeechIoService } from "./speech-io.service.js";
import { ArtifactService } from "./artifact.service.js";
import { WebService } from "./web.service.js";

@Module({
  controllers: [
    HealthController,
    ProvidersController,
    SettingsController,
    ChatController,
    MemoryController,
    AgentShellController,
    ExtensionsController,
    LocalSkillsController,
    ApprovalsController,
    WorkflowsController,
    VoiceController,
    CapabilityAuditController,
    McpController
  ],
  providers: [
    LocalJsonStore,
    LocalSkillsService,
    SettingsService,
    ChatService,
    MemoryService,
    MemoryIntelligenceService,
    MemoryEmbeddingService,
    MemoryVectorService,
    AgentShellService,
    ExtensionsService,
    ApprovalsService,
    WorkflowsService,
    WorkspaceService,
    LangGraphWorkflowEngine,
    SkillScriptService,
    CapabilityAuditService,
    McpService,
    ArtifactService,
    WebService,
    SpeechIoService,
    VoiceAuditService,
    VoiceService
  ]
})
export class AppModule {}
