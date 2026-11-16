// Disposable Electron smoke test. Start with the scratch Electron executable.
const { app, BrowserWindow, protocol, net } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const [scratch, reference, fixtures, output] = process.argv.slice(2);
app.setPath("userData", path.join(scratch, "electron-user-data"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "lancet",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
app
  .whenReady()
  .then(async () => {
    const all = JSON.parse(fs.readFileSync(fixtures, "utf8"));
    const cases = [
      all[0],
      all[135],
      all[170],
      ...all.filter((x) => x.group === "parity-edge"),
    ];
    let source = fs.readFileSync(reference, "utf8");
    source = source.slice(source.indexOf("ort.env.wasm.numThreads = 1;"));
    source = source.slice(0, source.indexOf("const rows ="));
    source = source.replace(
      /const dir = path.join\(scratch, ["']bundle\/model["']\);/,
      'const dir = "model";',
    );
    source = source.replace(/process.memoryUsage\(\)/g, "{}");
    source += `
const results=[];
for(const row of ${JSON.stringify(cases)}){
 const t=performance.now();
 results.push({...row,...await score(row.command,row.shell),ms:performance.now()-t});
}
await session.release();
await fetch('lancet://local/result',{method:'POST',body:JSON.stringify({
 loadMs,results,sandboxEvidence:{nodeProcessType:typeof process,nodeRequireType:typeof require,crossOriginIsolated:globalThis.crossOriginIsolated}
})});`;
    const prelude = `
const assets={};
const Buffer={from:value=>new TextEncoder().encode(value),byteLength:value=>new TextEncoder().encode(value).length};
for(const name of ['model.json','vocab.json','head.json','head.bin','merges.txt','encoder-int8.onnx']){
 const response=await fetch('lancet://local/model/'+name);
 assets['model/'+name]=name.endsWith('.bin')||name.endsWith('.onnx')?new Uint8Array(await response.arrayBuffer()):await response.text();
}
const binary=assets['model/head.bin'];
binary.readFloatLE=offset=>new DataView(binary.buffer).getFloat32(offset,true);
const fs={readFileSync:name=>assets[name]},path={join:(...x)=>x.join('/')},outputPath='result';
`;
    const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'"><script src="/ort/ort.wasm.min.js"></script><script type="module" src="/run.mjs"></script>`;
    protocol.handle("lancet", async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/result") {
        const result = await request.json();
        fs.writeFileSync(output, JSON.stringify(result, null, 2));
        setTimeout(() => app.quit(), 50);
        return new Response("ok");
      }
      if (url.pathname === "/")
        return new Response(html, { headers: { "content-type": "text/html" } });
      if (url.pathname === "/run.mjs")
        return new Response(prelude + source, {
          headers: { "content-type": "text/javascript" },
        });
      const name = path.basename(url.pathname);
      const base = url.pathname.startsWith("/model/")
        ? path.join(scratch, "bundle/model")
        : path.join(scratch, "node_modules/onnxruntime-web/dist");
      return net.fetch(pathToFileURL(path.join(base, name)).href);
    });
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    win.webContents.on("console-message", (_event, ...args) =>
      fs.appendFileSync(output + ".log", JSON.stringify(args) + "\n"),
    );
    await win.loadURL("lancet://local/");
    setTimeout(() => {
      fs.appendFileSync(output + ".log", "timeout\n");
      app.exit(1);
    }, 120000).unref();
  })
  .catch((error) => {
    fs.writeFileSync(output + ".log", String(error));
    app.exit(1);
  });
