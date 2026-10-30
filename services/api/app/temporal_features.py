"""Timing proxies; note choice and performance also change these descriptors."""
import math
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

LAGS_MS = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000]


class TemporalFeatures(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)
    method: Literal["envelope_v1"]
    correlations: list[Annotated[float, Field(ge=0, le=1)]] = Field(min_length=10, max_length=10)
    release_ratio: float = Field(ge=0, le=1)
    envelope_acf: list[Annotated[float, Field(ge=-1, le=1)]] | None = Field(default=None, min_length=100, max_length=100)
    decay_curve: list[Annotated[float, Field(ge=0, le=4)]] | None = Field(default=None, min_length=6, max_length=6)
    decay_counts: list[Annotated[int, Field(ge=0, le=32)]] | None = Field(default=None, min_length=6, max_length=6)


def temporal_features(samples, rate):
    if not 8000 <= rate <= 192000 or len(samples) < rate * 3 or any(not math.isfinite(x) for x in samples):
        raise ValueError("Invalid envelope input")
    block = math.floor(rate / 100 + .5)
    envelope = [math.sqrt(math.sumprod(samples[start:start+block], samples[start:start+block]) / block)
                for start in range(0, len(samples)-block+1, block)]
    if math.sumprod(envelope, envelope) < 1e-10: raise ValueError("Envelope is too quiet")
    correlations = []
    for ms in LAGS_MS:
        lag = ms // 10; a, b = envelope[lag:], envelope[:-lag]
        correlations.append(max(0, min(1, math.sumprod(a, b) / max(1e-20, math.sqrt(math.sumprod(a, a) * math.sumprod(b, b))))))
    peak = max(envelope); at = envelope.index(peak); release = envelope[at+10:at+51]
    mean=sum(envelope)/len(envelope); centered=[x-mean for x in envelope]
    acf=[]
    for lag in range(1,101):
        a,b=centered[lag:],centered[:-lag]
        acf.append(max(-1,min(1,math.sumprod(a,b)/max(1e-20,math.sqrt(math.sumprod(a,a)*math.sumprod(b,b))))))
    onsets=[]
    for i in range(5,len(envelope)-3):
        if len(onsets)>=32: break
        if envelope[i]>.15*peak and envelope[i]>1.6*(sum(envelope[i-5:i])/5+1e-12) and envelope[i]>=max(envelope[i+1:i+4]) and (not onsets or i-onsets[-1]>=25): onsets.append(i)
    decay=[]; counts=[]
    for lag in [5,10,20,40,80,120]:
        values=[min(4,sum(envelope[at+lag:at+lag+3])/3/envelope[at]) for index,at in enumerate(onsets) if at+lag+2<len(envelope) and at+lag+2<(onsets[index+1] if index+1<len(onsets) else math.inf)]
        counts.append(len(values)); decay.append(sum(values)/len(values) if values else 0.)
    return {"method": "envelope_v1", "correlations": correlations, "release_ratio": min(1, sum(release) / len(release) / peak) if release else 0,
            "envelope_acf":acf,"decay_curve":decay,"decay_counts":counts}
