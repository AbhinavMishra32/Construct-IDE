export type Event<T> = (listener: (event: T) => void) => { dispose(): void };

export const enum StorageScope {
  APPLICATION = -1,
  PROFILE = 0,
  WORKSPACE = 1
}

export interface IStorageTargetChangeEvent {
  readonly key: string;
  readonly scope: StorageScope;
}

export interface IStorageService {
  readonly _serviceBrand: undefined;


  // Emitted whenever target of a storage entry changes.
  readonly onDidChangeTarget: Event<IStorageTargetChangeEvent>;

  get(key: string, scope: StorageScope, fallbackValue: string): string;
  get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;


}
