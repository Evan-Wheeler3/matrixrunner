/** Persistent progress stored in localStorage. Expanded in milestone 4. */

const STORAGE_KEY = 'rainline.save.v1';

export interface SaveData {
  version: 1;
  xp: number;
  /** Highest mission id completed (0 = none). */
  missionsCompleted: number;
  totalRuns: number;
  settings: { quality: 'high' | 'low'; volume: number };
}

function defaults(): SaveData {
  return { version: 1, xp: 0, missionsCompleted: 0, totalRuns: 0, settings: { quality: 'high', volume: 0.8 } };
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
      return { ...defaults(), ...parsed, settings: { ...defaults().settings, ...parsed.settings } } as SaveData;
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
