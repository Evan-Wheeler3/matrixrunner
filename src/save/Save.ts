/** Persistent progress stored in localStorage. Expanded in milestone 4. */

import { CONFIG } from '../config';
import type { Volumes } from '../audio/AudioEngine';

const STORAGE_KEY = 'rainline.save.v1';

export interface SaveData {
  version: 1;
  xp: number;
  /** Highest mission id completed (0 = none). */
  missionsCompleted: number;
  totalRuns: number;
  settings: { quality: 'high' | 'low'; volumes: Volumes };
}

function defaults(): SaveData {
  return { version: 1, xp: 0, missionsCompleted: 0, totalRuns: 0, settings: { quality: 'high', volumes: { ...CONFIG.audio.defaultVolumes } } };
}

export class Save {
  data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      // Merge over defaults so older saves pick up newly added fields.
      const d = defaults();
      return {
        ...d,
        ...parsed,
        settings: { ...d.settings, ...parsed.settings, volumes: { ...d.settings.volumes, ...parsed.settings?.volumes } },
      } as SaveData;
    } catch {
      return defaults();
    }
  }

  write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage unavailable (private mode etc.) – progress just won't persist.
    }
  }

  reset(): void {
    this.data = defaults();
    this.write();
  }
}
