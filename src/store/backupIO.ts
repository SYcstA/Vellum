/** Tauri-side backup orchestration (dialogs + files + DB). Pure parts live in backup.ts. */
import { open, save } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { backupFileName, backupsToDelete, parseBackup, preImportFileName, serializeBackup, type BackupV1 } from "./backup";
import { dumpTables, replaceAllTables } from "./db";

const FILTERS = [{ name: "Vellum backup", extensions: ["json"] }];
/** Folder under AppData where the automatic pre-import export is kept. */
const SAFETY_DIR = "backups";
/** How many automatic pre-import copies to keep; older ones are deleted. */
const KEEP_SAFETY_COPIES = 5;

/** Ask for a location and write the current data there. Returns the path, or null if cancelled. */
export async function exportBackup(): Promise<string | null> {
  const path = await save({ defaultPath: backupFileName(), filters: FILTERS });
  if (!path) return null;
  await writeTextFile(path, serializeBackup(await dumpTables()));
  return path;
}

/** Ask for a file, read it and fully validate it. Throws a readable Error; the DB is untouched. */
export async function pickBackup(): Promise<{ path: string; backup: BackupV1 } | null> {
  const picked = await open({ multiple: false, directory: false, filters: FILTERS });
  if (typeof picked !== "string") return null;
  return { path: picked, backup: parseBackup(await readTextFile(picked)) };
}

/**
 * Save a safety copy of the current data, then replace everything with `backup`.
 * Returns the safety copy's path. If the safety copy cannot be written nothing
 * is replaced (the error propagates).
 */
export async function applyBackup(backup: BackupV1): Promise<string> {
  await mkdir(SAFETY_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  const name = preImportFileName();
  await writeTextFile(`${SAFETY_DIR}/${name}`, serializeBackup(await dumpTables()), { baseDir: BaseDirectory.AppData });
  await pruneSafetyCopies();
  await replaceAllTables(backup);
  return join(await appDataDir(), SAFETY_DIR, name);
}

/** Best-effort: a failure to tidy up must never block an import. */
async function pruneSafetyCopies(): Promise<void> {
  try {
    const entries = await readDir(SAFETY_DIR, { baseDir: BaseDirectory.AppData });
    for (const name of backupsToDelete(entries.map((e) => e.name), KEEP_SAFETY_COPIES)) {
      await remove(`${SAFETY_DIR}/${name}`, { baseDir: BaseDirectory.AppData });
    }
  } catch (err) {
    console.warn("Could not prune old safety copies:", err);
  }
}
