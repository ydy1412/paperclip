"""Ordered weight-band classification with partial credit in the training loss.

Optional CPU research runtime. No network calls or resident model processes.
"""
import argparse
import base64
import json
import math
import os
from pathlib import Path
import sys
import time

os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
import joblib
import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp, softmax
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.feature_extraction import DictVectorizer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler
from model import digest, image_bytes
from regression_model import CATEGORICAL, NUMERIC, make_features

EDGES = np.array([0., 5., 10., 15., 20.])
LABELS = ['5kg 미만', '5kg 이상~10kg 미만', '10kg 이상~15kg 미만',
          '15kg 이상~20kg 미만', '20kg 이상']
REWARD_BY_DISTANCE = np.array([1., .5, .3, 0., 0.])
REWARD = REWARD_BY_DISTANCE[np.abs(np.arange(5)[:, None] - np.arange(5))]
CANDIDATES = [
    {'family': 'softmax', 'strength': 1., 'l2': .01},
    {'family': 'softmax', 'strength': 1., 'l2': .1},
    {'family': 'softmax', 'strength': 3., 'l2': .01},
    {'family': 'softmax', 'strength': 3., 'l2': .1},
    {'family': 'reward_forest', 'leaf': 2},
    {'family': 'reward_forest', 'leaf': 5},
    {'family': 'softmax', 'strength': 1., 'l2': 1., 'priorStrength': 2.},
    {'family': 'softmax', 'strength': 3., 'l2': 1., 'priorStrength': 2.},
    {'family': 'softmax', 'strength': 1., 'l2': 1., 'priorStrength': 4.},
    {'family': 'softmax', 'strength': 3., 'l2': 1., 'priorStrength': 4.},
]
HARD_CONTROL = {'family': 'softmax', 'strength': 0., 'l2': .1}
LIMITATIONS = [
    'Historical Weight uses an assumed kg unit; actual versus chargeable weight is unverified.',
    'Weight bands classify the complete recorded application, including its quantities; not bare single-item mass.',
    'A new forwarder can use the weight output only after validating label and packaging differences.',
    'Band scores are utilities, not calibrated class probabilities or per-item confidence.',
    '90% ranges use independent-product calibration; future coverage and each category are not guaranteed.',
    'No measured package dimensions exist: volumetric weight and freight charges are not predicted.',
    'Next1688 fee references describe historical recorded fees, not current tariffs or another forwarder.',
    'Recorded fees can already include unlabelled remote charges; a further 5000 KRW is only an explicit scenario.',
]


def weight_classes(weights):
    if any(isinstance(value, (bool, np.bool_)) for value in np.asarray(weights, dtype=object).flat):
        raise ValueError('Boolean is not a weight')
    weights = np.asarray(weights, dtype=float)
    if weights.ndim != 1 or not np.isfinite(weights).all() or np.any(weights <= 0):
        raise ValueError('Positive finite labeled weights are required')
    return np.searchsorted(EDGES[1:], weights, side='right')


def product_weights(groups):
    groups = np.asarray(groups)
    unique, inverse, counts = np.unique(groups, return_inverse=True, return_counts=True)
    return 1. / (len(unique) * counts[inverse])


def partial_objective(parameters, x, labels, weights, strength, l2, offset=None):
    """CE + strength * expected (1-partial credit), with an exact gradient."""
    coefficients = parameters.reshape(x.shape[1], 5)
    logits = x @ coefficients
    if offset is not None:
        logits += offset
    probabilities = softmax(logits, axis=1)
    costs = 1 - REWARD[labels]
    expected = np.sum(probabilities * costs, axis=1)
    ce = logsumexp(logits, axis=1) - logits[np.arange(len(labels)), labels]
    # The last row is the intercept, which is not regularized.
    loss = np.dot(weights, ce + strength * expected) + .5 * l2 * np.sum(coefficients[:-1] ** 2)
    gradient = probabilities.copy()
    gradient[np.arange(len(labels)), labels] -= 1
    gradient += strength * probabilities * (costs - expected[:, None])
    derivative = x.T @ (weights[:, None] * gradient)
    derivative[:-1] += l2 * coefficients[:-1]
    return float(loss), derivative.ravel()


