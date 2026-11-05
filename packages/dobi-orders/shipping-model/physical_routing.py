"""Independent parcel-size and weight axes, using provider-sourced bands."""
import itertools
import json
from pathlib import Path
import numpy as np


def load_policy():
    return json.loads(Path(__file__).with_name('next1688-physical-policy.json').read_text())


def band(value, axis):
    return next((name for name, upper in zip(axis['names'], axis['upperInclusive']) if value <= upper), axis['names'][-1])


def weight_candidates(lower, upper, policy):
    axis = policy['weightBands']; names = axis['names']
    first = names.index(band(lower, axis)); last = names.index(band(upper, axis)) if upper is not None else len(names) - 1
    return names[first:last + 1]


def validate_parcel(parcel):
    if parcel is None:
        return {}
    if not isinstance(parcel, dict) or not parcel:
        raise ValueError('Invalid parcel measurements')
    clean = {}
    def number(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not 0 < value <= 100000:
            raise ValueError('Invalid parcel measurement')
        return value
    if 'weightKg' in parcel:
        clean['weightKg'] = number(parcel['weightKg'])
    if 'dimensionsCm' in parcel:
        dims = parcel['dimensionsCm']
        if not isinstance(dims, dict) or not all(k in dims for k in ['length', 'width', 'height']):
            raise ValueError('Complete packed dimensions required')
        clean['dimensionsCm'] = {k: number(dims[k]) for k in ['length', 'width', 'height']}
    if 'hub' in parcel:
        if parcel['hub'] is not None and (not isinstance(parcel['hub'], str) or parcel['hub'] not in {'gunsan', 'other'}):
            raise ValueError('Invalid dispatch hub')
        clean['hub'] = parcel['hub']
    if not clean:
        raise ValueError('No parcel measurements')
    return clean


def physical_route(row, attributes, policy, parcel=None):
    parcel = validate_parcel(parcel)
    if not attributes or len(row['items']) != len(attributes):
        raise ValueError('Each item needs attributes')
    reasons = []; dims = parcel.get('dimensionsCm'); size_basis = ['reported_packed_dimensions'] if dims else []
    # Only one unit with quoted PACKAGE dimensions can supply a parcel shape.
    if not dims and len(attributes) == 1 and row['items'][0].get('quantity', 1) == 1:
        quoted = {}
        for e in attributes[0].get('evidence', []):
            if e['scope'] == 'package' and e['kind'] in {'length', 'width', 'height'} and e['unit'] in {'mm', 'cm', 'm'}:
                quoted[e['kind']] = e['value'] * {'mm': .1, 'cm': 1, 'm': 100}[e['unit']]
        if len(quoted) == 3:
            dims = quoted; size_basis = ['vision_read_package_dimensions']
    edge_sum = sum(dims.values()) if dims else None
    size_grade = band(edge_sum, policy['sizeBands']) if dims else 'unknown'
    size = {'grade': size_grade, 'candidates': [size_grade], 'metric': policy['sizeBands']['metric'],
            'edgeSumCm': edge_sum, 'dimensionsCm': dims,
            'volumeCbm': np.prod(list(dims.values())).item() / 1e6 if dims else None,
            'basis': size_basis or ['missing_packed_dimensions'], 'independentlyVerified': False}
    if not dims:
        reasons.append('Packed dimensions are absent; visual product scale is not a parcel-size label.')
    lower = 0.; upper = 0.; mass_basis = set(); complete = True
    if 'weightKg' in parcel:
        lower = upper = parcel['weightKg']; mass_basis.add('reported_packed_weight')
    else:
        for item, a in zip(row['items'], attributes):
            q = item.get('quantity', 1); product_mass = 0.; package_mass = None
            for e in a.get('evidence', []):
                if e['kind'] == 'mass' and e['unit'] in {'kg', 'g'}:
                    kg = e['value'] * (.001 if e['unit'] == 'g' else 1)
                    if e['scope'] == 'product':
                        product_mass = max(product_mass, kg * q)
                    if e['scope'] == 'package' and len(attributes) == 1 and q == 1:
                        package_mass = kg
            prior = a.get('weightPriorKg', {}); lo, hi = prior.get('lower'), prior.get('upper')
            if package_mass is not None:
                lower += package_mass; upper += package_mass; mass_basis.add('vision_read_package_weight')
            elif lo is not None and hi is not None:
                lower += max(product_mass, lo * q); upper += max(product_mass, hi * q)
                mass_basis.add('vision_inferred_packed_weight')
            else:
                lower += product_mass; complete = False
            if product_mass:
                mass_basis.add('vision_read_product_mass_lower_bound')
            if q != 1 or len(attributes) != 1:
                reasons.append('Quantity units and joint packing are unverified.')
        if not complete:
            upper = None
    known = upper is not None
    weight_grade = band((lower + upper) / 2, policy['weightBands']) if known else 'unknown'
    candidates = weight_candidates(lower, upper, policy) if lower or known else ['unknown']
    if weight_grade not in candidates:
        candidates.append(weight_grade)
    weight = {'grade': weight_grade, 'candidates': candidates, 'rangeKg': [lower or None, upper],
              'basis': sorted(mass_basis) or ['unknown'], 'independentlyVerified': False,
              'calibratedWeightInterval': False}
    if 'reported_packed_weight' not in mass_basis and 'vision_read_package_weight' not in mass_basis:
        reasons.append('Packed weight is inferred or unknown; this is not a calibrated weight interval.')
    checks = policy['freightChecks']; hub = parcel.get('hub'); thresholds = list(checks['edgeSumAtLeastCm'].values())
    sum_min = checks['edgeSumAtLeastCm'].get(hub, min(thresholds)); sum_max = checks['edgeSumAtLeastCm'].get(hub, max(thresholds))
    definite = bool(lower >= checks['weightAtLeastKg'] or dims and (max(dims.values()) >= checks['longestSideAtLeastCm'] or edge_sum >= sum_max))
    possible = definite or upper is None or upper >= checks['weightAtLeastKg'] or not dims or edge_sum >= sum_min
    handling = {'thresholdsExceeded': definite, 'freightPossible': bool(possible), 'hub': hub,
                'assessmentBasis': 'reported-or-photo-derived-values; not an independently verified dispatch decision',
                'otherFreightReasonsNotAssessed': True}
    if possible:
        reasons.append('Freight charges may apply; separate freight is outside the recorded-fee target.')
    primary = size_grade + '|' + weight_grade
    routes = [s + '|' + w for s, w in itertools.product(size['candidates'], weight['candidates'])]
    return {'primary': primary, 'candidates': routes, 'volume': size, 'weight': weight,
            'visualScale': [a.get('sizeClass', 'unknown') for a in attributes],
            'handling': handling, 'requiresReview': bool(reasons), 'reviewReasons': sorted(set(reasons))}


def reference_physical_route(row, attributes, policy):
    # Outcome weights are training labels only. Validation/test queries use physical_route without them.
    measured = row.get('physicalLabels', {}).get('recordedWeightKg')
    parcel = {'weightKg': measured} if isinstance(measured, (float, int)) and not isinstance(measured, bool) and np.isfinite(measured) and measured > 0 else None
    return physical_route(row, attributes, policy, parcel)


def reference_pool(candidate, reference_keys, groups, policy):
    size, weight = candidate.split('|')
    parts = np.array([key.split('|') for key in reference_keys])
    masks = []
    if size != 'unknown' and weight != 'unknown':
        masks.append(('joint', (parts[:, 0] == size) & (parts[:, 1] == weight)))
    if weight != 'unknown':
        masks.append(('weight-only', parts[:, 1] == weight))
    if size != 'unknown':
        masks.append(('size-only', parts[:, 0] == size))
    for name, mask in masks:
        count = len(np.unique(groups[mask]))
        if count >= policy['minimumTrainingGroups']:
            return mask, {'referencePool': name, 'trainingGroups': count}
    return np.ones(len(groups), dtype=bool), {'referencePool': 'shared-fallback', 'trainingGroups': len(np.unique(groups))}


def physical_raw(query, reference, labels, groups, k, image_weight, coverage, routes, reference_keys, predict_raw, policy):
    output = []; details = []
    for index, route in enumerate(routes):
        one = tuple(f[index:index + 1] for f in query); raw = {}; pools = {}
        for key in route['candidates']:
            mask, pools[key] = reference_pool(key, reference_keys, groups, policy)
            raw[key] = predict_raw(one, tuple(f[mask] for f in reference), labels[mask], groups[mask], k, image_weight, coverage)[0]
        point = raw[route['primary']][0]; lo = min(r[1] for r in raw.values()); hi = max(r[2] for r in raw.values())
        output.append([point, lo, hi, max(1000., (hi - lo) / 2)]); details.append(pools)
    return np.array(output), details


def fit_calibration(labels, raw, groups, routes, coverage, policy, calibration_entry, radius, group_scores):
    global_entry = calibration_entry(labels, raw, groups, coverage, radius, group_scores)
    keys = np.array([r['primary'] for r in routes]); local = {}
    for key in np.unique(keys):
        mask = keys == key; count = len(np.unique(groups[mask]))
        enough = count >= policy['minimumCalibrationGroups']
        local[key] = {'groups': count, 'mode': 'predicted-grade-conditional' if enough else 'global-fallback',
                      'entry': calibration_entry(labels[mask], raw[mask], groups[mask], coverage, radius, group_scores) if enough else global_entry}
    return {'global': global_entry, 'byPredictedGrade': local}


def physical_bands(raw, routes, calibration, coverage, guarded_intervals):
    bands = []; modes = []
    for row, route in zip(raw, routes):
        local = calibration[str(coverage)]['byPredictedGrade'].get(route['primary'])
        mode = local['mode'] if local else 'global-fallback'
        entry = local['entry'] if local else calibration[str(coverage)]['global']
        bands.append(guarded_intervals(np.array([row]), entry['relative'], entry['absoluteKrw'])[0]); modes.append(mode)
    return bands, modes


def price_bands(labels, groups, reference_keys, weighted_quantile):
    result = {}
    for key in np.unique(reference_keys):
        mask = reference_keys == key; g = groups[mask]; y = labels[mask]
        weights = np.array([1 / sum(g == group) for group in g])
        result[key] = {'trainingGroups': len(np.unique(g)), 'trainingRecords': len(y),
                       'observedTrainingBandKrw': [weighted_quantile(y, weights, .1), weighted_quantile(y, weights, .9)]}
    return result
