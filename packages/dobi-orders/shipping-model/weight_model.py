"""Offline-trained, grouped split-conformal prediction intervals for recorded shipment weight."""
import argparse
import base64
import collections
import json
import math
import os
from pathlib import Path
import resource
import shutil
import sys
import time
from model import Encoder, digest, feature_matrix, image_bytes, predict_values, product_groups, row_features, split_groups, undersample
import numpy as np

LEVELS = (.8, .9)
LIMITATIONS = [
    'Recorded shipment Weight is interpreted as kg from provider policy; scale-measured versus billable weight is not independently verified.',
    'Single-item shipment total including the supplied quantity; not per-unit product mass. Mixed-item shipments are unsupported.',
    '80%/90% are marginal coverage targets under exchangeable product groups, not per-item confidence guarantees.',
    'Customs titles and HS categories are coarse; unseen products, packaging and bulky goods can have wide or unreliable intervals.',
    'No shipment dates or independent future shipments are available for temporal validation.',
]


def conformal_radius(scores, coverage):
    if coverage not in LEVELS or any(not math.isfinite(s) or s < 0 for s in scores):
        raise ValueError('Invalid calibration')
    rank = math.ceil((len(scores)+1)*coverage)
    return float(sorted(scores)[rank-1]) if rank <= len(scores) else math.inf


def group_scores(actual, log_predictions, groups):
    # One score per independent product, never one vote per frequent shipment.
    errors = np.max(np.abs(np.log(actual)[None, :] - np.atleast_2d(log_predictions)), axis=0)
    return [float(errors[groups == g].max()) for g in np.unique(groups)]


def bounds(log_prediction, radius):
    if math.isinf(radius):
        return [0., None]
    if not math.isfinite(log_prediction) or not math.isfinite(radius) or radius < 0:
        raise ValueError('Invalid interval')
    return [math.floor(math.exp(log_prediction-radius)*100)/100,
            math.ceil(math.exp(log_prediction+radius)*100)/100]


def log_predict(query, reference, labels, weight, alpha, dual=None, neighbors=None):
    if neighbors is not None:
        return predict_values(query,reference,np.log(labels),neighbors,weight)[0], np.zeros(0)
    tx, qx = feature_matrix(reference, weight), feature_matrix(query, weight)
    target = np.log(labels.astype(np.float64)); mean = float(target.mean())
    if dual is None:
        kernel = np.einsum('ik,jk->ij',tx,tx,optimize=False).astype(np.float64)
        dual = np.linalg.solve(kernel+np.eye(len(labels))*alpha,target-mean)
    predicted = np.einsum('ij,j->i',np.einsum('ik,jk->ij',qx,tx,optimize=False),dual,optimize=False)+mean
    return np.clip(predicted,float(target.min()),float(target.max())), dual


def macro_log_error(actual, predicted, groups):
    errors = np.abs(np.log(actual)-predicted)
    return float(np.mean([errors[groups == g].mean() for g in np.unique(groups)]))


def coverage_summary(actual, predicted, groups, radius):
    intervals = [bounds(p,radius) for p in predicted]
    covered = np.array([lo <= y and (hi is None or y <= hi) for y,(lo,hi) in zip(actual,intervals)])
    group_covered = np.array([covered[groups == g].all() for g in np.unique(groups)])
    n = len(group_covered); p = float(group_covered.mean()); z = 1.96
    center = (p+z*z/(2*n))/(1+z*z/n)
    half = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
    widths = [hi-lo for lo,hi in intervals if hi is not None]
    return {'records':len(actual),'productGroups':n,'recordCoverage':round(float(covered.mean()),4),
            'wholeProductCoverage':round(p,4),'wholeProductCoverageWilson95':[round(center-half,4),round(center+half,4)],
            'meanWidthKg':round(float(np.mean(widths)),3) if widths else None,
            'medianWidthKg':round(float(np.median(widths)),3) if widths else None,
            'p90WidthKg':round(float(np.quantile(widths,.9)),3) if widths else None,
            'unbounded':math.isinf(radius)}


def cached_images(records, cache):
    vectors, content, phashes = {}, {}, {}
    urls = {i.get('imageUrl','') for r in records for i in r['items']} - {''}
    for url in sorted(urls):
        file = cache/(digest(url.encode())+'.npz')
        if not file.exists():
            continue
        with np.load(file,allow_pickle=False) as saved:
            vector = saved['vector']
            if vector.shape != (1000,) or not np.isfinite(vector).all():
                raise ValueError('Invalid cached image descriptor')
            vectors[url], content[url] = vector, str(saved['content'])
            phashes[url] = int(str(saved['phash'])) if str(saved['phash']) else None
    return vectors, content, phashes, {'requested':len(urls),'usable':len(vectors),'mode':'existing-cache-only-no-network'}


