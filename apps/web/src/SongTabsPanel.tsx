import {useEffect,useRef,useState} from "react";
import {apiJson} from "./separation";
import {parseSongTabs,tabsBusy,notesInWindow,type SongTabs} from "./songTabs";
import "./songTabs.css";
interface Props {jobId:string;duration:number;active:boolean;getPlayer:()=>HTMLAudioElement|undefined;onPlay:()=>Promise<void>;onSeek:(time:number)=>void}
const stamp=(s:number)=>`${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,"0")}`;
export function SongTabsPanel({jobId,duration,active,getPlayer,onPlay,onSeek}:Props){
 const [state,setState]=useState<SongTabs>({status:"idle"}),[error,setError]=useState(""),[refresh,setRefresh]=useState(0),[pending,setPending]=useState(false);
 const [tuning,setTuning]=useState("standard"),[capo,setCapo]=useState(0),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[start,setStart]=useState(0),[size,setSize]=useState(10),[follow,setFollow]=useState(true),[loop,setLoop]=useState(false),[loopStart,setLoopStart]=useState(0),[loopEnd,setLoopEnd]=useState(Math.min(10,duration)),[speed,setSpeed]=useState(1);
 const action=useRef<AbortController|null>(null),url=`/api/jobs/${jobId}/tabs`,query=new URLSearchParams({tuning,capo:String(capo)}).toString();
 useEffect(()=>{
  if(!active)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function poll(){try{
   const response=await fetch(`${url}?${query}`,{signal:controller.signal});if(!response.ok)throw Error("Tabs could not load. Check the API and reconnect.");
   const next=parseSongTabs(await response.json(),duration);if(controller.signal.aborted)return;setState(next);setError("");
   if(tabsBusy(next.status)||next.cancellation_pending)timer=setTimeout(()=>void poll(),1500);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Tabs could not load.");}}
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[active,url,query,duration,refresh]);
 useEffect(()=>{if(!active){action.current?.abort();setPending(false);}return()=>action.current?.abort();},[jobId,active]);
 useEffect(()=>{if(!active)return;return()=>{const p=getPlayer();if(p){p.playbackRate=1;p.pause();}};},[active,getPlayer]);
 useEffect(()=>{
  if(!active)return;let frame=0;
  const tick=()=>{const p=getPlayer();if(p){if(loop&&!p.paused&&p.currentTime>=loopEnd&&loopEnd>loopStart)p.currentTime=loopStart;setTime(p.currentTime);setPlaying(!p.paused);if(follow&&!p.paused)setStart(Math.floor(p.currentTime/size)*size);}frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[active,getPlayer,loop,loopStart,loopEnd,follow,size]);
 async function request(cancel=false){
  action.current?.abort();const controller=new AbortController();action.current=controller;setPending(true);setError("");
  try{await apiJson(url,{method:cancel?"DELETE":"POST",headers:{"Content-Type":"application/json"},body:cancel?undefined:JSON.stringify({retry:state.status==="failed"||state.status==="cancelled"}),signal:controller.signal});if(!controller.signal.aborted)setRefresh(x=>x+1);}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Tab request failed.");}
  finally{if(!controller.signal.aborted)setPending(false);}
 }
 function seek(v:number){const next=Math.max(0,Math.min(duration,v));onSeek(next);setTime(next);setStart(Math.floor(next/size)*size);}
 const result=state.result,notes=result?notesInWindow(result.notes,start,size):[],unassigned=result?.notes.filter(n=>n.string===null).length??0,busy=tabsBusy(state.status)||state.cancellation_pending;
 return <section className="result-panel song-tabs" aria-labelledby="song-tabs-title">
  <div className="result-heading"><div><span className="step">PLAY THE SONG</span><h2 id="song-tabs-title">Full-song guitar tabs</h2></div><span className="quality-badge warning">Draft transcription</span></div>
  <p>Transcribe the entire {stamp(duration)} extracted guitar track on a Modal GPU. Changing the tone-match passage does not change these tabs. Multiple guitars, distortion and bends may need correction by ear.</p>
  <div className="button-row">{!result&&!busy&&<button disabled={!active||pending} onClick={()=>void request()}>{state.status==="failed"||state.status==="cancelled"?"Retry full-song tabs":"Generate full-song tabs"}</button>}{busy&&<button className="stop" disabled={pending} onClick={()=>void request(true)}>Cancel tab generation</button>}<button className="secondary" disabled={pending} onClick={()=>setRefresh(x=>x+1)}>Reconnect tabs</button></div>
  <p role="status">{busy?`Full song: ${state.status}. GPU startup can take longer on the first request.`:result?`${result.notes.length} detected notes · ${unassigned} unassigned · ${result.provenance.elapsed_seconds.toFixed(1)}s worker processing · verified CUDA inference.`:state.status==="idle"?"Not generated. Generate sends the full guitar stem to the private cloud worker and can incur usage charges.":state.error??state.status}</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {result&&<>
   <div className="tabs-controls"><label>Tuning<select aria-label="Tab tuning" value={tuning} onChange={e=>setTuning(e.target.value)}><option value="standard">Standard E A D G B e</option><option value="drop_d">Drop D D A D G B e</option></select></label><label>Capo<input aria-label="Tab capo" type="number" min={0} max={12} value={capo} onChange={e=>{const v=Number(e.target.value);if(Number.isInteger(v)&&v>=0&&v<=12)setCapo(v);}} /></label><label>Speed<select aria-label="Tab playback speed" value={speed} onChange={e=>{const v=Number(e.target.value);setSpeed(v);const p=getPlayer();if(p){p.preservesPitch=true;p.playbackRate=v;}}}><option value={.5}>0.5×</option><option value={.75}>0.75×</option><option value={1}>1×</option></select></label><label>Window<select aria-label="Tab window" value={size} onChange={e=>setSize(Number(e.target.value))}><option value={5}>5 seconds</option><option value={10}>10 seconds</option><option value={20}>20 seconds</option></select></label></div>
   <div className="button-row"><button onClick={()=>{const p=getPlayer();if(playing)p?.pause();else{if(p){p.preservesPitch=true;p.playbackRate=speed;}void onPlay().catch(e=>setError(e instanceof Error?e.message:"Backing playback failed."));}}}>{playing?"Pause tab playback":"Play backing with tabs"}</button><button className="secondary" onClick={()=>seek(start-size)} disabled={start<=0}>Previous tab window</button><button className="secondary" onClick={()=>seek(start+size)} disabled={start+size>=duration}>Next tab window</button><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/> Follow playback</label></div>
   <label>Song position {stamp(time)} / {stamp(duration)}<input aria-label="Tab song position" type="range" min={0} max={duration} step={.05} value={Math.min(time,duration)} onChange={e=>seek(Number(e.target.value))}/></label>
   <div className="tabs-staff" role="group" aria-label={`Guitar tablature ${stamp(start)} to ${stamp(Math.min(start+size,duration))}`}>
    <p className="tabs-window-time">{stamp(start)}–{stamp(Math.min(start+size,duration))} · fret numbers relative to capo</p>
    {[1,2,3,4,5,6].map(string=><div className="tab-string" key={string}><span className="tab-string-name">{(result.tuning==="drop_d"?["e","B","G","D","A","D"]:["e","B","G","D","A","E"])[string-1]}</span><div className="tab-string-line">{notes.filter(n=>n.string===string).map((n,i)=><button key={`${n.start_seconds}:${n.midi_pitch}:${i}`} className={time>=n.start_seconds&&time<n.end_seconds?"tab-note is-current":"tab-note"} style={{left:`${Math.max(0,(n.start_seconds-start)/size*100)}%`}} title={`${n.start_seconds.toFixed(2)}s · MIDI${n.midi_pitch}${n.pitch_bend?" · bend detected":""}`} aria-label={`String ${string} fret ${n.fret} at ${n.start_seconds.toFixed(2)} seconds`} onClick={()=>seek(n.start_seconds)}>{n.fret}{n.pitch_bend?"~":""}</button>)}</div></div>)}
   </div>
   {!result.notes.length&&<p>No confident notes were detected. This may be silence or an unsupported guitar sound.</p>}
   {unassigned>0&&<details><summary>{unassigned} unassigned notes — retained in exports</summary><p>{result.notes.filter(n=>n.string===null).slice(0,30).map(n=>`${n.start_seconds.toFixed(2)}s: MIDI${n.midi_pitch}`).join(" · ")}{unassigned>30?" · See JSON for the full list.":""}</p></details>}
   <div className="tabs-controls"><label><input type="checkbox" checked={loop} disabled={loopEnd<=loopStart} onChange={e=>setLoop(e.target.checked)}/> Loop practice section</label><label>Loop start<input aria-label="Tab loop start" type="number" min={0} max={Math.max(0,loopEnd-.1)} step={.1} value={loopStart} onChange={e=>{const v=Number(e.target.value);if(Number.isFinite(v)&&v>=0&&v<loopEnd)setLoopStart(v);}}/></label><label>Loop end<input aria-label="Tab loop end" type="number" min={loopStart+.1} max={duration} step={.1} value={loopEnd} onChange={e=>{const v=Number(e.target.value);if(Number.isFinite(v)&&v>loopStart&&v<=duration)setLoopEnd(v);}}/></label></div>
   <div className="button-row">{["txt","mid","json"].map(format=><a key={format} className="secondary" href={`${url}/files/${format}?${query}`} download={`modulo-tabs.${format}`}>Download {format==="txt"?"text tabs":format==="mid"?"MIDI":"JSON"}</a>)}</div><p className="job-detail">Suggested fingering, not the original player's hand positions. Tuning/capo reuses detected notes without another GPU request. Changing tuning does not retune the audio. Tab timing follows backing playback; loop timing is not sample-accurate.</p>
  </>}
 </section>;
}
