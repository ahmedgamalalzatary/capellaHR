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
        min_valid_frames: int = 3,
        min_live_ratio: float = 0.70,
    ) -> None:
        self.threshold = threshold
        self.min_valid_frames = min_valid_frames
        self.min_live_ratio = min_live_ratio

    def aggregate(
        self,
        scores: list[float],
    ) -> TemporalLivenessResult:

        total_frames = len(scores)

        if total_frames == 0:
            return TemporalLivenessResult(
                is_live=False,
                score=0.0,
                live_frames=0,
                spoof_frames=0,
                valid_frames=0,
                total_frames=0,
            )

        live_frames = sum(
            1 for score in scores
            if score >= self.threshold
        )

        spoof_frames = total_frames - live_frames

        valid_frames = total_frames

        live_ratio = live_frames / valid_frames

        mean_score = sum(scores) / valid_frames

        # A person must have:
        # 1. enough valid frames
        # 2. a high percentage of live frames
        # 3. a reasonable average live score
        is_live = (
            valid_frames >= self.min_valid_frames
            and live_ratio >= self.min_live_ratio
            and mean_score >= self.threshold
        )

        return TemporalLivenessResult(
            is_live=is_live,
            score=mean_score,
            live_frames=live_frames,
            spoof_frames=spoof_frames,
            valid_frames=valid_frames,
            total_frames=total_frames,
        )