def train(args):
    started = time.monotonic(); directory = Path(args.model_dir)
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    source = json.loads(Path(args.data).read_text()); records = source['records']
    if source['target'] != 'recorded_single_item_shipment_weight_kg' or not records:
        raise ValueError('An explicit weight-label export is required')
    for r in records:
        if not math.isfinite(r['weightKg']) or r['weightKg'] <= 0 or len(r['items']) != 1:
            raise ValueError('Positive single-item shipment labels are required')
        q = r['items'][0]['quantity']
        if isinstance(q,bool) or not isinstance(q,int) or not 1 <= q <= 100000:
            raise ValueError('Whole-unit quantities are required')
    encoder_source = json.loads(Path(__file__).with_name('encoder.json').read_text())
    if digest(Path(args.encoder).read_bytes()) != encoder_source['sha256']:
        raise ValueError('Encoder checksum mismatch')
    cache_manifest = json.loads((Path(args.image_cache).parent/'manifest.json').read_text())
    if cache_manifest.get('encoderSha256') != encoder_source['sha256']:
        raise ValueError('Image cache belongs to a different encoder')
    if Path(args.encoder).resolve() != (directory/'encoder.onnx').resolve():
        shutil.copyfile(args.encoder,directory/'encoder.onnx')
    vectors, content, phashes, images = cached_images(records,Path(args.image_cache))
    groups = product_groups(records,content,phashes)
    train_all, validation, calibration, test = split_groups(groups)
    split_sets = [set(groups[ix]) for ix in [train_all,validation,calibration,test]]
    overlap = sum(len(a & b) for i,a in enumerate(split_sets) for b in split_sets[i+1:])
    if overlap:
        raise ValueError('Product identities overlap data splits')
    values = [row_features(r,vectors) for r in records]
    features = tuple(np.array([v[i] for v in values],dtype=np.float32) for i in range(4))
    labels = np.array([r['weightKg'] for r in records],dtype=np.float64)
    selected = undersample(train_all,groups,features[3]); take = lambda ix: tuple(f[ix] for f in features)
    reference = take(selected); settings = []
    for weight in [0., .35, .60]:
        for alpha in [.03, .3, 3., 30.]:
            p,dual = log_predict(take(validation),reference,labels[selected],weight,alpha)
            settings.append((macro_log_error(labels[validation],p,groups[validation]),weight,alpha,0,dual))
        for k in [1,3,7]:
            p,dual = log_predict(take(validation),reference,labels[selected],weight,0.,neighbors=k)
            settings.append((macro_log_error(labels[validation],p,groups[validation]),weight,0.,k,dual))
    # An image model and a title/category control are selected using validation only.
    chosen = min((s for s in settings if s[1]>0),key=lambda s:s[:4])
    control = min((s for s in settings if s[1]==0),key=lambda s:s[:4])
    _,weight,alpha,k,dual = chosen
    predict = lambda f: log_predict(f,reference,labels[selected],weight,alpha,dual,k or None)[0]
    missing = lambda f: (np.zeros_like(f[0]),*f[1:])
    calibration_predictions = np.array([predict(take(calibration)),predict(missing(take(calibration)))])
    scores = group_scores(labels[calibration],calibration_predictions,groups[calibration])
    radii = {str(level):conformal_radius(scores,level) for level in LEVELS}
    test_predictions = predict(take(test)); test_missing = predict(missing(take(test)))
    base_log = math.log(float(np.median(labels[train_all])))
    base_scores = group_scores(labels[calibration],np.full(len(calibration),base_log),groups[calibration])
    evaluate = lambda ix,p,r: coverage_summary(labels[ix],p,groups[ix],r)
    evaluation = {level:{'multimodal':evaluate(test,test_predictions,radius),
                         'withoutImage':evaluate(test,test_missing,radius),
                         'medianBaseline':evaluate(test,np.full(len(test),base_log),conformal_radius(base_scores,float(level)))} for level,radius in radii.items()}
    slices = {'quantity1':test[features[3][test]==1],'quantityMultiple':test[features[3][test]>1],'above5Kg':test[labels[test]>5]}
    for name,ix in slices.items():
        if len(ix):
            evaluation[name] = {level:evaluate(ix,predict(take(ix)),radius) for level,radius in radii.items()}
    model_file = directory/'model.npz'
    np.savez_compressed(model_file,images=reference[0],titles=reference[1],categories=reference[2],quantities=reference[3],labels=labels[selected],dual=dual)
    report = {'schemaVersion':1,'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'pythonExecutable':sys.executable,
              'model':'frozen-MobileNetV2+title+HS+quantity+group-conformal','target':source['target'],'unit':'kg','categorySystem':'HS',
              'source':source['sourceSummary'],'images':images,'imageRecordCoverage':round(float((np.linalg.norm(features[0],axis=1)>0).mean()),4),
              'seed':42,'groupOverlap':overlap,'settings':{'imageWeight':weight,'alpha':alpha,'algorithm':'neighbors' if k else 'ridge','neighbors':k or None},
              'undersampling':{'capPerProduct':12,'trainingBefore':len(train_all),'trainingAfter':len(selected),'largestGroupBefore':max(collections.Counter(groups[train_all]).values()),'largestGroupAfter':max(collections.Counter(groups[selected]).values())},
              'splits':{name:{'records':len(ix),'groups':len(np.unique(groups[ix]))} for name,ix in zip(['training','validation','calibration','test'],[train_all,validation,calibration,test])},
              'coverageLevels':list(LEVELS),'calibration':{'method':'max-absolute-log-residual-per-product-over-present-and-missing-images','groups':len(scores),'logRadii':{k:v if math.isfinite(v) else None for k,v in radii.items()}},
              'evaluation':evaluation,'validationMacroLogError':round(chosen[0],4),'controlValidationMacroLogError':round(control[0],4),
              'testMacroLogError':round(macro_log_error(labels[test],test_predictions,groups[test]),4),
              'controlTestMacroLogError':round(macro_log_error(labels[test],log_predict(take(test),reference,labels[selected],0.,control[2],control[4],control[3] or None)[0],groups[test]),4),
              'quantityRange':[int(features[3].min()),int(features[3].max())],
              'categoryCodes':sorted({records[i]['category'] for i in selected} - {'unknown'}),
              'encoderSha256':encoder_source['sha256'],'encoderSource':encoder_source,'artifactSha256':digest(model_file.read_bytes()),
              'readiness':'experimental-prediction-interval-only','limitations':LIMITATIONS,
              'seconds':round(time.monotonic()-started,2),'peakMemoryMb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024*1024 if sys.platform=='darwin' else 1024),1)}
    for name in ['model.npz','encoder.onnx']:
        os.chmod(directory/name,0o600)
    temp = directory/'manifest.next.json'; temp.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False));os.chmod(temp,0o600);temp.replace(directory/'manifest.json')
    print(json.dumps(report,ensure_ascii=False,allow_nan=False))


