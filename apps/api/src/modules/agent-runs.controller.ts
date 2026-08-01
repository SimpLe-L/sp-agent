import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { AgentRunsService } from "./agent-runs.service.js";

@Controller("agent/runs")
export class AgentRunsController {
  constructor(@Inject(AgentRunsService) private readonly agentRunsService: AgentRunsService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.agentRunsService.list(Math.min(Math.max(Number(limit) || 30, 1), 100));
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.agentRunsService.get(id);
  }
}
