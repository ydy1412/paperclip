"""Nested, product-disjoint evaluation and private training of weight classifiers."""
import argparse
import collections
import json
import math
from pathlib import Path
import resource
import shutil
import sys
import time
import numpy as np
from scipy.special import softmax
from model import digest, undersample
from regression_benchmark import group_folds, load_dataset
from ordinal_model import (CANDIDATES, HARD_CONTROL, REWARD, REWARD_BY_DISTANCE,
                           EDGES, LABELS, OrdinalClassifier, decisions, weight_classes,
                           product_weights, fit_calibration, class_ranges,
                           fee_references, save_bundle)


def classification_data(data_file, attributes_file, image_cache):
    data = load_dataset(data_file, attributes_file, image_cache)
    if data['priceInputMode'] != 'image-text-only':
        raise ValueError('Weight classification uses image, title, HS and quantity, not declared prices')
    valid = np.isfinite(data['weights']) & (data['weights'] > 0)
    source_count = len(valid)
    for key in ['labels', 'weights', 'groups', 'completeImages']:
        data[key] = data[key][valid]
    data['features'] = data['features'].take(np.flatnonzero(valid))
    data['rows'] = [row for row, keep in zip(data['rows'], valid) if keep]
    data['feeLabels'] = data['labels']
    data['labels'] = weight_classes(data['weights'])
    data['excludedMissingWeight'] = source_count-int(sum(valid))
    return data


def metrics(actual, predicted, groups, ranges=None):
    actual, predicted, groups = map(np.asarray, [actual, predicted, groups])
    if actual.shape != predicted.shape or len(actual) != len(groups) or not len(actual):
        raise ValueError('Invalid evaluation arrays')
    if ((actual < 0) | (actual > 4) | (predicted < 0) | (predicted > 4)).any():
        raise ValueError('Invalid weight class')
    distance = np.abs(actual-predicted)
    weight = product_weights(groups)
    macro = lambda value: float(np.dot(weight, value))
    confusion = np.zeros((5, 5))
    np.add.at(confusion, (actual, predicted), weight)
    result = {'records': len(actual), 'productGroups': len(np.unique(groups)),
              'macroPartialCredit': macro(REWARD_BY_DISTANCE[distance]),
              'macroExact': macro(distance == 0), 'macroWithinOneBand': macro(distance <= 1),
              'macroTwoOrMoreBandsOff': macro(distance >= 2),
              'macroSevereUnderestimate': macro(actual-predicted >= 2),
              'macroMeanBandDistance': macro(distance),
              'rowPartialCredit': float(REWARD_BY_DISTANCE[distance].mean()),
              'rowExact': float(np.mean(distance == 0)),
              'productWeightedConfusion': confusion.tolist(),
              'perBand': [{'label': LABELS[k], 'records': int(sum(actual == k)),
                           'products': len(np.unique(groups[actual == k])),
                           'macroRecall': float(np.sum(weight[(actual == k) & (predicted == k)])/np.sum(weight[actual == k])) if np.any(actual == k) else None}
                          for k in range(5)]}
    recalls = [b['macroRecall'] for b in result['perBand'] if b['macroRecall'] is not None]
    result['balancedRecall'] = float(np.mean(recalls))
    if ranges is not None:
        covered = (actual >= ranges[:, 0]) & (actual <= ranges[:, 1])
        width = ranges[:, 1]-ranges[:, 0]+1
        result['range'] = {'rowCoverage': float(covered.mean()), 'macroCoverage': macro(covered),
                           'wholeProductCoverage': float(np.mean([covered[groups == g].all() for g in np.unique(groups)])),
                           'macroMeanBandCount': macro(width), 'macroAllFiveBands': macro(width == 5),
                           'macroOneOrTwoBands': macro(width <= 2)}
    return result


def sample(data, indices):
    return undersample(indices, data['groups'], data['features'].quantities)


def select_candidate(data, training, seed, candidates=CANDIDATES):
    groups, features, labels = data['groups'], data['features'], data['labels']
    folds = group_folds(groups[training], 2, seed)
    results = []
    for config in candidates:
        predicted = np.full(len(training), -1, dtype=int)
        for local_test in folds:
            test = training[local_test]
            train = training[~np.isin(groups[training], groups[test])]
            picked = sample(data, train)
            assert not (set(groups[picked]) & set(groups[test]))
            model = OrdinalClassifier(config).fit(features.take(picked), labels[picked], groups[picked])
            predicted[local_test] = model.predict(features.take(test))
        results.append(metrics(labels[training], predicted, groups[training])['macroPartialCredit'])
    return int(np.argmax(results)), results


