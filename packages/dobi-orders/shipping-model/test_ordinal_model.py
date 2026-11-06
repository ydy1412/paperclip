import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
try:
    from scipy.optimize import check_grad
    from ordinal_model import (OrdinalClassifier, REWARD, weight_classes, product_weights,
                               partial_objective, decisions, fit_calibration, class_ranges,
                               save_bundle, load_bundle, predict_request, fee_references, location_objective, prediction_scales)
    from ordinal_benchmark import nested_benchmark, metrics
    from regression_model import make_features
    from weight_bands import vip_contract, count as band_count, classify, interval, reward_matrix, utilities
except ModuleNotFoundError as error:
    raise unittest.SkipTest('Optional research dependencies are not installed') from error


class OrdinalModelTests(unittest.TestCase):
    def data(self, count=25):
        rows, attributes, vectors = [], {}, {}
        rng = np.random.default_rng(51)
        for index in range(count):
            key = 'image-'+str(index)
            label = index % 5
            rows.append({'category': '940320', 'items': [{'title': 'metal product class '+str(label),
                         'quantity': label+1, 'imageUrl': key}]})
            attributes[key] = {'kind': 'metal furniture', 'typeGroup': 'furniture', 'sizeClass': 'tabletop',
                               'description': 'test object', 'materials': ['metal'], 'evidence': [],
                               'weightPriorKg': {'lower': label*5+1, 'upper': label*5+4}}
            vectors[key] = rng.normal(size=1000).astype(np.float32)
        return {'features': make_features(rows, attributes, vectors), 'labels': np.arange(count)%5,
                'groups': np.arange(count), 'feeLabels': 6000+np.arange(count)%5*2000,
                'sourceHashes': {}, 'visionVersion': 'synthetic'}

    def test_exact_boundaries_missing_and_nonpositive_are_not_light_class(self):
        np.testing.assert_array_equal(weight_classes([.07, 4.999, 5, 9.999, 10, 15, 20, 96]), [0, 0, 1, 1, 2, 3, 4, 4])
        for values in [[0], [-1], [np.nan], [np.inf], [True], [True, 5]]:
            with self.assertRaises(ValueError):
                weight_classes(values)

    def test_partial_credit_is_in_the_loss_and_gradient(self):
        self.assertEqual(REWARD[2].tolist(), [.3, .5, 1., .5, .3])
        rng = np.random.default_rng(2)
        x = rng.normal(size=(7, 4))
        labels = np.arange(7)%5
        weights = product_weights(np.array([0, 0, 1, 2, 3, 4, 4]))
        parameters = rng.normal(size=20)*.1
        objective = lambda p: partial_objective(p, x, labels, weights, 3., .1)
        self.assertLess(check_grad(lambda p: objective(p)[0], lambda p: objective(p)[1], parameters), 1e-5)
        offset = rng.normal(size=(7, 5))
        shifted = lambda p: partial_objective(p, x, labels, weights, 3., .1, offset)
        self.assertLess(check_grad(lambda p: shifted(p)[0], lambda p: shifted(p)[1], parameters), 1e-5)
        nearby = np.array([.5, .49997, .00001, .00001, .00001])
        distant = nearby[[0, 4, 2, 3, 1]]
        value = lambda p: partial_objective(np.log(p), np.ones((1, 1)), np.array([0]), np.ones(1), 3., 0)[0]
        self.assertLess(value(nearby), value(distant))
        self.assertNotEqual(objective(parameters)[1].tolist(), partial_objective(parameters, x, labels, weights, 0., .1)[1].tolist())

    def test_vip_table_boundaries_replace_the_old_five_kg_labels(self):
        spec = vip_contract()
        np.testing.assert_array_equal(classify([.07, .5, .500001, 1., 1.2, 1.5, 5., 5.000001, 96, 449.5, 449.50001], spec),
                                      [0, 0, 1, 1, 2, 2, 9, 10, 191, 898, 899])
        self.assertEqual(band_count(spec), 900)
        self.assertEqual(interval(2, 2, spec), {'lowerKg': 1., 'upperKg': 1.5, 'lowerInclusive': False, 'upperExclusive': False})
        self.assertIsNone(interval(899, 899, spec)['upperKg'])
        self.assertEqual(spec['membership'], 'VIP')
        result = metrics(np.array([0]), np.array([0]), np.array([0]), np.array([[0, 899]]), spec)
        self.assertIsNone(result['range']['macroWidthKg'])
        self.assertEqual(result['range']['macroUpperUnbounded'], 1.)

    def test_shared_ordinal_loss_gradient_and_banded_reward_match(self):
        rng = np.random.default_rng(39)
        x = rng.normal(size=(8, 4));labels = np.arange(8);weights = np.ones(8)/8
        parameters = rng.normal(size=4)*.1;anchors = rng.uniform(0, 7, 8);scales = rng.uniform(1, 4, 8)
        objective = lambda p: location_objective(p, x, labels, weights, 3., .1, anchors, scales, 9)
        self.assertLess(check_grad(lambda p: objective(p)[0], lambda p: objective(p)[1], parameters), 1e-5)
        self.assertNotEqual(objective(parameters)[1].tolist(), location_objective(parameters, x, labels, weights, 0., .1, anchors, scales, 9)[1].tolist())
        probabilities = rng.uniform(size=(8, 9));probabilities /= probabilities.sum(axis=1, keepdims=True)
        local = {'upperEdgesKg': list(np.arange(.5, 4.5, .5))}
        np.testing.assert_allclose(utilities(probabilities), probabilities @ reward_matrix(local), atol=1e-15)

    def test_vip_training_has_900_outputs_and_persists_its_own_band_contract(self):
        data = self.data();spec = vip_contract()
        model = OrdinalClassifier({'family': 'ordered_location', 'strength': 1., 'l2': 1., 'temperature': 2.}, spec).fit(data['features'], data['labels'], data['groups'])
        scores = model.scores(data['features']);self.assertEqual(scores.shape, (25, 900))
        self.assertLess(model.training['parameters'], 900)
        scales = prediction_scales(data['features'], spec)
        calibration = fit_calibration(scores, data['labels'], data['groups'], scales=scales)
        ranges = class_ranges(scores, calibration, scales)
        self.assertTrue((ranges[:, 0] <= ranges[:, 1]).all())
        with tempfile.TemporaryDirectory() as directory:
            manifest = save_bundle(directory, model, calibration, None, {})
            output = predict_request(directory, {'category': '940320', 'items': [{'title': 'metal product', 'quantity': 2}]})
            self.assertEqual(manifest['bandContract']['id'], spec['id'])
            self.assertEqual(output['bandContract']['stepKg'], .5)
            self.assertFalse(output['weightBand']['upperExclusive'])

    def test_product_weights_do_not_reward_frequent_products(self):
        groups = np.array([0]*100+[1, 2])
        weights = product_weights(groups)
        self.assertAlmostEqual(weights[groups == 0].sum(), 1/3)
        self.assertAlmostEqual(weights[groups == 1].sum(), 1/3)
        actual = np.array([0]*100+[4, 4])
        result = metrics(actual, np.zeros(102, dtype=int), groups)
        self.assertAlmostEqual(result['macroPartialCredit'], 1/3)
        self.assertGreater(result['rowExact'], .98)

    def test_calibration_keeps_whole_products_and_exposes_unbounded_ranges(self):
        scores = np.tile([1., .5, .3, 0., 0.], (20, 1))
        labels = np.zeros(20, dtype=int)
        labels[-1] = 4
        calibration = fit_calibration(scores, labels, np.repeat(np.arange(10), 2))
        self.assertEqual(calibration['groups'], 10)
        self.assertEqual(calibration['radius'], 1.)
        np.testing.assert_array_equal(class_ranges(scores[:1], calibration), [[0, 4]])
        tiny = fit_calibration(scores[:2], labels[:2], np.array([0, 1]))
        self.assertIsNone(tiny['radius'])
        self.assertEqual(decisions(np.ones((1, 5)))[0], 4)

    def test_artifact_roundtrip_needs_no_outcome_and_detects_tampering(self):
        data = self.data()
        classifier = OrdinalClassifier({'family': 'softmax', 'strength': 1., 'l2': .1}).fit(data['features'], data['labels'], data['groups'])
        scores = classifier.scores(data['features'])
        calibration = fit_calibration(scores, data['labels'], data['groups'])
        fees = fee_references(data['labels'], data['feeLabels'], data['groups'])
        with tempfile.TemporaryDirectory() as directory:
            save_bundle(directory, classifier, calibration, fees, {})
            restored, _ = load_bundle(directory)
            np.testing.assert_allclose(restored['classifier'].scores(data['features']), scores)
            request = {'category': '940320', 'items': [{'title': 'metal product', 'quantity': 2}]}
            output = predict_request(directory, request)
            changed = predict_request(directory, {**request, 'physicalLabels': {'recordedWeightKg': 9000}, 'shippingFee': 1})
            self.assertEqual(output, changed)
            self.assertNotIn('historicalFeeReference', output)
            self.assertFalse(predict_request(directory, {**request, 'feeReferenceProvider': 'next1688'})['historicalFeeReference']['currentTariff'])
            self.assertEqual(output['featureCoverage']['image'], 0)
            file = Path(directory)/'classifier.joblib'
            file.write_bytes(file.read_bytes()+b'changed')
            with self.assertRaises(ValueError):
                load_bundle(directory)

    def test_nested_evaluation_scores_every_row_once_and_has_three_disjoint_partitions(self):
        data = self.data(25)
        with tempfile.TemporaryDirectory() as directory:
            report = nested_benchmark(data, directory, 15, [{'family': 'reward_forest', 'leaf': 2}])
            with np.load(Path(directory)/'predictions.npz', allow_pickle=False) as saved:
                self.assertTrue((saved['fold'] >= 0).all())
                self.assertTrue(np.isfinite(saved['utilities']).all())
                self.assertEqual(len(saved['actual']), 25)
            for fold in report['folds']:
                train, calibration, test = map(set, [fold['fitGroups'], fold['calibrationGroups'], fold['testGroups']])
                self.assertFalse(train & calibration or train & test or calibration & test)
            self.assertFalse(report['prospectiveValidation'])
            self.assertIn('macroAllFiveBands', report['outOfFold']['range'])


if __name__ == '__main__':
    unittest.main()