class FeatureEncoder:
    """All fitted vocabularies, scales and projections belong to training only."""
    def transform(self, features, fit=False):
        if fit:
            self.words = TfidfVectorizer(ngram_range=(1, 2), max_features=2000, sublinear_tf=True)
            self.characters = TfidfVectorizer(analyzer='char', ngram_range=(3, 5), max_features=3000, sublinear_tf=True)
            self.categories = DictVectorizer(sparse=False)
            self.numeric = StandardScaler()
        apply = lambda transformer, values: transformer.fit_transform(values) if fit else transformer.transform(values)
        text = ['product ' + str(value) for value in features.text]
        word = apply(self.words, text)
        char = apply(self.characters, text)
        from scipy.sparse import hstack
        text_matrix = hstack([word, char]).tocsr()
        if fit:
            count = len(features.text)
            self.text_projection = TruncatedSVD(n_components=min(32, count-1, text_matrix.shape[1]-1), random_state=29)
            self.image_projection = TruncatedSVD(n_components=min(16, count-1, features.images.shape[1]-1), random_state=29)
        text_values = apply(self.text_projection, text_matrix)
        image_values = apply(self.image_projection, features.images)
        categories = apply(self.categories, features.frame[CATEGORICAL].to_dict('records'))
        numeric = np.clip(apply(self.numeric, features.frame[NUMERIC]), -10, 10)
        return np.column_stack([text_values*2, image_values*2, categories, numeric*.5, np.ones(len(text))])


class OrdinalClassifier:
    def __init__(self, config):
        self.config = dict(config)

    def fit(self, features, labels, groups):
        self.encoder = FeatureEncoder()
        x = self.encoder.transform(features, fit=True)
        labels = np.asarray(labels, dtype=int)
        weights = product_weights(groups)
        if self.config['family'] == 'softmax':
            result = minimize(partial_objective, np.zeros(x.shape[1]*5),
                              args=(x, labels, weights, self.config['strength'], self.config['l2'], self.prior_offset(features)),
                              jac=True, method='L-BFGS-B', options={'maxiter': 250, 'ftol': 1e-9})
            if not result.success:
                raise ValueError('Classifier optimization did not converge: ' + str(result.message))
            self.coefficients = result.x.reshape(x.shape[1], 5)
            self.training = {'objective': float(result.fun), 'iterations': int(result.nit), 'converged': True}
        elif self.config['family'] in ['reward_forest', 'hard_forest']:
            # Each of the five supervised targets is the reward for that action.
            # This learns band utilities directly, rather than regressing kg.
            self.forest = ExtraTreesRegressor(n_estimators=180, min_samples_leaf=self.config['leaf'],
                                             max_features=.8, n_jobs=1, random_state=29)
            targets = REWARD[labels] if self.config['family'] == 'reward_forest' else np.eye(5)[labels]
            self.forest.fit(x, targets, sample_weight=weights)
            self.training = {'objective': 'MSE of five partial-credit reward targets' if self.config['family'] == 'reward_forest' else 'MSE of one-hot targets (control)', 'trees': 180}
        else:
            raise ValueError('Unknown classifier family')
        return self

    def prior_offset(self, features):
        prior = np.expm1(features.frame['prior_geometric'].to_numpy())
        known = features.frame['has_prior'].to_numpy() > 0
        anchors = weight_classes(np.where(prior > 0, prior, 1))
        return -self.config.get('priorStrength', 0.) * np.abs(np.arange(5)-anchors[:, None]) * known[:, None]

    def posterior(self, features):
        return softmax(self.encoder.transform(features) @ self.coefficients + self.prior_offset(features), axis=1)

    def scores(self, features):
        if self.config['family'] == 'softmax':
            result = self.posterior(features) @ REWARD
        else:
            result = self.forest.predict(self.encoder.transform(features))
        if result.shape != (len(features.text), 5) or not np.isfinite(result).all():
            raise ValueError('Invalid class utility scores')
        return np.clip(result, 0, 1)

    def predict(self, features):
        # Ties choose the heavier band, so neutral ties do not bias downwards.
        return decisions(self.scores(features))


