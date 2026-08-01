import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const apiPort = Number(process.env.PORT ?? 4317);
const apiBaseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${apiPort}/api`;
const apiToken = crypto.randomUUID();
const rendererUrl = process.env.RENDERER_URL;
let apiProcess: ChildProcess | undefined;

function nodeEntryPoint(): string {
  return process.env.NODE_BINARY || process.env.npm_node_execpath || "node";
}

function apiEntryPoint(): string | undefined {
  const candidates = [
    resolve(repoRoot, "apps/api/dist/main.js"),
    resolve(repoRoot, "apps/api/dist/apps/api/src/main.js")
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function sleep(ms: number) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function isApiReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`, { headers: { authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function isRendererReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureApiProcess(): Promise<void> {
  if (await isApiReachable()) return;

  const apiMain = apiEntryPoint();
  if (!apiMain) {
    throw new Error("API build output was not found. Run `pnpm --filter @sp-agent/api build` before launching desktop.");
  }

  apiProcess = spawn(nodeEntryPoint(), [apiMain], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(apiPort),
      SP_AGENT_API_TOKEN: apiToken,
      SP_AGENT_REQUIRE_AUTH: "1",
      SP_AGENT_RENDERER_ORIGIN: rendererUrl
    },
    stdio: "inherit"
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isApiReachable()) return;
    if (apiProcess.exitCode !== null) {
      throw new Error(`API process exited before becoming ready with code ${apiProcess.exitCode}.`);
    }
    await sleep(500);
  }

  throw new Error(`API did not become reachable at ${apiBaseUrl}/health.`);
}

async function createWindow() {
  await ensureApiProcess();

  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "SP Agent",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Electron's sandboxed preload runner loads CommonJS. Keep this as a
      // .cjs output even though the desktop main process is ESM.
      preload: resolve(__dirname, "preload.cjs")
    }
  });

  win.webContents.on("before-input-event", (event, input) => {
    const isDevToolsShortcut =
      input.key === "F12" ||
      (input.key.toLowerCase() === "i" && input.alt && (input.meta || input.control));

    if (!isDevToolsShortcut) return;
    event.preventDefault();
    win.webContents.toggleDevTools();
  });

  if (rendererUrl && (await isRendererReachable(rendererUrl))) {
    await win.loadURL(rendererUrl);
    return;
  }

  await win.loadFile(resolve(repoRoot, "apps/web/dist/index.html"));
}

function shutdownApiProcess() {
  if (!apiProcess || apiProcess.killed) return;
  apiProcess.kill("SIGTERM");
  apiProcess = undefined;
}

app.whenReady().then(() => {
  ipcMain.handle("skills:choose-directory", async () => {
    const result = await dialog.showOpenDialog({ title: "Choose a Skill folder", properties: ["openDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("api:get-token", () => apiToken);
  void createWindow();
});

app.on("before-quit", shutdownApiProcess);

app.on("window-all-closed", () => {
  shutdownApiProcess();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
