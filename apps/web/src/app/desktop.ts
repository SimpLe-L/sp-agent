declare global {
  interface Window {
    spAgentDesktop?: { chooseSkillFolder(): Promise<string | undefined>; getApiToken(): Promise<string> };
  }
}

export async function chooseSkillFolder() {
  return window.spAgentDesktop?.chooseSkillFolder();
}

export async function getDesktopApiToken() {
  return window.spAgentDesktop?.getApiToken();
}