def decisions(scores):
    return 4 - np.argmax(np.asarray(scores)[:, ::-1], axis=1)


def finite_quantile(scores, coverage=.9):
    scores = np.asarray(scores, dtype=float)
    if not len(scores) or not np.isfinite(scores).all():
        raise ValueError('Finite calibration scores required')
    rank = math.ceil((len(scores)+1)*coverage)
    return float(np.sort(scores)[rank-1]) if rank <= len(scores) else math.inf


def fit_calibration(scores, labels, groups, coverage=.9):
    margins = scores.max(axis=1) - scores[np.arange(len(labels)), labels]
    maxima = [float(margins[groups == g].max()) for g in np.unique(groups)]
    radius = finite_quantile(maxima, coverage)
    return {'radius': radius if math.isfinite(radius) else None,
            'groups': len(maxima), 'targetCoverage': coverage, 'unit': 'whole independent product group'}


def class_ranges(scores, calibration):
    radius = calibration['radius']
    accepted = np.ones_like(scores, dtype=bool) if radius is None else scores.max(axis=1)[:, None] - scores <= radius + 1e-12
    # Contiguous hull is honest about the order and includes the selected band.
    return np.array([[int(np.flatnonzero(row)[0]), int(np.flatnonzero(row)[-1])] for row in accepted])


def band_range(lower, upper):
    return {'lowerKg': float(EDGES[lower]), 'upperKg': float(EDGES[upper+1]) if upper < 4 else None,
            'lowerInclusive': True, 'upperExclusive': True}


def weighted_quantile(values, weights, probability):
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    return float(values[order[min(np.searchsorted(cumulative, probability*cumulative[-1]), len(order)-1)]])


def fee_references(labels, fees, groups):
    result = []
    for band in range(5):
        mask = labels == band
        fallback = len(np.unique(groups[mask])) < 8
        if fallback:
            mask = np.ones(len(labels), dtype=bool)
        weights = product_weights(groups[mask])
        result.append({'medianKrw': weighted_quantile(fees[mask], weights, .5),
                       'historicalRangeKrw': [weighted_quantile(fees[mask], weights, p) for p in [.1, .9]],
                       'independentProducts': len(np.unique(groups[mask])), 'fallbackToAllBands': fallback})
    return result


def save_bundle(directory, classifier, calibration, fee_reference, metadata):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    pending = directory / 'classifier.next.joblib'
    joblib.dump({'classifier': classifier, 'calibration': calibration, 'feeReferences': fee_reference}, pending)
    pending.replace(directory/'classifier.joblib')
    manifest = {'schemaVersion': 1, 'model': 'partial-credit-ordinal-weight-classifier',
                'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'pythonExecutable': sys.executable, 'target': 'legacy-recorded-Weight-bands-assumed-kg',
                'readiness': 'experimental-recorded-weight-classification', 'bands': LABELS,
                'lowerEdgesKg': EDGES.tolist(), 'rewardByBandDistance': REWARD_BY_DISTANCE.tolist(),
                'calibration': calibration, 'limitations': LIMITATIONS,
                'artifactSha256': digest((directory/'classifier.joblib').read_bytes()), **metadata}
    (directory/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False))
    return manifest


def load_bundle(directory):
    # Local operator-created artifacts only. Joblib is not a safe upload format.
    directory = Path(directory)
    manifest = json.loads((directory/'manifest.json').read_text())
    if manifest.get('model') != 'partial-credit-ordinal-weight-classifier' or manifest.get('schemaVersion') != 1:
        raise ValueError('Unsupported classifier artifact')
    file = directory/'classifier.joblib'
    if digest(file.read_bytes()) != manifest['artifactSha256']:
        raise ValueError('Classifier artifact hash mismatch')
    return joblib.load(file), manifest


