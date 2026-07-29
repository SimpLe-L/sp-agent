import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import {
  consolidateMemorySchema,
  createMemoryCandidateSchema,
  extractMemoryFromSessionSchema,
  mergeMemorySchema,
  promoteMemorySchema,
  searchMemorySchema,
  summarizeMemorySessionSchema,
  updateMemorySchema
} from "@sp-agent/shared";
import { MemoryService } from "./memory.service.js";
import { ExtensionsService } from "./extensions.service.js";

@Controller("memory")
export class MemoryController {
  constructor(
    @Inject(MemoryService) private readonly memoryService: MemoryService,
    @Inject(ExtensionsService) private readonly extensionsService: ExtensionsService
  ) {}

  @Get()
  async list() {
    return {
      memories: await this.memoryService.list()
    };
  }

  @Get("search")
  async search(@Query() query: unknown) {
    const input = searchMemorySchema.parse(query);
    return this.memoryService.search(input);
  }

  @Get("audit")
  async audit(@Query("memoryId") memoryId?: string) {
    return {
      auditEvents: await this.memoryService.audit(memoryId)
    };
  }

  @Post("candidates")
  async createCandidate(@Body() body: unknown) {
    const input = createMemoryCandidateSchema.parse(body);
    return this.invoke("memory.write_candidate", input);
  }

  @Post("extract/session")
  async extractFromSession(@Body() body: unknown) {
    const input = extractMemoryFromSessionSchema.parse(body);
    return this.invoke("memory.extract_session", input);
  }

  @Post("summaries/session")
  async summarizeSession(@Body() body: unknown) {
    const input = summarizeMemorySessionSchema.parse(body);
    return this.invoke("memory.summarize_session", input);
  }

  @Post("consolidate")
  async consolidate(@Body() body: unknown) {
    const input = consolidateMemorySchema.parse(body ?? {});
    return this.memoryService.consolidate(input);
  }

  @Post("merge")
  async merge(@Body() body: unknown) {
    const input = mergeMemorySchema.parse(body);
    return this.invoke("memory.merge", input);
  }

  @Post(":id/promote")
  async promote(@Param("id") id: string, @Body() body: unknown) {
    const input = promoteMemorySchema.parse(body ?? {});
    return this.invoke("memory.promote_fact", { ...input, id });
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const input = updateMemorySchema.parse(body);
    return this.invoke("memory.update", { ...input, id });
  }

  @Delete(":id")
  async tombstone(@Param("id") id: string) {
    return this.invoke("memory.forget", { id });
  }

  private async invoke(capabilityId: string, input: Record<string, unknown>) {
    const response = await this.extensionsService.invoke("local.memory", { capabilityId, input });
    return response.result;
  }
}
