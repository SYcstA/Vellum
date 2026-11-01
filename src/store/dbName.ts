/**
 * Dev builds (`npm run tauri dev`) share the installed app's identifier, hence
 * its AppData folder. A separate file name keeps dev experiments (factory
 * reset, import) away from real data.
 */
export function dbUrl(isDev: boolean): string {
  return isDev ? "sqlite:productivity-dev.db" : "sqlite:productivity.db";
}
