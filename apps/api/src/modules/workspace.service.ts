import { BadRequestException, Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next", ".sp-agent-data"]);
const MAX_FILE_BYTES = 1_000_000;

@Injectable()
export class WorkspaceService {
  private readonly root = resolve(process.env.SP_AGENT_WORKSPACE_ROOT ?? process.env.SP_AGENT_PROJECT_ROOT ?? process.cwd());

  async list(path: string, depth: number, limit: number) {
    const root = await this.workspaceRoot();
    const directory = await this.resolveExisting(path, root, true);
    const entries: Array<{ path: string; type: "file" | "directory"; size?: number }> = [];
    await this.walk(directory, root, depth, limit, entries);
    return { root, path: this.relativePath(root, directory), entries, truncated: entries.length >= limit };
  }

  async read(path: string, offsetBytes: number, maxBytes: number) {
    const root = await this.workspaceRoot();
    const file = await this.resolveExisting(path, root, false);
    const stat = await lstat(file);
    if (!stat.isFile()) throw new BadRequestException("Workspace path must be a regular file.");
    if (stat.size > MAX_FILE_BYTES) throw new BadRequestException("Workspace file exceeds the configured read limit.");
    if (offsetBytes >= stat.size) {
      return { path: this.relativePath(root, file), content: "", size: stat.size, offsetBytes, bytesRead: 0, truncated: false };
    }
    const content = await readFile(file);
    const end = Math.min(offsetBytes + Math.min(maxBytes, MAX_FILE_BYTES), content.byteLength);
    return {
      path: this.relativePath(root, file),
      content: content.subarray(offsetBytes, end).toString("utf8"),
      size: stat.size,
      offsetBytes,
      bytesRead: end - offsetBytes,
      truncated: end < content.byteLength,
      nextOffsetBytes: end < content.byteLength ? end : undefined
    };
  }

  async search(query: string, path: string, maxResults: number) {
    const root = await this.workspaceRoot();
    const target = await this.resolveExisting(path, root, true);
    const files: string[] = [];
    await this.collectFiles(target, root, files, 2_000);
    const needle = query.toLowerCase();
    const results: Array<{ path: string; line: number; preview: string }> = [];
    for (const file of files) {
      if (results.length >= maxResults) break;
      const stat = await lstat(file);
      if (stat.size > MAX_FILE_BYTES) continue;
      const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
      for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
        if (lines[index].toLowerCase().includes(needle)) results.push({ path: this.relativePath(root, file), line: index + 1, preview: lines[index].slice(0, 600) });
      }
    }
    return { query, results, searchedFiles: files.length };
  }

  async write(path: string, content: string, createOnly: boolean) {
    const root = await this.workspaceRoot();
    const target = await this.resolveWritable(path, root);
    const exists = await lstat(target).catch(() => undefined);
    if (exists?.isSymbolicLink()) throw new BadRequestException("Workspace writes through symbolic links are not allowed.");
    if (exists && !exists.isFile()) throw new BadRequestException("Workspace write target must be a regular file.");
    if (createOnly && exists) throw new BadRequestException("Workspace file already exists.");
    await writeFile(target, content, "utf8");
    return { path: this.relativePath(root, target), bytesWritten: Buffer.byteLength(content) };
  }

  async applyPatch(patch: string, cwd: string) {
    const root = await this.workspaceRoot();
    const directory = await this.resolveExisting(cwd, root, true);
    const result = await this.runProcess("git", ["apply", "--whitespace=nowarn", "-"], directory, 30_000, patch);
    if (result.exitCode !== 0) throw new BadRequestException(`Patch could not be applied: ${result.stderr || result.stdout}`);
    return { cwd: this.relativePath(root, directory), output: result.stdout || "Patch applied." };
  }

  async runScript(command: "test" | "build" | "typecheck" | "lint" | "smoke", cwd: string, timeoutMs: number) {
    const root = await this.workspaceRoot();
    const directory = await this.resolveExisting(cwd, root, true);
    const packageFile = resolve(directory, "package.json");
    const packageJson = JSON.parse(await readFile(packageFile, "utf8")) as { scripts?: Record<string, string> };
    if (!packageJson.scripts?.[command]) throw new BadRequestException(`The project does not declare an allowed ${command} script.`);
    const result = await this.runProcess("pnpm", ["run", command], directory, timeoutMs);
    return { cwd: this.relativePath(root, directory), command, ...result };
  }

  async gitStatus(cwd: string, includeDiff: boolean, maxBytes: number) {
    const root = await this.workspaceRoot();
    const directory = await this.resolveExisting(cwd, root, true);
    const status = await this.runProcess("git", ["status", "--short"], directory, 20_000);
    const diff = includeDiff ? await this.runProcess("git", ["diff", "--no-ext-diff", "--", "."], directory, 20_000) : undefined;
    return { cwd: this.relativePath(root, directory), status: status.stdout, diff: diff ? trimOutput(diff.stdout, maxBytes) : undefined, truncated: Boolean(diff && diff.stdout.length > maxBytes) };
  }

  private async workspaceRoot() { return realpath(this.root).catch(() => { throw new BadRequestException("Configured workspace root is unavailable."); }); }

  private async resolveExisting(value: string, root: string, directory: boolean) {
    const target = this.resolveInside(root, value);
    const resolved = await realpath(target).catch(() => { throw new BadRequestException("Workspace path does not exist or cannot be resolved."); });
    this.assertInside(root, resolved);
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink() || (directory && !stat.isDirectory())) throw new BadRequestException(directory ? "Workspace path must be a directory." : "Workspace symbolic links are not allowed.");
    return resolved;
  }

  private async resolveWritable(value: string, root: string) {
    const target = this.resolveInside(root, value);
    const parent = await realpath(dirname(target)).catch(() => { throw new BadRequestException("Workspace write parent directory does not exist."); });
    this.assertInside(root, parent);
    return target;
  }

  private resolveInside(root: string, value: string) {
    if (!value || value.includes("\0")) throw new BadRequestException("Workspace path is invalid.");
    const target = resolve(root, value);
    this.assertInside(root, target);
    return target;
  }

  private assertInside(root: string, target: string) {
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new BadRequestException("Workspace path escapes the configured root.");
  }

  private relativePath(root: string, target: string) { return relative(root, target) || "."; }

  private async walk(directory: string, root: string, depth: number, limit: number, entries: Array<{ path: string; type: "file" | "directory"; size?: number }>) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entries.length >= limit || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const target = resolve(directory, entry.name);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) continue;
      entries.push({ path: this.relativePath(root, target), type: stat.isDirectory() ? "directory" : "file", size: stat.isFile() ? stat.size : undefined });
      if (stat.isDirectory() && depth > 0) await this.walk(target, root, depth - 1, limit, entries);
    }
  }

  private async collectFiles(target: string, root: string, files: string[], limit: number) {
    const stat = await lstat(target);
    if (stat.isFile()) { files.push(target); return; }
    for (const entry of await readdir(target, { withFileTypes: true })) {
      if (files.length >= limit || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const child = resolve(target, entry.name);
      const childStat = await lstat(child);
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) await this.collectFiles(child, root, files, limit);
      else if (childStat.isFile()) files.push(child);
    }
  }

  private async runProcess(command: string, args: string[], cwd: string, timeoutMs: number, stdin?: string) {
    return new Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>((resolveResult, reject) => {
      const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = ""; let stderr = ""; let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { stdout = trimOutput(stdout + chunk.toString(), 1_000_000); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = trimOutput(stderr + chunk.toString(), 1_000_000); });
      child.on("error", reject);
      child.on("close", (code) => { clearTimeout(timer); resolveResult({ exitCode: timedOut ? 124 : code ?? 1, stdout, stderr, timedOut }); });
      child.stdin.end(stdin);
    });
  }
}

function trimOutput(value: string, maxBytes: number) { return Buffer.byteLength(value) <= maxBytes ? value : `${Buffer.from(value).subarray(0, maxBytes).toString()}\n[output truncated]`; }