def split_calibration(data, available, seed):
    unique = np.unique(data['groups'][available]).copy()
    np.random.default_rng(seed).shuffle(unique)
    count = max(2, int(math.ceil(len(unique)*.2)))
    calibration = available[np.isin(data['groups'][available], unique[:count])]
    train = available[~np.isin(data['groups'][available], unique[:count])]
    return train, calibration


def prior_scores(data, train, test):
    weights = product_weights(data['groups'][train])
    probabilities = np.bincount(data['labels'][train], weights=weights, minlength=5)
    return np.tile(probabilities @ REWARD, (len(test), 1))


def nested_benchmark(data, output, seed=20261106, candidates=CANDIDATES):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    started = time.monotonic()
    groups, features, labels = data['groups'], data['features'], data['labels']
    source = output/'source'
    source.mkdir(exist_ok=True)
    files = ['ordinal_model.py', 'ordinal_benchmark.py', 'regression_model.py', 'regression_benchmark.py', 'model.py']
    code_hashes = {}
    for name in files:
        body = Path(__file__).with_name(name).read_bytes()
        (source/name).write_bytes(body)
        code_hashes[name] = digest(body)
    plan = {'seed': seed, 'outerFolds': 5, 'innerFolds': 2, 'calibrationGroupFraction': .2,
            'candidates': candidates, 'rewardByBandDistance': REWARD_BY_DISTANCE.tolist(),
            'lowerEdgesKg': EDGES.tolist(), 'selection': 'maximum inner equal-product partial credit',
            'trainingCapPerProduct': 12, 'trainingGroupTotalWeight': 'equal',
            'sourceHashes': data.get('sourceHashes', {}), 'codeHashes': code_hashes,
            'visionVersion': data.get('visionVersion'), 'priceInputMode': data.get('priceInputMode'),
            'physicalLabelContract': data.get('physicalLabelContract'),
            'records': len(labels), 'productGroups': len(np.unique(groups)),
            'excludedMissingWeight': data.get('excludedMissingWeight', 0),
            'noImageFiltering': True, 'prospectiveValidation': False}
    (output/'plan.json').write_text(json.dumps(plan, indent=2))
    predictions = np.full(len(labels), -1, dtype=int)
    hard = predictions.copy()
    matched_hard = predictions.copy()
    constant = predictions.copy()
    prior = weight_classes(np.maximum(np.expm1(features.frame['prior_geometric'].to_numpy()), .001))
    ranges = np.full((len(labels), 2), -1, dtype=int)
    fold_id = predictions.copy()
    utilities = np.full((len(labels), 5), np.nan)
    folds = []
    for fold, test in enumerate(group_folds(groups, 5, seed)):
        available = np.flatnonzero(~np.isin(groups, groups[test]))
        train, calibration = split_calibration(data, available, seed+100+fold)
        assert not(set(groups[train]) & set(groups[calibration]) or set(groups[available]) & set(groups[test]))
        selected, scores = select_candidate(data, train, seed+fold, candidates)
        picked = sample(data, train)
        model = OrdinalClassifier(candidates[selected]).fit(features.take(picked), labels[picked], groups[picked])
        fitted_calibration = fit_calibration(model.scores(features.take(calibration)), labels[calibration], groups[calibration])
        utilities[test] = model.scores(features.take(test))
        predictions[test] = decisions(utilities[test])
        ranges[test] = class_ranges(utilities[test], fitted_calibration)
        fold_id[test] = fold
        baseline = OrdinalClassifier(HARD_CONTROL).fit(features.take(picked), labels[picked], groups[picked])
        hard[test] = np.argmax(baseline.posterior(features.take(test)), axis=1)
        matched_config = {**candidates[selected]}
        if matched_config['family'] == 'reward_forest':
            matched_config['family'] = 'hard_forest'
        else:
            matched_config['strength'] = 0.
        matched = OrdinalClassifier(matched_config).fit(features.take(picked), labels[picked], groups[picked])
        if matched_config['family'] == 'softmax':
            matched_hard[test] = np.argmax(matched.posterior(features.take(test)), axis=1)
        else:
            matched_hard[test] = matched.predict(features.take(test))
        constant[test] = decisions(prior_scores(data, train, test))
        result = {'fold': fold, 'config': candidates[selected], 'innerScores': scores,
                  'fitGroups': np.unique(groups[train]).tolist(), 'calibrationGroups': np.unique(groups[calibration]).tolist(),
                  'testGroups': np.unique(groups[test]).tolist(), 'trainingBefore': len(train), 'trainingAfter': len(picked),
                  'largestTrainingGroupAfter': max(collections.Counter(groups[picked]).values()),
                  'training': model.training, 'calibration': fitted_calibration,
                  'metrics': metrics(labels[test], predictions[test], groups[test], ranges[test])}
        folds.append(result)
        np.savez_compressed(output/'predictions.npz', actual=labels, predicted=predictions, groups=groups,
                            ranges=ranges, fold=fold_id, utilities=utilities, hardControl=hard, matchedHardControl=matched_hard, constantControl=constant, visionPrior=prior)
        (output/'progress.json').write_text(json.dumps({'folds': folds, 'seconds': time.monotonic()-started}, indent=2))
        print(json.dumps({'fold': fold, 'config': result['config'], 'metrics': {key: result['metrics'][key] for key in ['macroPartialCredit', 'macroExact', 'macroWithinOneBand', 'range']}}), flush=True)
    report = {'plan': plan, 'folds': folds, 'outOfFold': metrics(labels, predictions, groups, ranges),
              'hardLabelControl': metrics(labels, hard, groups), 'constantControl': metrics(labels, constant, groups),
              'matchedHardTrainingControl': metrics(labels, matched_hard, groups),
              'visionPriorControl': metrics(labels, prior, groups),
              'seconds': time.monotonic()-started,
              'peakMemoryMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024**2 if sys.platform == 'darwin' else 1024),
              'prospectiveValidation': False}
    (output/'report.json').write_text(json.dumps(report, indent=2))
    return report


