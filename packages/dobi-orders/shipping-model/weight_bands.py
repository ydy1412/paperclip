"""Versioned weight-label contracts. Tariff endpoints are not parcel-size rules."""
import json
from pathlib import Path
import numpy as np

COARSE = {'id': 'coarse-5kg-v1', 'lowerEdgesKg': [0., 5., 10., 15., 20.],
          'labels': ['5kg 미만', '5kg 이상~10kg 미만', '10kg 이상~15kg 미만',
                     '15kg 이상~20kg 미만', '20kg 이상']}


def vip_contract():
    snapshot = json.loads(Path(__file__).with_name('next1688-vip-tariff.json').read_text())
    upper = snapshot['weightUpperBoundsKg']
    if snapshot['membership'] != 'VIP' or snapshot['stepKg'] != .5 or not snapshot['upperInclusive']:
        raise ValueError('Invalid VIP tariff contract')
    if not np.array_equal(upper, np.arange(.5, upper[-1]+.25, .5)):
        raise ValueError('VIP table must have complete half-kg steps')
    for route in snapshot['routes']:
        if not route['vipKrw'] or len(route['vipKrw']) > len(upper) or not all(isinstance(p, int) and p > 0 for p in route['vipKrw']):
            raise ValueError('Invalid route tariff rows')
    return {'id': 'next1688-vip-half-kg-v1', 'upperEdgesKg': upper, 'stepKg': .5,
            'provider': 'next1688', 'membership': 'VIP', 'checkedOn': snapshot['checkedOn'],
            'sources': [{'route': r['id'], 'url': r['source'], 'maxKg': upper[len(r['vipKrw'])-1]} for r in snapshot['routes']]}


def count(spec=COARSE):
    return len(spec['upperEdgesKg'])+1 if 'upperEdgesKg' in spec else len(spec['lowerEdgesKg'])


def labels(spec=COARSE):
    if 'labels' in spec:
        return spec['labels']
    upper = spec['upperEdgesKg']
    return [f'{value:g}kg 이하' if i == 0 else f'{upper[i-1]:g}kg 초과~{value:g}kg 이하'
            for i, value in enumerate(upper)] + [f'{upper[-1]:g}kg 초과 (요율표 밖)']


def classify(weights, spec=COARSE):
    if any(isinstance(value, (bool, np.bool_)) for value in np.asarray(weights, dtype=object).flat):
        raise ValueError('Boolean is not a weight')
    values = np.asarray(weights, dtype=float)
    if values.ndim != 1 or not np.isfinite(values).all() or np.any(values <= 0):
        raise ValueError('Positive finite labeled weights are required')
    if 'upperEdgesKg' in spec:
        return np.searchsorted(spec['upperEdgesKg'], values, side='left')
    return np.searchsorted(spec['lowerEdgesKg'][1:], values, side='right')


def interval(lower, upper, spec=COARSE):
    if not 0 <= lower <= upper < count(spec):
        raise ValueError('Invalid band interval')
    if 'upperEdgesKg' in spec:
        edges = spec['upperEdgesKg']
        return {'lowerKg': float(edges[lower-1]) if lower else 0.,
                'upperKg': float(edges[upper]) if upper < len(edges) else None,
                'lowerInclusive': False, 'upperExclusive': False}
    edges = spec['lowerEdgesKg']
    return {'lowerKg': float(edges[lower]), 'upperKg': float(edges[upper+1]) if upper < len(edges)-1 else None,
            'lowerInclusive': True, 'upperExclusive': True}


def credit(distance):
    return np.choose(np.minimum(np.asarray(distance, dtype=int), 3), [1., .5, .3, 0.])


def reward_matrix(spec=COARSE):
    indices = np.arange(count(spec))
    return credit(np.abs(indices[:, None]-indices))


def utilities(probabilities):
    """Banded reward multiplication, O(rows * bands), without a dense K^2 product."""
    result = probabilities.copy()
    for distance, reward in [(1, .5), (2, .3)]:
        result[:, distance:] += reward*probabilities[:, :-distance]
        result[:, :-distance] += reward*probabilities[:, distance:]
    return result
