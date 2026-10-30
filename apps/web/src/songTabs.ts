export interface TabNote {start_seconds:number;end_seconds:number;midi_pitch:number;model_strength:number;pitch_bend:boolean;string:number|null;fret:number|null;assignment_status:"suggested"|"unassigned"}
export interface TabResult {version:1;duration_seconds:number;source_sha256:string;tuning:"standard"|"drop_d";capo:number;notes:TabNote[];quality_flags:string[];provenance:{provider:"modal";model:string;model_sha256:string;runtime:"onnxruntime-cuda";cuda_kernels:number;elapsed_seconds:number}}
export interface SongTabs {status:"idle"|"queued"|"uploading"|"transcribing"|"arranging"|"ready"|"failed"|"cancelled";request_id?:string;error?:string;result?:TabResult;cancellation_pending?:boolean}
export const tabsBusy=(status:SongTabs["status"])=>["queued","uploading","transcribing","arranging"].includes(status);
const finite=(v:unknown,min:number,max:number)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max;
export function parseSongTabs(value:unknown,duration:number):SongTabs{
 const state=value as SongTabs;
 if(!state||typeof state!=="object"||!["idle","queued","uploading","transcribing","arranging","ready","failed","cancelled"].includes(state.status)||state.cancellation_pending!==undefined&&typeof state.cancellation_pending!=="boolean"||state.error!==undefined&&(typeof state.error!=="string"||state.error.length>1200))throw Error("Invalid tab status.");
 if(state.status!=="ready"){if(state.result!==undefined)throw Error("Unfinished tabs contain a result.");return state;}
 const r=state.result,p=r?.provenance;
 if(!r||r.version!==1||!finite(r.duration_seconds,10,295)||Math.abs(r.duration_seconds-duration)>1/44100||!/^[a-f0-9]{64}$/.test(r.source_sha256)||!["standard","drop_d"].includes(r.tuning)||!Number.isInteger(r.capo)||!finite(r.capo,0,12)||!Array.isArray(r.notes)||r.notes.length>10000||!Array.isArray(r.quality_flags)||r.quality_flags.some(x=>typeof x!=="string")||p?.provider!=="modal"||p.model!=="spotify/basic-pitch:0.4.0"||p.model_sha256!=="2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec"||p.runtime!=="onnxruntime-cuda"||!Number.isInteger(p.cuda_kernels)||!finite(p.cuda_kernels,1,1e7)||!finite(p.elapsed_seconds,0,300))throw Error("Invalid full-song GPU tabs.");
 let previous=-1;const opens=r.tuning==="standard"?[64,59,55,50,45,40]:[64,59,55,50,45,38];
 for(const n of r.notes){
  if(!n||!finite(n.start_seconds,0,duration)||!finite(n.end_seconds,n.start_seconds,duration)||n.end_seconds<=n.start_seconds||n.start_seconds<previous||!Number.isInteger(n.midi_pitch)||!finite(n.midi_pitch,0,127)||!finite(n.model_strength,0,1)||typeof n.pitch_bend!=="boolean")throw Error("Invalid tab note timing/pitch.");
  if(n.assignment_status==="unassigned"){if(n.string!==null||n.fret!==null)throw Error("Invalid unassigned note.");}
  else if(n.assignment_status!=="suggested"||!Number.isInteger(n.string)||!finite(n.string,1,6)||!Number.isInteger(n.fret)||!finite(n.fret,0,24-r.capo)||n.midi_pitch!==opens[n.string!-1]+r.capo+n.fret!)throw Error("Invalid tab fingering.");
  previous=n.start_seconds;
 }return state;
}
export function notesInWindow(notes:TabNote[],start:number,length:number){return notes.filter(n=>n.start_seconds<start+length&&n.end_seconds>start);}
