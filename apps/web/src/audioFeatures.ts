const fftTwiddles = new Map<number, { cosine: Float64Array; sine: Float64Array }>();
export function spectrum(samples: ArrayLike<number>): Float64Array {
  const n = samples.length;
  if (n < 2 || (n & (n-1))) throw Error("FFT size must be a power of two");
  const re = Float64Array.from(samples), im = new Float64Array(n);
  for (let i=1,j=0; i<n; i++) {
    let bit=n>>1; for (;j&bit;bit>>=1) j^=bit; j^=bit;
    if (i<j) [re[i],re[j]]=[re[j],re[i]];
  }
  for (let size=2;size<=n;size*=2) {
    const angle=-2*Math.PI/size;
    let twiddles=fftTwiddles.get(size);
    if(!twiddles){
      twiddles={cosine:Float64Array.from({length:size/2},(_,k)=>Math.cos(angle*k)),sine:Float64Array.from({length:size/2},(_,k)=>Math.sin(angle*k))};
      if(size<=8192)fftTwiddles.set(size,twiddles);
    }
    for (let offset=0;offset<n;offset+=size) for(let k=0;k<size/2;k++) {
      const c=twiddles.cosine[k],s=twiddles.sine[k],i=offset+k,j=i+size/2;
      const r=re[j]*c-im[j]*s, q=re[j]*s+im[j]*c;
      re[j]=re[i]-r;im[j]=im[i]-q;re[i]+=r;im[i]+=q;
    }
  }
  return Float64Array.from({length:n/2+1},(_,i)=>Math.hypot(re[i],im[i])/n);
}

export interface ToneFeatures {
  method: "spectral_bands_v1";
  bands: number[];
  centroid_hz: number;
  flatness: number;
  crest_db: number;
  fine_bands?: number[];
  cepstrum?: number[];
  harmonic_profile?: number[];
  harmonic_confidence?: number;
}
export const bandEdges = [40,120,350,1000,3000,8000,16000];

export function toneFeatures(samples: Float32Array, rate: number): ToneFeatures {
  if(!Number.isFinite(rate)||rate<8000||rate>192000||samples.length<2048)throw Error("Unsupported spectral input");
  let energy=0,peak=0;
  for(const value of samples){if(!Number.isFinite(value))throw Error("Nonfinite spectral input");energy+=value*value;peak=Math.max(peak,Math.abs(value));}
  if(energy/samples.length<1e-10)throw Error("Spectral input is too quiet");
  const size=2048,frames=Math.floor((samples.length-size)/(size/4))+1,count=Math.min(frames,128);
  const window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1)));
  const power=new Float64Array(size/2+1);
  let active=0, harmonicFrames=0, harmonicChecks=0, confidence=0; const harmonics=Array(6).fill(0);
  for(let frame=0;frame<count;frame++){
    const start=Math.round(frame*(frames-1)/Math.max(1,count-1))*size/4;
    let sum=0;for(let i=0;i<size;i++)sum+=samples[start+i]**2;
    if(sum/size<energy/samples.length*.01)continue;
    const bins=spectrum(window.map((w,i)=>samples[start+i]*w));
    if(frame % Math.max(1,Math.floor(count/16))===0){
      harmonicChecks++;
      const down=Array.from({length:size/4},(_,i)=>samples[start+i*4]), correlations:number[]=[];
      const lo=Math.max(2,Math.floor(rate/4/1000)),hi=Math.min(down.length/2,Math.ceil(rate/4/75));
      for(let lag=lo;lag<=hi;lag++){let xy=0,xx=0,yy=0;for(let i=lag;i<down.length;i++){xy+=down[i]*down[i-lag];xx+=down[i]**2;yy+=down[i-lag]**2;}correlations[lag]=xy/Math.max(1e-20,Math.sqrt(xx*yy));}
      const maximum=Math.max(...correlations.slice(lo));
      const lag=correlations.findIndex((x,i)=>i>lo&&i<hi&&x>=Math.max(.7,maximum*.9)&&x>=correlations[i-1]&&x>=correlations[i+1]);
      if(lag>0){const f0=rate/4/lag,profile=Array(6).fill(0);for(let h=1;h<=6;h++)for(let i=1;i<bins.length;i++)if(Math.abs(i*rate/size-h*f0)<=Math.max(rate/size,.08*f0))profile[h-1]+=bins[i]**2;
        const total=profile.reduce((a,b)=>a+b,0);if(total>1e-20){profile.forEach((x,i)=>harmonics[i]+=x/total);confidence+=correlations[lag];harmonicFrames++;}}
    }
    for(let i=0;i<bins.length;i++)power[i]+=bins[i]**2;
    active++;
  }
  if(!active)throw Error("No active spectral frames");
  const bands=Array(6).fill(0),fine=Array(24).fill(0);let total=0,weighted=0,logs=0,bins=0;
  for(let i=1;i<power.length;i++){
    const hz=i*rate/size;if(hz<40||hz>=16000)continue;
    const value=power[i]/active;
    const band=bandEdges.findIndex((edge,index)=>index<6&&hz>=edge&&hz<bandEdges[index+1]);
    bands[band]+=value;total+=value;weighted+=hz*value;logs+=Math.log(Math.max(value,1e-20));bins++;
    fine[Math.min(23,Math.floor(Math.log(hz/40)/Math.log(400)*24))]+=value;
  }
  if(total<=1e-16)throw Error("No usable guitar-band spectrum");
  const normalizedFine=fine.map(v=>v/total);
  const cepstrum=Array.from({length:8},(_,k)=>normalizedFine.reduce((sum,x,i)=>sum+10*Math.log10(Math.max(x,1e-8))*Math.cos(Math.PI*(k+1)*(i+.5)/24),0)/24);
  return {method:"spectral_bands_v1",bands:bands.map(v=>v/total),centroid_hz:weighted/total,
    flatness:Math.min(1,Math.exp(logs/bins)/(total/bins)),crest_db:20*Math.log10(peak/Math.sqrt(energy/samples.length)),fine_bands:normalizedFine,
    cepstrum,harmonic_profile:harmonicFrames?harmonics.map(x=>x/harmonicFrames):Array(6).fill(1/6),harmonic_confidence:harmonicChecks?confidence/harmonicChecks:0};
}

