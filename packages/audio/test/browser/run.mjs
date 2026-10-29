// Run with Vite on 5173 and an isolated Chrome --remote-debugging-port=9223 --mute-audio.
import { writeFile } from "node:fs/promises";
const pages = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("Start isolated Chrome first.");
const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(); let sequence = 0;
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(message.error); else item?.resolve(message.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
try {
  await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const root = new URL("../../", import.meta.url).pathname;
  const result = await send("Runtime.evaluate", { expression: `(async()=>{ const {verifyRig}=await import(${JSON.stringify(`/@fs${root}test/browser/verify.ts`)}); return verifyRig(); })()`, awaitPromise: true, returnByValue: true, timeout: 180000 });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const report = result.result.value; await writeFile("/private/tmp/modulo-rig-browser-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ browser: report.browser, fixture: report.fixture, passed: report.passed, failed: report.failed, errors: report.checks.filter(item => !item.passed), report: "/private/tmp/modulo-rig-browser-report.json" }, null, 2)); if (report.failed) process.exitCode = 1;
} finally { socket.close(); }