def predict_request(directory, request):
    bundle, manifest = load_bundle(directory)
    items = request.get('items')
    if not isinstance(request.get('remoteArea', False), bool):
        raise ValueError('remoteArea must be an explicit boolean when present')
    if not isinstance(items, list) or not 1 <= len(items) <= 5:
        raise ValueError('One to five items required')
    row = {'category': request.get('category', 'unknown'), 'items': []}
    attributes, vectors = {}, {}
    vision = request.get('vision', [])
    if vision and len(vision) != len(items):
        raise ValueError('Image attribute count mismatch')
    encoder = None
    for index, item in enumerate(items):
        title, quantity = item.get('title'), item.get('quantity', 1)
        if not isinstance(title, str) or not title.strip() or len(title) > 500 or isinstance(quantity, bool) or not isinstance(quantity, (float, int)) or not math.isfinite(quantity) or not 1 <= quantity <= 100000:
            raise ValueError('Invalid title or quantity')
        key = str(index)
        row['items'].append({'title': title.strip(), 'quantity': quantity, 'imageUrl': key})
        if vision:
            attributes[key] = vision[index]
        if item.get('imageBase64'):
            data = item['imageBase64']
            if not isinstance(data, str) or len(data) > 7*1024*1024:
                raise ValueError('Image too large')
            image = image_bytes(base64.b64decode(data, validate=True))
            if encoder is None:
                from model import Encoder
                file = Path(directory)/'encoder.onnx'
                if digest(file.read_bytes()) != manifest.get('encoderSha256'):
                    raise ValueError('Image encoder hash mismatch')
                encoder = Encoder(file)
            vectors[key] = encoder.encode(image)
    if not isinstance(row['category'], str) or len(row['category']) > 200:
        raise ValueError('Invalid HS category')
    features = make_features([row], attributes, vectors)
    scores = bundle['classifier'].scores(features)
    selected = int(decisions(scores)[0])
    lower, upper = class_ranges(scores, bundle['calibration'])[0]
    quantity = float(features.quantities[0])
    quantity_range = manifest.get('quantityRange', [1, math.inf])
    review = []
    if upper-lower >= 2:
        review.append('wide_weight_range')
    if not quantity_range[0] <= quantity <= quantity_range[1]:
        review.append('quantity_outside_training_range')
    if len(vectors) < len(items) or len(attributes) < len(items):
        review.append('missing_image_features')
    result = {'model': manifest['model'], 'readiness': manifest['readiness'],
              'weightBand': {'index': selected, 'label': LABELS[selected], **band_range(selected, selected)},
              'predictionRange': {**band_range(lower, upper), 'bands': LABELS[lower:upper+1],
                                  'targetCoverage': bundle['calibration']['targetCoverage'],
                                  'allBands': bool(lower == 0 and upper == 4)},
              'classUtilities': scores[0].tolist(), 'scoreMeaning': 'partial-credit utility; not probability',
              'requiresReview': bool(review), 'reviewReasons': review,
              'featureCoverage': {'image': len(vectors), 'imageAttributes': len(attributes), 'items': len(items)},
              'limitations': manifest['limitations']}
    # The common weight classification has no provider-specific price fallback.
    if request.get('feeReferenceProvider') == 'next1688':
        result['historicalFeeReference'] = {'provider': 'next1688', 'currentTariff': False,
                                           **bundle['feeReferences'][selected]}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['predict'])
    parser.add_argument('--model-dir', required=True)
    args = parser.parse_args()
    try:
        if len(raw := sys.stdin.read(10*1024*1024+1)) > 10*1024*1024:
            raise ValueError('Request too large')
        print(json.dumps(predict_request(args.model_dir, json.loads(raw)), ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({'error': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
