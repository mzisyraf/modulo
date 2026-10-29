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
    return {"method": "envelope_v1", "correlations": correlations, "release_ratio": min(1, sum(release) / len(release) / peak) if release else 0}
