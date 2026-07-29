import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { createMcpServerSchema, updateMcpServerSchema } from "@sp-agent/shared";
import { McpService } from "./mcp.service.js";

@Controller("mcp/servers")
export class McpController {
  constructor(@Inject(McpService) private readonly mcpService: McpService) {}

  @Get()
  list() { return this.mcpService.list(); }

  @Post()
  create(@Body() body: unknown) { return this.mcpService.create(createMcpServerSchema.parse(body)); }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown) { return this.mcpService.update(id, updateMcpServerSchema.parse(body)); }

  @Post(":id/discover")
  discover(@Param("id") id: string) { return this.mcpService.discover(id); }

  @Delete(":id")
  remove(@Param("id") id: string) { return this.mcpService.remove(id); }
}
