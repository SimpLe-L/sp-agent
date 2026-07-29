import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { localSkillManifestSchema, type ImportRepositorySkillInput, type LocalSkillRecord } from "@sp-agent/shared";
import { listExtensionManifests } from "@sp-agent/extensions";
import { LocalJsonStore } from "./local-json-store.service.js";
import { McpService } from "./mcp.service.js";

type SkillFile = { skills: LocalSkillRecord[]; audit: Array<{ action: string; skillId: string; version: string; at: string; sourcePath?: string }> };
const FORBIDDEN_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);
const MAX_PACKAGE_FILES = 200;
const MAX_PACKAGE_BYTES = 25_000_000;
const MAX_REFERENCE_BYTES = 1_000_000;

@Injectable()
export class LocalSkillsService {
  constructor(private readonly store: LocalJsonStore, private readonly mcpService: McpService) {}

  async list() { return (await this.read()).skills; }

  async get(id: string, version?: string) {
    const candidates = (await this.read()).skills.filter((item) => item.id === id);
    const skill = version ? candidates.find((item) => item.version === version) : candidates.sort((left, right) => Number(right.status === "active") - Number(left.status === "active") || right.installedAt.localeCompare(left.installedAt))[0];
    if (!skill) throw new NotFoundException(`Local Skill ${id} not found`);
    return skill;
  }

  async import(sourcePath: string, sourceOrigin = sourcePath, sourceCommit?: string) {
    const source = resolve(sourcePath);
    const manifestPath = join(source, "skill.json");
    const skillPath = join(source, "SKILL.md");
    await this.validateTree(source);
    const instructions = await readFile(skillPath, "utf8").catch(() => { throw new BadRequestException("SKILL.md is required."); });
    if (!instructions.trim()) throw new BadRequestException("SKILL.md must not be empty.");
    const rawManifest = await readFile(manifestPath, "utf8").catch(() => undefined);
    let manifest: ReturnType<typeof localSkillManifestSchema.parse>;
    try {
      manifest = rawManifest ? localSkillManifestSchema.parse(JSON.parse(rawManifest)) : manifestFromSkillFrontMatter(instructions);
    } catch { throw new BadRequestException(rawManifest ? "skill.json is invalid." : "SKILL.md front matter must include name and description."); }
    const registeredTools = new Set(
      [...listExtensionManifests(), ...(await this.mcpService.manifests())].flatMap((extension) =>
        extension.capabilities.map((capability) => `${extension.id}.${capability.id}`)
      )
    );
    for (const tool of manifest.requestedTools) {
      if (!registeredTools.has(tool)) throw new BadRequestException(`Skill requests an unknown API tool: ${tool}`);
    }
    const validation = await this.packageValidation(source);
    const contentHash = await this.hashPackage(source);
    const destination = this.store.pathFor(join("skills", manifest.id, manifest.version));
    if (await lstat(destination).then(() => true).catch(() => false)) throw new BadRequestException(`Skill ${manifest.id}@${manifest.version} is already installed.`);
    await mkdir(destination, { recursive: true });
    await cp(source, destination, { recursive: true, dereference: false, filter: (path) => !FORBIDDEN_NAMES.has(basename(path)) });
    const file = await this.read();
    const now = new Date().toISOString();
    const record: LocalSkillRecord = { ...manifest, status: "disabled", sourcePath: sourceOrigin, sourceCommit, contentHash, validation: { ...validation, validatedAt: now }, installedAt: now };
    file.skills.push(record);
    file.audit.push({ action: "imported", skillId: manifest.id, version: manifest.version, at: now, sourcePath: sourceOrigin });
    await this.write(file);
    return record;
  }

