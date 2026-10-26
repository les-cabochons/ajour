// Runs only if the whole graph loaded: a call Ajour's main process would see.
void ajour.publicFetch("https://example.com/first-ran").catch(() => undefined);

export const first: boolean = true;
