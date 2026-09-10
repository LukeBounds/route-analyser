import { BrowserStorageAdapter, type BrowserStorageLike } from '../src/browserStorage.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

class MemoryStorage implements BrowserStorageLike {
    readonly values = new Map<string, string>();
    failOnKey: string | null = null;

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string) {
        if (key === this.failOnKey)
            throw new Error('storage unavailable');
        this.values.set(key, value);
    }

    removeItem(key: string) {
        this.values.delete(key);
    }
}

const memory = new MemoryStorage();
const adapter = new BrowserStorageAdapter(memory);
equal(adapter.write([['library', '{"old":true}'], ['selected', 'old']]), true, 'storage writes related values');
memory.failOnKey = 'selected';
equal(adapter.write([['library', '{"new":true}'], ['selected', 'new']]), false, 'storage reports a partial write failure');
equal(memory.getItem('library'), '{"old":true}', 'a partial write restores the previous library');
equal(memory.getItem('selected'), 'old', 'a partial write retains the previous selection');
equal(adapter.readJson('library') && (adapter.readJson('library') as { old?: boolean }).old, true, 'stored JSON is parsed safely');

console.log('Browser-storage regression tests passed.');
