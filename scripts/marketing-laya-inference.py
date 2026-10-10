"""One local, read-only channel decision. JSON stdin/stdout; no browser access."""

import argparse
import contextlib
import json
import math
import os
import sys
from pathlib import Path

LABELS = ("connected", "auth_required", "unknown")
PLATFORMS = {"naver_blog", "tistory", "threads", "x", "linkedin", "instagram", "youtube"}


def validate_observation(value):
    if not isinstance(value, dict) or set(value) != {"platform", "accountId", "observation"}:
        raise ValueError("Invalid observation fields")
    if any(not isinstance(v, str) for v in value.values()):
        raise ValueError("Invalid observation types")
    value = {k: v.strip() for k, v in value.items()}
    if value["platform"] not in PLATFORMS or not 1 <= len(value["accountId"]) <= 200 or not 1 <= len(value["observation"]) <= 12000:
        raise ValueError("Invalid observation values")
    return value


def validated_decision(result, threshold):
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0.5 <= threshold <= 1:
        raise ValueError("Invalid probability threshold")
    usage = result["usage"]
    if usage.get("truncated") is not False or usage.get("state_tokens_dropped") != 0 or usage.get("truncated_questions") or usage.get("options"):
        raise ValueError("Incomplete model input")
    answer = result["answers"]["channelStatus"]
    probabilities = answer["probabilities"]
    if answer.get("type") != "choice" or answer.get("choice") not in LABELS or set(probabilities) != set(LABELS):
        raise ValueError("Invalid model answer")
    if any(isinstance(p, bool) or not isinstance(p, (int, float)) or not math.isfinite(p) or not 0 <= p <= 1 for p in probabilities.values()):
        raise ValueError("Invalid model probabilities")
    if abs(sum(probabilities.values()) - 1) > 0.001:
        raise ValueError("Invalid probability sum")
    choice = answer["choice"]
    probability = probabilities[choice]
    if probability < max(probabilities.values()):
        raise ValueError("Inconsistent model choice")
    tokens = {"inputTokens": usage["input_tokens"], "outputTokens": usage["output_tokens"]}
    if any(type(v) is not int or v < 0 for v in tokens.values()):
        raise ValueError("Invalid token usage")
    return {"status": choice if probability >= threshold else "unknown", "choice": choice,
            "probability": probability, "probabilities": probabilities,
            "model": "local/laya-marketing-rlcd", "usage": tokens, "truncated": False}


def infer(checkpoint, state, device, threshold):
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", TOKENIZERS_PARALLELISM="false")
    for filename in ("model.safetensors", "rl_agent_config.json", "questions.json"):
        if not (checkpoint / filename).is_file():
            raise ValueError("Missing local checkpoint file")
    questions = json.loads((checkpoint / "questions.json").read_text(encoding="utf-8"))
    if set(questions) != {"channelStatus"} or questions["channelStatus"].get("type") != "choice" or tuple(questions["channelStatus"]["criteria"]) != LABELS:
        raise ValueError("Incompatible checkpoint questions")
    # Keep package diagnostics off the machine-readable stdout channel.
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import laya
        torch.set_num_threads(4)
        selected = ("mps" if torch.backends.mps.is_available() else "cpu") if device == "auto" else device
        agent = laya.load(str(checkpoint), device=selected)
        result = agent.predict(state, questions, max_len=512, head_max_len=160)
    return validated_decision(result, threshold)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    parser.add_argument("--min-probability", type=float, default=0.8)
    args = parser.parse_args()
    try:
        payload = sys.stdin.buffer.read(65537)
        if len(payload) > 65536:
            raise ValueError("Input too large")
        state = validate_observation(json.loads(payload))
        decision = infer(args.checkpoint.resolve(), state, args.device, args.min_probability)
        print(json.dumps(decision, allow_nan=False))
    except Exception:
        print("Local Laya inference failed; no channel state was confirmed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
