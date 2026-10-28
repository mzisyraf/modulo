"""Bounded browser-measured input levels, not server-verified spectral calibration."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class SourceCalibration(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)
    id: str = Field(pattern=r"^[0-9a-f]{64}$")
    method: Literal["browser_level_v1"]
    duration_seconds: float = Field(ge=3, le=90)
    rms_dbfs: float = Field(ge=-50, le=0)
    peak_dbfs: float = Field(ge=-50, le=0)
    clipped_fraction: float = Field(ge=0, lt=0.01)

    @model_validator(mode="after")
    def check_levels(self):
        if self.rms_dbfs > self.peak_dbfs:
            raise ValueError("RMS cannot exceed peak.")
        return self


def baseline_gain(source):
    return round(max(-24, min(12, -24 - source["rms_dbfs"], -6 - source["peak_dbfs"])), 1)
