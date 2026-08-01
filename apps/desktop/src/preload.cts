import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("spAgentDesktop", {
  chooseSkillFolder: () => ipcRenderer.invoke("skills:choose-directory") as Promise<string | undefined>,
  getApiToken: () => ipcRenderer.invoke("api:get-token") as Promise<string>
});
