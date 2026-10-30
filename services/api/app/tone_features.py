"""Gain-normalized six-band descriptors; no instrument/equipment identification."""
from array import array
import cmath
import math
import sys
from typing import Annotated, Literal
import wave
from pydantic import BaseModel, ConfigDict, Field, model_validator

EDGES = [40, 120, 350, 1000, 3000, 8000, 16000]


class ToneFeatures(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)
    method: Literal["spectral_bands_v1"]
    bands: list[Annotated[float, Field(ge=0, le=1)]] = Field(min_length=6, max_length=6)
    centroid_hz: float = Field(ge=40, le=16000)
    flatness: float = Field(ge=0, le=1)
    crest_db: float = Field(ge=0, le=80)
    fine_bands: list[Annotated[float, Field(ge=0, le=1)]] | None = Field(default=None, min_length=24, max_length=24)
    cepstrum: list[Annotated[float, Field(ge=-80, le=80)]] | None = Field(default=None, min_length=8, max_length=8)
    harmonic_profile: list[Annotated[float, Field(ge=0, le=1)]] | None = Field(default=None, min_length=6, max_length=6)
    harmonic_confidence: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def normalized(self):
        if abs(sum(self.bands) - 1) >= .001: raise ValueError("Spectral bands must sum to one")
        if self.fine_bands is not None and abs(sum(self.fine_bands)-1) >= .001: raise ValueError("Fine spectral bands must sum to one")
        if self.harmonic_profile is not None and abs(sum(self.harmonic_profile)-1) >= .001: raise ValueError("Harmonics must sum to one")
        return self


def _power(samples):
    n = len(samples); bins = [complex(x) for x in samples]
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit: j ^= bit; bit >>= 1
        j ^= bit
        if i < j: bins[i], bins[j] = bins[j], bins[i]
    size = 2
    while size <= n:
        step = cmath.exp(-2j * math.pi / size)
        for offset in range(0, n, size):
            weight = 1
            for k in range(size // 2):
                i = offset+k; j = i+size//2
                value = bins[j]*weight
                bins[j] = bins[i]-value; bins[i] += value; weight *= step
        size *= 2
    return [(abs(x)/n)**2 for x in bins[:n//2+1]]


def tone_features(samples, rate):
    if not 8000 <= rate <= 192000 or len(samples) < 2048 or any(not math.isfinite(x) for x in samples):
        raise ValueError("Invalid spectral input")
    energy = math.sumprod(samples, samples)/len(samples)
    if energy < 1e-10: raise ValueError("Spectral input is too quiet")
    size = 2048; frames = (len(samples)-size)//(size//4)+1; count = min(frames, 128)
    window = [.5-.5*math.cos(2*math.pi*i/(size-1)) for i in range(size)]
    power = [0.]*(size//2+1); active = 0
    harmonics = [0.]*6; harmonic_frames = 0; harmonic_checks = 0; confidence = 0.
    for frame in range(count):
        start = math.floor(frame*(frames-1)/max(1,count-1)+.5)*(size//4)
        block = samples[start:start+size]
        if math.sumprod(block, block)/size < energy*.01: continue
        spectrum = _power([x*w for x,w in zip(block,window)])
        if frame % max(1, count//16) == 0:
            harmonic_checks+=1
            down = block[::4]; lo = max(2, math.floor(rate/4/1000)); hi = min(len(down)//2, math.ceil(rate/4/75))
            correlations = {}
            for lag in range(lo,hi+1):
                a,b=down[lag:],down[:-lag]
                correlations[lag]=math.sumprod(a,b)/max(1e-20,math.sqrt(math.sumprod(a,a)*math.sumprod(b,b)))
            maximum=max(correlations.values())
            lag=next((i for i in range(lo+1,hi) if correlations[i]>=max(.7,maximum*.9) and correlations[i]>=correlations[i-1] and correlations[i]>=correlations[i+1]),None)
            if lag is not None:
                f0=rate/4/lag
                profile=[sum(x for i,x in enumerate(spectrum) if i and abs(i*rate/size-h*f0)<=max(rate/size,.08*f0)) for h in range(1,7)]
                mass=sum(profile)
                if mass>1e-20:
                    harmonics=[a+b/mass for a,b in zip(harmonics,profile)]; confidence+=correlations[lag]; harmonic_frames+=1
        power = [x+y for x,y in zip(power,spectrum)]; active += 1
    if not active: raise ValueError("No active spectral frames")
    bands = [0.]*6; fine = [0.]*24; total = weighted = logs = 0.; bins = 0
    for i in range(1,len(power)):
        hz = i*rate/size
        if not 40 <= hz < 16000: continue
        value = power[i]/active
        band = next(k for k in range(6) if EDGES[k] <= hz < EDGES[k+1])
        bands[band] += value; total += value; weighted += hz*value
        fine[min(23, math.floor(math.log(hz/40)/math.log(400)*24))] += value
        logs += math.log(max(value,1e-20)); bins += 1
    if total <= 1e-16: raise ValueError("No usable guitar-band spectrum")
    normalized_fine=[x/total for x in fine]
    cepstrum=[sum(10*math.log10(max(x,1e-8))*math.cos(math.pi*(k+1)*(i+.5)/24) for i,x in enumerate(normalized_fine))/24 for k in range(8)]
    return ToneFeatures.model_validate({"method":"spectral_bands_v1", "bands":[x/total for x in bands],
        "centroid_hz":weighted/total,"flatness":min(1,math.exp(logs/bins)/(total/bins)),
        "crest_db":20*math.log10(max(map(abs,samples))/math.sqrt(energy)),"fine_bands":normalized_fine,"cepstrum":cepstrum,
        "harmonic_profile":[x/harmonic_frames for x in harmonics] if harmonic_frames else [1/6]*6,
        "harmonic_confidence":confidence/harmonic_checks if harmonic_checks else 0}).model_dump(exclude_none=True)


def wav_tone_features(path, start, end, *, temporal=False):
    if path.stat().st_size > 50*1024*1024: raise ValueError("WAV exceeds analysis bound")
    with wave.open(str(path)) as audio:
        rate, channels = audio.getframerate(), audio.getnchannels()
        if rate != 44100 or channels not in (1,2) or audio.getsampwidth()!=2 or not 0 <= start < end <= audio.getnframes()/rate or not 3 <= end-start <= 20:
            raise ValueError("Use a bounded 3–20s 44.1kHz PCM16 passage")
        audio.setpos(int(start*rate)); data = audio.readframes(int((end-start)*rate))
        if len(data) != int((end-start)*rate)*channels*2: raise ValueError("Truncated spectral WAV")
    samples = array("h"); samples.frombytes(data)
    if sys.byteorder != "little": samples.byteswap()
    choices = [samples[i::channels] for i in range(channels)]
    selected = max(choices, key=lambda x:math.sumprod(x,x))
    normalized = [x/32768 for x in selected]
    if temporal:
        from .temporal_features import temporal_features
        return temporal_features(normalized, rate)
    return tone_features(normalized, rate)
