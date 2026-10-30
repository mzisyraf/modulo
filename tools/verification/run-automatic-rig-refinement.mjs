// Requires local Vite5173 and isolated muted Chrome debugging9223. No backend calls.
import { writeFile } from "node:fs/promises";
const pages = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = pages.find(p => p.type === "page");
if (!page) throw Error("Start isolated Chrome on9223 first.");
const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(); let serial = 0;
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (!message.id) return; const call = pending.get(message.id); pending.delete(message.id); message.error ? call?.reject(message.error) : call?.resolve(message.result); };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
try {
  const root = new URL("../../", import.meta.url).pathname;
  await send("Page.navigate", { url: `http://127.0.0.1:5173/@fs${root}tools/verification/automatic-rig-refinement.html` });
  await new Promise(resolve => setTimeout(resolve, 750));
  const result = await send("Runtime.evaluate", { expression: `(async()=>{const {verifyAutomaticRefinement}=await import(${JSON.stringify(`/@fs${root}tools/verification/automatic-rig-refinement.browser.ts`)});return verifyAutomaticRefinement()})()`, awaitPromise: true, returnByValue: true, timeout: 300000 });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  await send("Page.navigate", {url:"http://127.0.0.1:5173/"});
  await new Promise(resolve=>setTimeout(resolve,750));
  const main=await send("Runtime.evaluate",{expression:`(async()=>{const {verifyMainAutomaticRefinement}=await import(${JSON.stringify(`/@fs${root}tools/verification/automatic-rig-refinement.browser.ts`)});return verifyMainAutomaticRefinement()})()`,awaitPromise:true,returnByValue:true,timeout:300000});
  if(main.exceptionDetails)throw Error(JSON.stringify(main.exceptionDetails));
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,250));
  const layout=await send("Runtime.evaluate",{expression:"({width:innerWidth,scroll:document.documentElement.scrollWidth})",returnByValue:true});
  if(layout.result.value.scroll>layout.result.value.width)throw Error("Main workflow overflows at390px");
  const screenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  await writeFile("/private/tmp/modulo-automatic-refinement-main.png",Buffer.from(screenshot.data,"base64"));
  await send("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  const report={component:result.result.value,main:main.result.value,narrowLayout:layout.result.value};
  await writeFile("/private/tmp/modulo-automatic-refinement-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { socket.close(); }
