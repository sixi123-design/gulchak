/** vitest 환경이 node라 localStorage가 없다 (vite.config.ts: test.environment = 'node'). Map으로 흉내낸다. */
export function installFakeStorage() {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = store;
}
