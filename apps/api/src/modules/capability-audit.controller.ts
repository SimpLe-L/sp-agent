import { Controller, Get, Inject, Query } from "@nestjs/common";
import { CapabilityAuditService } from "./capability-audit.service.js";

@Controller("audit/capabilities")
export class CapabilityAuditController {
  constructor(@Inject(CapabilityAuditService) private readonly capabilityAuditService: CapabilityAuditService) {}

  @Get()
  async list(@Query("sessionId") sessionId?: string, @Query("extensionId") extensionId?: string, @Query("limit") rawLimit?: string) {
    const parsedLimit = rawLimit ? Number(rawLimit) : undefined;
    return {
      events: await this.capabilityAuditService.list({
        sessionId,
        extensionId,
        limit: Number.isInteger(parsedLimit) && parsedLimit! > 0 ? Math.min(parsedLimit!, 500) : undefined
      })
    };
  }
}
