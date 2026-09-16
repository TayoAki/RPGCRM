import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Loads the sample feed files under agent/samples and resolves their date
 * tokens relative to `now`, so the demo data is always "current":
 *   {{DATE}}, {{DATE+2}}, {{DATE-1}}        → yyyy-mm-dd
 *   {{DATETIME}}, {{DATETIME-5h}}, {{DATETIME+36h}} → ISO timestamp
 * Other tokens (e.g. {{RACK}}) are left for the calling service to resolve.
 */

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "samples");

export function samplePath(name: string): string {
  return join(SAMPLES_DIR, name);
}

export function resolveTokens(text: string, now: Date): string {
  return text
    .replace(/\{\{DATE([+-]\d+)?\}\}/g, (_m, off) => {
      const d = new Date(now.getTime() + (off ? Number(off) : 0) * 86_400_000);
      return d.toISOString().slice(0, 10);
    })
    .replace(/\{\{DATETIME([+-]\d+)h\}\}/g, (_m, off) => {
      const d = new Date(now.getTime() + Number(off) * 3_600_000);
      return d.toISOString();
    })
    .replace(/\{\{DATETIME\}\}/g, () => now.toISOString());
}

export function loadSample<T>(name: string, now: Date = new Date()): T {
  const raw = readFileSync(samplePath(name), "utf8");
  return JSON.parse(resolveTokens(raw, now)) as T;
}
