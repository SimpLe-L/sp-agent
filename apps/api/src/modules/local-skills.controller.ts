import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { importLocalSkillSchema, importRepositorySkillSchema } from "@sp-agent/shared";
import { LocalSkillsService } from "./local-skills.service.js";

@Controller("skills")
export class LocalSkillsController {
  constructor(@Inject(LocalSkillsService) private readonly skills: LocalSkillsService) {}
  @Get() list() { return this.skills.list(); }
  @Get(":id") get(@Param("id") id: string, @Query("version") version?: string) { return this.skills.get(id, version); }
  @Post("import") import(@Body() body: unknown) { return this.skills.import(importLocalSkillSchema.parse(body).sourcePath); }
  @Post("import-repository") importRepository(@Body() body: unknown) { return this.skills.importRepository(importRepositorySkillSchema.parse(body)); }
  @Post("import-upload")
  @UseInterceptors(FilesInterceptor("files", 120, { preservePath: true, limits: { fileSize: 10_000_000, files: 120 } }))
  importUpload(@UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }> = []) { return this.skills.importUploaded(files); }
  @Patch(":id/enable") enable(@Param("id") id: string) { return this.skills.setEnabled(id, true); }
  @Patch(":id/disable") disable(@Param("id") id: string) { return this.skills.setEnabled(id, false); }
  @Patch(":id/rollback") rollback(@Param("id") id: string, @Body() body: { version?: string }) { return this.skills.rollback(id, body.version ?? ""); }
  @Delete(":id") remove(@Param("id") id: string) { return this.skills.remove(id); }
}
