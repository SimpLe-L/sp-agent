import { BadRequestException, Injectable } from "@nestjs/common";
import type { ArtifactWriteCsvInput, ArtifactWriteMarkdownInput } from "@sp-agent/shared";
import { WorkspaceService } from "./workspace.service.js";

@Injectable()
export class ArtifactService {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async writeMarkdown(input: ArtifactWriteMarkdownInput) {
    requireExtension(input.path, ".md");
    const content = input.title ? `# ${input.title}\n\n${input.content.trimEnd()}\n` : `${input.content.trimEnd()}\n`;
    const file = await this.workspaceService.write(input.path, content, input.createOnly);
    return { ...file, kind: "markdown", mimeType: "text/markdown", title: input.title };
  }

  async writeCsv(input: ArtifactWriteCsvInput) {
    requireExtension(input.path, ".csv");
    const content = [input.columns, ...input.rows].map((row) => row.map(toCsvCell).join(",")).join("\n") + "\n";
    const file = await this.workspaceService.write(input.path, content, input.createOnly);
    return { ...file, kind: "csv", mimeType: "text/csv", columns: input.columns, rowCount: input.rows.length };
  }
}

function requireExtension(path: string, extension: string) {
  if (!path.toLowerCase().endsWith(extension)) throw new BadRequestException(`Artifact path must end with ${extension}.`);
}

function toCsvCell(value: string | number | boolean | null) {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
