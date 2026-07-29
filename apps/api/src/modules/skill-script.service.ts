import { BadRequestException, Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname } from "node:path";
import type { SkillScriptExecuteInput } from "@sp-agent/shared";
import { LocalSkillsService } from "./local-skills.service.js";

@Injectable()
export class SkillScriptService {
  constructor(private readonly skills: LocalSkillsService) {}

  async execute(input: SkillScriptExecuteInput) {
    const sandbox = process.platform === "darwin" ? "/usr/bin/sandbox-exec" : undefined;
    if (!sandbox || !(await exists(sandbox))) {
      return { status: "degraded" as const, degradedReason: "No supported OS sandbox is available; Skill scripts are intentionally not executed.", exitCode: null, stdout: "", stderr: "" };
    }
    const { skill, root, path } = await this.skills.resolveSandboxScript(input.skillId, input.version, input.scriptPath);
    const profile = macSandboxProfile(root, dirname(process.execPath));
    const result = await run(sandbox, ["-p", profile, process.execPath, path, ...input.args], root, input.timeoutMs, input.maxOutputBytes);
    return { status: result.exitCode === 0 ? "completed" as const : "degraded" as const, skillId: skill.id, version: skill.version, scriptPath: input.scriptPath, ...result, degradedReason: result.timedOut ? "Skill script exceeded its execution timeout." : result.exitCode === 0 ? undefined : "Skill script failed inside the sandbox." };
  }
}

async function exists(path: string) { try { await access(path); return true; } catch { return false; } }

function macSandboxProfile(root: string, nodeRoot: string) {
  const escaped = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `(version 1)
(deny default)
(allow process*)
(allow file-read* (subpath "${escaped(root)}") (subpath "${escaped(nodeRoot)}") (subpath "/opt/homebrew") (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/private/var/db/timezone"))
(allow file-write* (subpath "/private/tmp") (subpath "/dev"))`;
}

function run(command: string, args: string[], cwd: string, timeoutMs: number, maxOutputBytes: number) {
  return new Promise<{ exitCode: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; outputTruncated: boolean }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent", TMPDIR: "/private/tmp" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let outputTruncated = false; let timedOut = false;
    const capture = (current: string, chunk: Buffer) => {
      if (Buffer.byteLength(current) >= maxOutputBytes) { outputTruncated = true; return current; }
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) <= maxOutputBytes) return next;
      outputTruncated = true;
      return Buffer.from(next).subarray(0, maxOutputBytes).toString();
    };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout = capture(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = capture(stderr, chunk); });
    child.on("error", reject);
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ exitCode: code, signal, stdout, stderr, timedOut, outputTruncated }); });
  });
}
