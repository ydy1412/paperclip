"""Versioned routing heuristics, not a trained package-size classifier."""
import math
import numpy as np

CLASSES = ('small', 'medium', 'large', 'special')
LABELS = ('소형', '중형', '대형', '특수·판단 보류')
DEFAULT_POLICY = {
    'version': 'inferred-shipment-size-1',
    'visualCandidates': {
        'handheld': ['small'], 'tabletop': ['medium', 'small'],
        'floor_standing': ['large', 'medium'], 'large_furniture': ['large'],
        'unknown': ['special'],
    },
    # Engineering routing limits, not any carrier's tariff or measured labels.
    'massLowerBoundsKg': [3, 15, 50],
    'packageLimitsCm': [[35, 70], [70, 140], [120, 240]],
    'minimumTrainingGroups': 8,
    'minimumCalibrationGroups': 10,
}


def mass_class(kg, policy):
    return sum(kg >= limit for limit in policy['massLowerBoundsKg'])


def route_size(row, attributes, policy=DEFAULT_POLICY):
    """Conservative possible shipment sizes from photo evidence and priors.

    These candidates and the primary route are not calibrated probabilities.
    Product dimensions must not be presented as packed dimensions.
    """
    if len(row['items']) != len(attributes) or not attributes:
        raise ValueError('Each item needs size evidence')
    shipment = {0}; primary = 0; reasons = set(); bases = set()
    for item, attribute in zip(row['items'], attributes):
        visual = attribute.get('sizeClass', 'unknown')
        names = policy['visualCandidates'].get(visual, ['special'])
        item_primary = CLASSES.index(names[0]); possible = {CLASSES.index(n) for n in names}
        bases.add('visual_inference')
        package = {}; measured_mass = 0
        quantity = item.get('quantity', 1)
        if quantity != 1:
            reasons.add('Quantity units and joint packing are unverified.')
        for evidence in attribute.get('evidence', []):
            kind, unit, value = evidence['kind'], evidence['unit'], evidence['value']
            if kind in {'length', 'width', 'height'} and evidence['scope'] == 'package' and unit in {'mm', 'cm', 'm'}:
                package[kind] = max(package.get(kind, 0), value * {'mm': .1, 'cm': 1, 'm': 100}[unit])
            if kind == 'mass' and unit in {'g', 'kg'} and evidence['scope'] in {'product', 'package'}:
                measured_mass = max(measured_mass, value * (.001 if unit == 'g' else 1) * quantity)
        if len(package) == 3 and quantity == 1:
            longest, perimeter = max(package.values()), sum(package.values())
            item_primary = next((i for i, (length, total) in enumerate(policy['packageLimitsCm']) if longest <= length and perimeter <= total), 3)
            possible = {item_primary}; bases.add('vision_read_package_dimensions')
        else:
            reasons.add('Packed dimensions are unavailable; size is inferred.')
        if measured_mass:
            minimum = mass_class(measured_mass, policy)
            item_primary = max(item_primary, minimum); possible = {max(i, minimum) for i in possible}
            bases.add('vision_read_mass')
        prior = attribute.get('weightPriorKg', {})
        lo, hi = prior.get('lower'), prior.get('upper')
        if lo is not None and hi is not None:
            # An inferred mass can widen candidates, but cannot become a measured label.
            upper = mass_class(hi * quantity, policy)
            if upper > min(possible):
                possible.update(range(min(possible), upper + 1))
                reasons.add('Inferred weight spans multiple routing classes.')
        if 'special' in names and len(package) != 3:
            reasons.add('The product scale is unknown.')
        primary = max(primary, item_primary)
        shipment = {max(a, b) for a in shipment for b in possible}
    if 3 in shipment:
        reasons.add('Special or unknown size needs a manual quote.')
    if len(shipment) > 1:
        reasons.add('More than one size is plausible; use all candidate ranges.')
    return {'primary': CLASSES[primary], 'label': LABELS[primary],
            'candidates': [CLASSES[i] for i in sorted(shipment)],
            'basis': sorted(bases), 'measuredPackageClass': False,
            'requiresReview': bool(reasons), 'reviewReasons': sorted(reasons)}


def routed_raw(query, reference, labels, groups, k, image_weight, coverage,
               query_routes, reference_sizes, predict_raw, policy=DEFAULT_POLICY):
    rows = []; details = []
    for index, route in enumerate(query_routes):
        one = tuple(f[index:index + 1] for f in query); candidates = []; pools = {}
        for size in route['candidates']:
            mask = reference_sizes == size
            count = len(np.unique(groups[mask]))
            fallback = size == 'special' or count < policy['minimumTrainingGroups']
            selected = np.ones(len(groups), dtype=bool) if fallback else mask
            raw = predict_raw(one, tuple(f[selected] for f in reference), labels[selected], groups[selected], k, image_weight, coverage)[0]
            candidates.append((size, raw))
            pools[size] = {'trainingGroups': count, 'referencePool': 'shared-fallback' if fallback else 'same-size'}
        primary = next(r for size, r in candidates if size == route['primary'])
        lower = min(r[1] for _, r in candidates); upper = max(r[2] for _, r in candidates)
        rows.append([primary[0], lower, upper, max(1000., (upper - lower) / 2)])
        details.append(pools)
    return np.array(rows), details


def descriptive_price_bands(labels, groups, sizes, weighted_quantile):
    result = {}
    for size in CLASSES:
        mask = sizes == size; y = labels[mask]; g = groups[mask]
        if not len(y):
            result[size] = {'trainingGroups': 0, 'trainingRecords': 0, 'observedTrainingBandKrw': None}
            continue
        weights = np.array([1 / sum(g == group) for group in g])
        result[size] = {'trainingGroups': len(np.unique(g)), 'trainingRecords': len(y),
                        'observedTrainingBandKrw': [weighted_quantile(y, weights, .1), weighted_quantile(y, weights, .9)],
                        'medianKrw': weighted_quantile(y, weights, .5)}
    return result


def calibration_entry(labels, raw, groups, coverage, radius, group_scores):
    errors = np.abs(labels - raw[:, 0])
    relative = radius(group_scores(labels, raw, groups), coverage)
    absolute = radius([float(errors[groups == g].max()) for g in np.unique(groups)], coverage)
    return {'relative': relative if math.isfinite(relative) else None,
            'absoluteKrw': absolute if math.isfinite(absolute) else None}


def calibrated_bands(raw, routes, calibration, coverage, guarded_intervals):
    bands = []; modes = []
    for r, route in zip(raw, routes):
        entries = []; used = []
        for size in route['candidates']:
            local = calibration['bySize'][size]
            entry = local['levels'][str(coverage)] if local['mode'] == 'size-conditional' else calibration['global'][str(coverage)]
            entries.append(entry); used.append(local['mode'])
        if 'special' in route['candidates']:
            bands.append([0, None]); modes.append('manual-review'); continue
        # Use the largest candidate residual guard; never discard an adjacent size.
        relative = max(e['relative'] for e in entries) if all(e['relative'] is not None for e in entries) else None
        absolute = max(e['absoluteKrw'] for e in entries) if all(e['absoluteKrw'] is not None for e in entries) else None
        bands.append(guarded_intervals(np.array([r]), relative, absolute)[0])
        modes.append('global-fallback' if 'global-fallback' in used else 'size-conditional')
    return bands, modes