  async importUploaded(files: Array<{ originalname: string; buffer: Buffer }>) {
    if (files.length === 0) throw new BadRequestException("Select a Skill folder to upload.");
    const staging = this.store.pathFor(join("skills", ".staging", crypto.randomUUID()));
    try {
      for (const file of files) {
        const path = safeRelativePath(file.originalname);
        const destination = join(staging, path);
        await mkdir(resolve(destination, ".."), { recursive: true });
        await writeFile(destination, file.buffer);
      }
      return await this.import(staging, "uploaded package");
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async importRepository(input: ImportRepositorySkillInput) {
    const repository = parseGitHubRepository(input.repositoryUrl);
    const skillPath = normalizeRepositoryPath(input.skillPath);
    const commit = await this.resolveGitHubCommit(repository, input.ref);
    const staging = this.store.pathFor(join("skills", ".staging", crypto.randomUUID()));
    const sourceOrigin = `${repository.webUrl}@${commit}${skillPath ? `/${skillPath}` : ""}`;
    try {
      await mkdir(staging, { recursive: true });
      const files = await this.listGitHubPackageFiles(repository, skillPath, commit);
      if (!files.some((file) => file.path === "SKILL.md")) throw new BadRequestException("SKILL.md was not found at the selected repository path.");
      await Promise.all(files.map(async (file) => {
        const destination = join(staging, file.path);
        await mkdir(resolve(destination, ".."), { recursive: true });
        await writeFile(destination, await this.readGitHubBlob(repository, file.sha), "utf8");
      }));
      return await this.import(staging, sourceOrigin, commit);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async setEnabled(id: string, enabled: boolean) {
    const file = await this.read();
    const skill = file.skills.filter((item) => item.id === id).sort((left, right) => right.installedAt.localeCompare(left.installedAt))[0];
    if (!skill) throw new NotFoundException(`Local Skill ${id} not found`);
    const now = new Date().toISOString();
    if (enabled) for (const candidate of file.skills.filter((item) => item.id === id)) candidate.status = "disabled";
    skill.status = enabled ? "active" : "disabled";
    skill.enabledAt = enabled ? now : undefined;
    file.audit.push({ action: enabled ? "enabled" : "disabled", skillId: skill.id, version: skill.version, at: now });
    await this.write(file);
    return skill;
  }

  async remove(id: string) {
    const file = await this.read();
    const matches = file.skills.filter((item) => item.id === id);
    const skill = matches.sort((left, right) => right.installedAt.localeCompare(left.installedAt))[0];
    if (!skill) throw new NotFoundException(`Local Skill ${id} not found`);
    await Promise.all(matches.map((item) => rm(this.store.pathFor(join("skills", item.id, item.version)), { recursive: true, force: true })));
    file.skills = file.skills.filter((item) => item.id !== id);
    file.audit.push({ action: "removed", skillId: skill.id, version: skill.version, at: new Date().toISOString() });
    await this.write(file);
    return { removed: true, id };
  }

  async activeManifests() { return (await this.list()).filter((skill) => skill.status === "active"); }

  async rollback(id: string, version: string) {
    const file = await this.read();
    const skill = file.skills.find((item) => item.id === id && item.version === version);
    if (!skill) throw new NotFoundException(`Local Skill ${id}@${version} not found`);
    for (const candidate of file.skills.filter((item) => item.id === id)) candidate.status = "disabled";
    skill.status = "active";
    skill.enabledAt = new Date().toISOString();
    file.audit.push({ action: "rolled_back", skillId: id, version, at: skill.enabledAt });
    await this.write(file);
    return skill;
  }

  async loadInstructions(id: string) {
    const skill = await this.get(id);
    if (skill.status !== "active") throw new BadRequestException(`Local Skill ${id} is disabled.`);
    const instructions = await readFile(this.store.pathFor(join("skills", skill.id, skill.version, "SKILL.md")), "utf8");
    return { skillId: skill.id, version: skill.version, instructions, requestedTools: skill.requestedTools, outputArtifact: skill.outputArtifact };
  }

  async loadReference(id: string, referencePath: string) {
    const skill = await this.get(id);
    if (skill.status !== "active") throw new BadRequestException(`Local Skill ${id} is disabled.`);
    const root = this.store.pathFor(join("skills", skill.id, skill.version));
    const path = resolve(root, safeRelativePath(referencePath));
    if (!path.startsWith(`${root}${sep}`)) throw new BadRequestException("Reference path must stay within the installed Skill package.");
    const stat = await lstat(path).catch(() => { throw new NotFoundException(`Skill reference ${referencePath} was not found`); });
    if (!stat.isFile() || stat.size > MAX_REFERENCE_BYTES) throw new BadRequestException("Skill reference must be a file smaller than 1 MB.");
    return { skillId: skill.id, path: referencePath, content: await readFile(path, "utf8") };
  }

  async resolveSandboxScript(id: string, version: string | undefined, scriptPath: string) {
    const skill = await this.get(id, version);
    if (skill.status !== "active") throw new BadRequestException(`Local Skill ${id} is disabled.`);
    const root = this.store.pathFor(join("skills", skill.id, skill.version));
    const path = resolve(root, safeRelativePath(scriptPath));
    if (!path.startsWith(`${root}${sep}`)) throw new BadRequestException("Script path must stay within the installed Skill package.");
    const stat = await lstat(path).catch(() => { throw new NotFoundException(`Skill script ${scriptPath} was not found`); });
    if (!stat.isFile() || stat.isSymbolicLink() || !/\.(?:cjs|js|mjs)$/iu.test(path)) throw new BadRequestException("Only regular JavaScript Skill scripts may run in the sandbox.");
    return { skill, root, path };
  }

  private async validateTree(root: string) {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { throw new BadRequestException("Skill source directory cannot be read."); }
    for (const entry of entries) {
      if (FORBIDDEN_NAMES.has(entry.name)) throw new BadRequestException(`Unsafe package entry: ${entry.name}`);
      const path = join(root, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new BadRequestException(`Symbolic links are not allowed: ${relative(root, path)}`);
      if (stat.isDirectory()) await this.validateTree(path);
    }
  }

  private async packageValidation(root: string) {
    const files: Array<{ path: string; size: number }> = [];
    const collect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (FORBIDDEN_NAMES.has(entry.name)) continue;
        const path = join(directory, entry.name);
        const stat = await lstat(path);
        if (stat.isDirectory()) await collect(path);
        else if (stat.isFile()) files.push({ path: relative(root, path), size: stat.size });
      }
    };
    await collect(root);
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (files.length > MAX_PACKAGE_FILES || totalBytes > MAX_PACKAGE_BYTES) throw new BadRequestException(`Skill package exceeds the ${MAX_PACKAGE_FILES} file or ${MAX_PACKAGE_BYTES / 1_000_000} MB import limit.`);
    return { fileCount: files.length, totalBytes };
  }

  private async hashPackage(root: string) {
    const files: string[] = [];
    const collect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (FORBIDDEN_NAMES.has(entry.name)) continue;
        const path = join(directory, entry.name);
        const stat = await lstat(path);
        if (stat.isDirectory()) await collect(path);
        else if (stat.isFile()) files.push(relative(root, path).replaceAll(sep, "/"));
      }
    };
    await collect(root);
    const hash = createHash("sha256");
    for (const file of files.sort((left, right) => left.localeCompare(right))) {
      hash.update(file).update("\0").update(await readFile(join(root, file))).update("\0");
    }
    return hash.digest("hex");
  }

  private async resolveGitHubCommit(repository: GitHubRepository, ref: string) {
    const response = await fetch(`${repository.apiUrl}/commits/${encodeURIComponent(ref)}`, { headers: githubHeaders(), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new BadRequestException(`GitHub could not resolve revision ${ref}.`);
    const body = await response.json() as { sha?: unknown };
    if (typeof body.sha !== "string" || !/^[a-f0-9]{40}$/iu.test(body.sha)) throw new BadRequestException("GitHub returned an invalid commit revision.");
    return body.sha;
  }

  private async listGitHubPackageFiles(repository: GitHubRepository, skillPath: string, commit: string) {
    const response = await fetch(`${repository.apiUrl}/git/trees/${encodeURIComponent(commit)}?recursive=1`, { headers: githubHeaders(), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new BadRequestException("GitHub could not list the selected Skill directory.");
    const body = await response.json() as { truncated?: unknown; tree?: Array<{ path?: unknown; mode?: unknown; type?: unknown; size?: unknown; sha?: unknown }> };
    if (body.truncated === true || !Array.isArray(body.tree)) throw new BadRequestException("GitHub returned an incomplete Skill directory listing.");
    const prefix = skillPath ? `${skillPath}/` : "";
    const files = body.tree.flatMap((entry) => {
      if (typeof entry.path !== "string" || !entry.path.startsWith(prefix)) return [];
      const path = entry.path.slice(prefix.length);
      if (!path || entry.type !== "blob" || typeof entry.sha !== "string") return [];
      if (entry.mode === "120000") throw new BadRequestException(`Symbolic links are not allowed: ${path}`);
      safeRelativePath(path);
      if (path.split("/").some((part) => FORBIDDEN_NAMES.has(part))) return [];
      const size = typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : 0;
      return [{ path, sha: entry.sha, size }];
    });
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (files.length === 0 || files.length > MAX_PACKAGE_FILES || totalBytes > MAX_PACKAGE_BYTES) {
      throw new BadRequestException(`Skill package exceeds the ${MAX_PACKAGE_FILES} file or ${MAX_PACKAGE_BYTES / 1_000_000} MB import limit.`);
    }
    return files;
  }

  private async readGitHubBlob(repository: GitHubRepository, sha: string) {
    const response = await fetch(`${repository.apiUrl}/git/blobs/${encodeURIComponent(sha)}`, { headers: githubHeaders(), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new BadRequestException("GitHub could not download a Skill package file.");
    const body = await response.json() as { encoding?: unknown; content?: unknown };
    if (body.encoding !== "base64" || typeof body.content !== "string") throw new BadRequestException("GitHub returned an invalid Skill package file.");
    return Buffer.from(body.content.replace(/\n/g, ""), "base64");
  }

  private async read(): Promise<SkillFile> { return this.store.read("skills/index.json", { skills: [], audit: [] }); }
  private async write(value: SkillFile) { await this.store.write("skills/index.json", value); }
}

type GitHubRepository = { apiUrl: string; webUrl: string };

function parseGitHubRepository(value: string): GitHubRepository {
  let url: URL;
  try { url = new URL(value); } catch { throw new BadRequestException("Repository URL must be a valid GitHub repository URL."); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.search || url.hash) {
    throw new BadRequestException("Only a public https://github.com/owner/repository URL is supported.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+(?:\.git)?$/.test(parts[1])) {
    throw new BadRequestException("Repository URL must have the form https://github.com/owner/repository.");
  }
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");
  return { apiUrl: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, webUrl: `https://github.com/${owner}/${repository}` };
}

function normalizeRepositoryPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new BadRequestException("Skill path must stay within the repository.");
  return normalized;
}

function githubHeaders() {
  return { accept: "application/vnd.github+json", "user-agent": "sp-agent-skill-importer" };
}

function manifestFromSkillFrontMatter(instructions: string) {
  const frontMatter = /^---\s*\n([\s\S]*?)\n---/u.exec(instructions)?.[1] ?? "";
  const value = (key: string) => new RegExp(`^${key}:\\s*[\"']?(.+?)[\"']?\\s*$`, "mu").exec(frontMatter)?.[1]?.trim();
  const name = value("name");
  const description = value("description");
  if (!name || !description) throw new Error("missing front matter");
  return localSkillManifestSchema.parse({ id: name, version: value("version") ?? "0.0.0", name, description, inputSchema: {}, requestedTools: [] });
}

function safeRelativePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new BadRequestException("Uploaded Skill contains an unsafe file path.");
  }
  return normalized.split("/").join(sep);
}
