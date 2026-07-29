"""JSON-serializable structured output for release analysis."""

from pydantic import BaseModel, ConfigDict, Field


class FeatureItem(BaseModel):
    """One user-facing feature or change."""

    model_config = ConfigDict(extra="forbid")

    title: str
    description: str


class ReleaseAnalysis(BaseModel):
    """Validated LLM output independent of any provider."""

    model_config = ConfigDict(extra="forbid")

    summary: str
    feature_items: list[FeatureItem] = Field(default_factory=list)
    theme_tags: list[str] = Field(default_factory=list)
    importance_score: float = Field(ge=0, le=10)
    information_score: float = Field(ge=0, le=10)
    confidence: float = Field(ge=0, le=1)
