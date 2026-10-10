import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("marketing_laya_training", Path(__file__).with_name("marketing-laya-training.py"))
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)


class MarketingLayaTrainingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.rows = {}
        for split in ("train", "calibration", "test"):
            self.rows[split] = [dict(zip(training.FIELDS, (
                f"{split}_{index}", f"{split}_family_{index}", split, "naver_blog",
                "fixture_owner", f"Fictional observation {split} {index} with enough detail", label,
                "Synthetic expected label explanation",
            ))) for index, label in enumerate(training.LABELS)]

    def write_csv(self):
        for split, rows in self.rows.items():
            with (self.directory / f"{split}.csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=training.FIELDS)
                writer.writeheader()
                writer.writerows(rows)

    def test_multiline_and_comma_are_preserved(self):
        text = 'Fictional channel observation, "quoted"\nSecond line of evidence'
        self.rows["train"][0]["observation"] = text
        self.write_csv()
        self.assertEqual(training.read_dataset(self.directory)["train"][0]["observation"], text)

    def test_cross_split_family_is_rejected(self):
        self.rows["test"][0]["family_id"] = self.rows["train"][0]["family_id"]
        self.write_csv()
        with self.assertRaisesRegex(ValueError, "family leaks"):
            training.read_dataset(self.directory)

    def test_account_substitution_does_not_hide_duplicate(self):
        self.rows["train"][0]["observation"] = "Channel for fixture_alpha was inspected recently"
        self.rows["test"][0]["observation"] = "Channel for fixture_beta was inspected recently"
        self.write_csv()
        with self.assertRaisesRegex(ValueError, "Duplicate observation"):
            training.read_dataset(self.directory)

    def test_nonfictional_account_is_rejected(self):
        self.rows["train"][0]["account_id"] = "actual-owner"
        self.write_csv()
        with self.assertRaisesRegex(ValueError, "Nonfictional"):
            training.read_dataset(self.directory)

    def test_wrong_label_and_split_are_rejected(self):
        for field, value in (("label", "deleted"), ("split", "test")):
            original = self.rows["train"][0][field]
            self.rows["train"][0][field] = value
            self.write_csv()
            with self.assertRaisesRegex(ValueError, "row contract"):
                training.read_dataset(self.directory)
            self.rows["train"][0][field] = original

    def test_labels_and_rationale_are_not_in_model_state(self):
        converted = training.training_row(self.rows["train"][0])
        self.assertEqual(set(converted["state"]), {"platform", "accountId", "observation"})
        self.assertEqual(converted["expected"], {"channelStatus": "connected"})

    def write_final_csv(self, duplicate=False):
        rows = [dict(row, id=f"final_{index}", family_id=f"final_family_{index}", split="final_test",
                     observation=f"Final independent fictional evidence example number {index}")
                for index, row in enumerate(self.rows["test"])]
        if duplicate:
            rows[0]["observation"] = self.rows["train"][0]["observation"]
        with (self.directory / "final-test.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=training.FIELDS)
            writer.writeheader()
            writer.writerows(rows)

    def test_independent_final_set_is_read_without_training(self):
        self.write_csv()
        self.write_final_csv()
        self.assertEqual(len(training.read_dataset(self.directory, include_final=True)["final_test"]), 3)

    def test_final_set_duplicate_is_rejected(self):
        self.write_csv()
        self.write_final_csv(duplicate=True)
        with self.assertRaisesRegex(ValueError, "Duplicate observation"):
            training.read_dataset(self.directory, include_final=True)

    def test_metrics_measure_false_connected(self):
        result = training.metrics(list(training.LABELS), [[0.9, 0.05, 0.05], [0.8, 0.1, 0.1], [0.1, 0.1, 0.8]])
        self.assertAlmostEqual(result["accuracy"], 2 / 3)
        self.assertEqual(result["false_connected_rate"], 0.5)
        self.assertEqual(result["confusion_matrix"], [[1, 0, 0], [1, 0, 0], [0, 0, 1]])

    def test_invalid_probabilities_never_pass(self):
        for distribution in ([float("nan"), 0.5, 0.5], [-0.1, 0.5, 0.6], [0.5, 0.5, 0.5]):
            with self.assertRaisesRegex(ValueError, "Invalid probability"):
                training.metrics(["unknown"], [distribution])


if __name__ == "__main__":
    unittest.main()
