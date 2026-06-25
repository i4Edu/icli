export function lazy<T>(loader: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  let value: T | undefined;
  let loaded = false;

  return async () => {
    if (loaded) return value as T;
    promise ??= loader().then((result) => {
      value = result;
      loaded = true;
      return result;
    });
    return promise;
  };
}

export function lazySync<T>(loader: () => T): () => T {
  let loaded = false;
  let value: T | undefined;

  return () => {
    if (!loaded) {
      value = loader();
      loaded = true;
    }
    return value as T;
  };
}