def train_candidate(data, output, evaluation, encoder_file=None, seed=20261106):
    directory = Path(output)
    train, calibration = split_calibration(data, np.arange(len(data['labels'])), seed+800)
    selected, inner_scores = select_candidate(data, train, seed+900)
    picked = sample(data, train)
    classifier = OrdinalClassifier(CANDIDATES[selected]).fit(data['features'].take(picked), data['labels'][picked], data['groups'][picked])
    fitted_calibration = fit_calibration(classifier.scores(data['features'].take(calibration)), data['labels'][calibration], data['groups'][calibration])
    reference = fee_references(data['labels'][picked], data['feeLabels'][picked], data['groups'][picked])
    metadata = {'config': CANDIDATES[selected], 'innerScores': inner_scores,
                'selectionMetric': 'equal-product partial credit', 'visionVersion': data['visionVersion'],
                'sourceHashes': data['sourceHashes'], 'featureInputs': ['image', 'title', 'HS', 'quantity'],
                'trainingRecords': len(picked), 'trainingGroups': len(np.unique(data['groups'][picked])),
                'trainingBeforeSampling': len(train), 'calibrationGroups': len(np.unique(data['groups'][calibration])),
                'quantityRange': [float(data['features'].quantities[picked].min()), float(data['features'].quantities[picked].max())],
                'groupOverlap': 0, 'evaluation': evaluation['outOfFold'],
                'evaluationProtocol': 'Nested historical group OOF, not a fresh test of this fitted artifact',
                'physicalLabelContract': data.get('physicalLabelContract'), 'prospectiveValidation': False}
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if encoder_file:
        expected = json.loads(Path(__file__).with_name('encoder.json').read_text())['sha256']
        if digest(Path(encoder_file).read_bytes()) != expected:
            raise ValueError('Image encoder does not match pinned source')
        shutil.copyfile(encoder_file, directory/'encoder.onnx')
        metadata['encoderSha256'] = expected
    return save_bundle(directory, classifier, fitted_calibration, reference, metadata)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['data', 'attributes', 'image-cache', 'output']:
        parser.add_argument('--'+flag, required=True)
    parser.add_argument('--encoder')
    parser.add_argument('--seed', type=int, default=20261106)
    args = parser.parse_args()
    dataset = classification_data(args.data, args.attributes, args.image_cache)
    report = nested_benchmark(dataset, args.output, args.seed)
    manifest = train_candidate(dataset, Path(args.output)/'candidate', report, args.encoder, args.seed)
    print(json.dumps({'outOfFold': report['outOfFold'], 'config': manifest['config'], 'seconds': report['seconds']}))
