export interface BrowserStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export class BrowserStorageAdapter {
    constructor(private readonly storage: BrowserStorageLike) {}

    readText(key: string) {
        try {
            return this.storage.getItem(key);
        }
        catch {
            return null;
        }
    }

    readJson(key: string): unknown {
        const value = this.readText(key);
        if (value === null)
            return null;
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }

    write(entries: Array<[key: string, value: string]>) {
        let previous: Array<[key: string, value: string | null]>;
        try {
            previous = entries.map(([key]) => [key, this.storage.getItem(key)]);
        }
        catch {
            return false;
        }
        try {
            entries.forEach(([key, value]) => this.storage.setItem(key, value));
            return true;
        }
        catch {
            previous.forEach(([key, value]) => {
                try {
                    if (value === null)
                        this.storage.removeItem(key);
                    else
                        this.storage.setItem(key, value);
                }
                catch {
                    // The caller still receives failure; rollback is best effort when storage itself is unavailable.
                }
            });
            return false;
        }
    }
}
