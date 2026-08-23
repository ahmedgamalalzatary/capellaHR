from dataclasses import dataclass


@dataclass
class TemporalLivenessResult:
    is_live: bool
    score: float
    live_frames: int
    spoof_frames: int
    valid_frames: int
    total_frames: int


class TemporalLivenessAggregator:

    def __init__(
        self,
        threshold: float = 0.50,
        min_valid_frames: int = 5,
        min_live_ratio: float = 0.75,
    ) -> None:

        self.threshold = threshold
        self.min_valid_frames = min_valid_frames
        self.min_live_ratio = min_live_ratio

    def aggregate(
        self,
        scores: list[float],
    ) -> TemporalLivenessResult:

        total = len(scores)

        if total == 0:
            return TemporalLivenessResult(
                is_live=False,
                score=0.0,
                live_frames=0,
                spoof_frames=0,
                valid_frames=0,
                total_frames=0,
            )

        live_frames = sum(
            score >= self.threshold
            for score in scores
        )

        spoof_frames = (
            total - live_frames
        )

        live_ratio = (
            live_frames / total
        )

        mean_score = (
            sum(scores) / total
        )

        is_live = (
            total >= self.min_valid_frames
            and live_ratio >= self.min_live_ratio
            and mean_score >= self.threshold
        )

        return TemporalLivenessResult(
            is_live=is_live,
            score=mean_score,
            live_frames=live_frames,
            spoof_frames=spoof_frames,
            valid_frames=total,
            total_frames=total,
        )