def estimate(directory, request):
    manifest = json.loads((directory/'manifest.json').read_text()); items = request.get('items')
    if not isinstance(items,list) or len(items) != 1:
        raise ValueError('One product line is supported; mixed-item shipments are not')
    item = items[0]; title = item.get('title'); quantity = item.get('quantity',1); category = request.get('category','unknown')
    if not isinstance(title,str) or not 1 <= len(title.strip()) <= 500 or isinstance(quantity,bool) or not isinstance(quantity,int) or not 1 <= quantity <= 100000:
        raise ValueError('Check product title and whole-unit quantity')
    if not isinstance(category,str) or len(category)>200:
        raise ValueError('Check HS category')
    warnings = list(manifest['limitations']); vectors = {}
    if item.get('imageBase64'):
        data = base64.b64decode(item['imageBase64'],validate=True)
        if len(data)>5*1024*1024:
            raise ValueError('Image is too large')
        if digest((directory/'encoder.onnx').read_bytes()) != manifest['encoderSha256']:
            raise ValueError('Encoder checksum mismatch')
        vectors['input'] = Encoder(directory/'encoder.onnx').encode(image_bytes(data))
    if not vectors:
        warnings.append('No image supplied; the same bands were calibrated against missing-image representations too.')
    if category not in manifest['categoryCodes']:
        warnings.append('Unseen HS category: the historical coverage target may not transfer.')
    supported = manifest['quantityRange'][0] <= quantity <= manifest['quantityRange'][1]
    if not supported:
        warnings.append('Quantity is outside observed support; no finite weight range is returned.')
    feature = row_features({'category':category,'items':[{'title':title,'quantity':quantity,'imageUrl':'input'}]},vectors)
    if digest((directory/'model.npz').read_bytes()) != manifest['artifactSha256']:
        raise ValueError('Model checksum mismatch')
    with np.load(directory/'model.npz',allow_pickle=False) as saved:
        reference = tuple(saved[k] for k in ['images','titles','categories','quantities'])
        predicted,_ = log_predict(tuple(np.array([v],dtype=np.float32) for v in feature),reference,saved['labels'],manifest['settings']['imageWeight'],manifest['settings']['alpha'],saved['dual'],manifest['settings'].get('neighbors'))
    intervals = []
    for level in LEVELS:
        radius = manifest['calibration']['logRadii'][str(level)]
        lo,hi = bounds(float(predicted[0]),radius if supported and radius is not None else math.inf)
        intervals.append({'coverageTarget':level,'lowerKg':lo,'upperKg':hi,'unbounded':hi is None})
    return {'unit':'kg','target':manifest['target'],'intervalType':'prediction-interval-not-parameter-confidence','intervals':intervals,
            'quantity':quantity,'withinQuantitySupport':supported,'imageFeaturesUsed':len(vectors),'categorySystem':'HS',
            'reliability':'experimental','readiness':manifest['readiness'],'calibrationGroups':manifest['calibration']['groups'],
            'modelCreatedAt':manifest['createdAt'],'warnings':warnings}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest='command',required=True)
    training = sub.add_parser('train')
    for flag in ['data','model-dir','encoder','image-cache']:
        training.add_argument('--'+flag,required=True)
    prediction = sub.add_parser('predict'); prediction.add_argument('--model-dir',required=True)
    args = parser.parse_args()
    try:
        if args.command == 'train':
            train(args)
        else:
            print(json.dumps(estimate(Path(args.model_dir),json.loads(sys.stdin.buffer.read(12*1024*1024))),ensure_ascii=False,allow_nan=False))
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'message':'Weight model operation failed; check input and artifacts.'}),file=sys.stderr);sys.exit(1)
