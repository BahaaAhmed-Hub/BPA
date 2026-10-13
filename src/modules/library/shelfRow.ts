/** `addBooks` takes what is set and leaves the rest to its defaults: a key holding `undefined` is dropped, so none is sent that has nothing in it. */
export function applyBlank<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
