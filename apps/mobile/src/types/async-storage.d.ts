declare module '@react-native-async-storage/async-storage' {
  export interface AsyncStorageStatic {
    getItem(key: string, callback?: (error?: Error, result?: string) => void): Promise<string | null>;
    setItem(key: string, value: string, callback?: (error?: Error) => void): Promise<void>;
    removeItem(key: string, callback?: (error?: Error) => void): Promise<void>;
    mergeItem(key: string, value: string, callback?: (error?: Error) => void): Promise<void>;
    clear(callback?: (error?: Error) => void): Promise<void>;
    getAllKeys(callback?: (error?: Error, keys?: string[]) => void): Promise<readonly string[]>;
    flushGetRequests(): void;
    multiGet(keys: readonly string[], callback?: (errors?: readonly (Error | undefined)[], result?: readonly [string, string | null][]) => void): Promise<readonly [string, string | null][]>;
    multiSet(keyValuePairs: readonly [string, string][], callback?: (errors?: readonly (Error | undefined)[]) => void): Promise<void>;
    multiRemove(keys: readonly string[], callback?: (errors?: readonly (Error | undefined)[]) => void): Promise<void>;
    multiMerge(keyValuePairs: readonly [string, string][], callback?: (errors?: readonly (Error | undefined)[]) => void): Promise<void>;
  }

  const AsyncStorage: AsyncStorageStatic;
  export default AsyncStorage;
}