export function validToneFeatures(value: unknown): value is ToneFeatures {
  const x=value as ToneFeatures;
  return Boolean(x&&x.method==="spectral_bands_v1"&&Array.isArray(x.bands)&&x.bands.length===6
    &&x.bands.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Math.abs(x.bands.reduce((a,b)=>a+b,0)-1)<.001
    &&Number.isFinite(x.centroid_hz)&&x.centroid_hz>=40&&x.centroid_hz<=16000
    &&Number.isFinite(x.flatness)&&x.flatness>=0&&x.flatness<=1
    &&Number.isFinite(x.crest_db)&&x.crest_db>=0&&x.crest_db<=80
    &&(x.fine_bands===undefined||(Array.isArray(x.fine_bands)&&x.fine_bands.length===24&&x.fine_bands.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Math.abs(x.fine_bands.reduce((a,b)=>a+b,0)-1)<.001))
    &&(x.cepstrum===undefined||(Array.isArray(x.cepstrum)&&x.cepstrum.length===8&&x.cepstrum.every(v=>Number.isFinite(v)&&Math.abs(v)<=80)))
    &&(x.harmonic_profile===undefined||(Array.isArray(x.harmonic_profile)&&x.harmonic_profile.length===6&&x.harmonic_profile.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Math.abs(x.harmonic_profile.reduce((a,b)=>a+b,0)-1)<.001))
    &&(x.harmonic_confidence===undefined||(Number.isFinite(x.harmonic_confidence)&&x.harmonic_confidence>=0&&x.harmonic_confidence<=1)));
}

export function toneDistance(a: ToneFeatures,b: ToneFeatures): number {
  if(!validToneFeatures(a)||!validToneFeatures(b))throw Error("Invalid spectral descriptors");
  // A different performance changes this proxy; it is not a perceptual accuracy score.
  const bands=a.bands.reduce((sum,value,i)=>sum+Math.abs(10*Math.log10((value+1e-6)/(b.bands[i]+1e-6))),0)/6;
  return bands+.2*Math.abs(a.crest_db-b.crest_db)+.1*Math.abs(10*Math.log10((a.flatness+1e-8)/(b.flatness+1e-8)));
}

/** Finer envelope for local optimization; the legacy six-band score stays unchanged. */
export function detailedToneDistance(a: ToneFeatures,b: ToneFeatures): number {
  const coarse=toneDistance(a,b);
  if(!a.fine_bands||!b.fine_bands)return coarse;
  const fine=a.fine_bands.reduce((sum,value,i)=>sum+Math.abs(10*Math.log10((value+1e-6)/(b.fine_bands![i]+1e-6))),0)/24;
  return .7*fine+.3*coarse;
}
