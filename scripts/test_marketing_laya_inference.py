import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("laya_inference", Path(__file__).with_name("marketing-laya-inference.py"))
inference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inference)


class MarketingLayaInferenceTests(unittest.TestCase):
    def receipt(self):
        return {"answers": {"channelStatus": {"type": "choice", "choice": "connected",
                "probabilities": {"connected": 0.9, "auth_required": 0.05, "unknown": 0.05}}},
                "usage": {"input_tokens": 200, "output_tokens": 0, "truncated": False,
                          "state_tokens_dropped": 0, "truncated_questions": []}}

    def test_input_contains_only_three_fields(self):
        value = {"platform": "naver_blog", "accountId": " fixture_owner ", "observation": " Fresh evidence "}
        self.assertEqual(inference.validate_observation(value)["accountId"], "fixture_owner")
        with self.assertRaises(ValueError):
            inference.validate_observation(dict(value, expected="connected"))

    def test_invalid_input_is_rejected(self):
        for value in (None, {}, {"platform": "invented", "accountId": "x", "observation": "x"},
                      {"platform": "naver_blog", "accountId": "x", "observation": " "}):
            with self.assertRaises(ValueError):
                inference.validate_observation(value)

    def test_low_probability_is_unknown_not_deleted(self):
        result = self.receipt()
        self.assertEqual(inference.validated_decision(result, 0.8)["status"], "connected")
        self.assertEqual(inference.validated_decision(result, 0.95)["status"], "unknown")

    def test_truncation_is_rejected(self):
        for key, value in (("truncated", True), ("state_tokens_dropped", 1), ("truncated_questions", ["channelStatus"])):
            result = self.receipt()
            result["usage"][key] = value
            with self.assertRaises(ValueError):
                inference.validated_decision(result, 0.8)

    def test_bad_probabilities_or_choices_are_rejected(self):
        for value in (float("nan"), float("inf"), -1, True):
            result = self.receipt()
            result["answers"]["channelStatus"]["probabilities"]["connected"] = value
            with self.assertRaises(ValueError):
                inference.validated_decision(result, 0.8)
        result = self.receipt()
        result["answers"]["channelStatus"]["choice"] = "auth_required"
        with self.assertRaises(ValueError):
            inference.validated_decision(result, 0.8)

    def test_threshold_is_validated(self):
        for value in (float("nan"), 0.4, 1.1, True):
            with self.assertRaises(ValueError):
                inference.validated_decision(self.receipt(), value)


if __name__ == "__main__":
    unittest.main()
