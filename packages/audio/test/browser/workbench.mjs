import { writeFile } from "node:fs/promises";
const pages = await (await fetch("http://127.0.0.1:9223/json/list")).json(), page = pages.find(item => item.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(); let sequence = 0;
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(message.error); else item?.resolve(message.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
try {
  await send("Page.navigate", { url: process.env.MODULO_RIG_URL || "http://127.0.0.1:5175/" }); await new Promise(resolve => setTimeout(resolve, 1000));
  const result = await send("Runtime.evaluate", { expression: `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms)), el=id=>document.getElementById(id), check=(value,message)=>{if(!value)throw Error(message)};
    check(document.title.includes("Rig workbench"),"workbench missing");
    el("load").click(); await wait(500); check(!document.querySelector('#chain select').disabled,"controls disabled after load");
    el("factory").value="3"; el("load").click(); await wait(500); check(el("chain").children.length===19,"expanded modules missing");
    const gain=document.querySelector('[aria-label="amp gain"]');gain.value="0.6";gain.dispatchEvent(new Event("input")); await wait(100);check(JSON.parse(el("json").value).chain.find(m=>m.id==="amp").parameters.gain===0.6,"slider did not update engine JSON");
    el("factory").value="4";el("load").click();await wait(500);check(JSON.parse(el("json").value).parallel.paths.length===2,"dual rig missing");
    el("start").click();await wait(500);check(el("status").textContent.includes("Live input active"),el("status").textContent);
    el("record").click();await wait(700);el("finish").click();await wait(500);check(el("takes").querySelectorAll("audio").length===2,el("status").textContent);
    el("stop").click();check(el("status").textContent==="Stopped.","stop not reflected");
    return {passed:7, viewport:{width:innerWidth,height:innerHeight},title:document.title,status:el("status").textContent};
  })()`, awaitPromise: true, returnByValue: true, timeout: 30000 });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await send("Runtime.evaluate", { expression: "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})", returnByValue: true });
  if (mobile.result.value.scrollWidth > mobile.result.value.width) throw new Error(`Mobile layout overflows: ${JSON.stringify(mobile.result.value)}`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile("/private/tmp/modulo-rig-workbench.png", Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ ...result.result.value, mobile: mobile.result.value }));
} finally { socket.close(); }
