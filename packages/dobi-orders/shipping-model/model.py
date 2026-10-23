"""CPU-only, shipment-level image/title/HS nearest-neighbour fee estimator."""
import argparse
import base64
import collections
import hashlib
import io
import json
import math
import os
from pathlib import Path
import resource
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
import numpy as np
from PIL import Image, ImageOps

SURCHARGE = 5000
HOSTS = {'img.alicdn.com', 'zh8g.com', 'www.zh8g.com'}
Image.MAX_IMAGE_PIXELS = 16_000_000


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value)).lower().split())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unit(vector):
    return vector / max(float(np.linalg.norm(vector)), 1e-9)


def text_vector(text, size=256):
    text = normalized(text)
    tokens = text.split() + [text[i:i+3] for i in range(max(0, len(text)-2))]
    vector = np.zeros(size, dtype=np.float32)
    for token in tokens:
        vector[int(digest(token.encode())[:8], 16) % size] += 1
    return unit(vector)


def category_vector(category):
    category = normalized(category)
    tokens = [category[:n] for n in [2, 4, 6]] if category.isdigit() else category.split()
    vector = np.zeros(96, dtype=np.float32)
    for token in tokens:
        vector[int(digest(('hs:'+token).encode())[:8], 16) % 96] += 1
    return unit(vector)


def image_bytes(data):
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > 16_000_000:
            raise ValueError('Image is too large')
        return ImageOps.exif_transpose(image).convert('RGB')


def perceptual_hash(image):
    gray = np.asarray(image.resize((9, 8)).convert('L'))
    if float(gray.std()) < 8:
        return None
    return int(''.join('1' if b else '0' for b in (gray[:, 1:] > gray[:, :-1]).flat), 2)


class Encoder:
    def __init__(self, model):
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        self.session = ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
        self.input = self.session.get_inputs()[0].name

    def encode(self, image):
        w, h = image.size
        scale = 256 / min(w, h)
        image = image.resize((round(w*scale), round(h*scale)), Image.Resampling.BILINEAR)
        x, y = (image.width-224)//2, (image.height-224)//2
        tensor = np.asarray(image.crop((x, y, x+224, y+224)), dtype=np.float32) / 255
        tensor = ((tensor - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)).transpose(2, 0, 1)[None]
        result = self.session.run(None, {self.input: tensor})[0].reshape(-1)
        if result.size != 1000 or not np.isfinite(result).all():
            raise ValueError('Unexpected encoder output')
        return unit(result.astype(np.float32))


def allowed_url(url):
    parsed = urllib.parse.urlsplit(url)
    return parsed.scheme in {'http', 'https'} and parsed.hostname in HOSTS and parsed.port in {None, 80, 443} and not parsed.username and not parsed.password


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError('Image redirect host is not allowed')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_images(records, directory, encoder):
    cache = directory / 'image-cache'
    cache.mkdir(exist_ok=True, mode=0o700)
    opener = urllib.request.build_opener(SafeRedirect())
    urls = sorted({item.get('imageUrl', '') for row in records for item in row['items']} - {''})
    features, content, hashes = {}, {}, {}
    denied, failures = set(), collections.Counter()
    failure_file = cache/'failures.json'
    failed = json.loads(failure_file.read_text()) if failure_file.exists() else {}
    def failed_url(key, reason):
        failed[key] = {'reason':reason,'retryAfter':time.time()+86400}
        temporary = cache/'failures.next.json'
        temporary.write_text(json.dumps(failed));os.chmod(temporary,0o600);temporary.replace(failure_file)
    for index, url in enumerate(urls):
        key = digest(url.encode())
        file = cache / (key+'.npz')
        try:
            if file.exists():
                saved = np.load(file, allow_pickle=False)
                features[url], content[url] = saved['vector'], str(saved['content'])
                hashes[url] = int(str(saved['phash'])) if str(saved['phash']) else None
                continue
            if failed.get(key,{}).get('retryAfter',0)>time.time():
                failures['cached_'+failed[key]['reason']] += 1
                continue
            host = urllib.parse.urlsplit(url).hostname
            if not allowed_url(url) or host in denied:
                failures['not_allowed_or_denied'] += 1
                continue
            try:
                with opener.open(urllib.request.Request(url, headers={'User-Agent':'Dovix-Product-Image/1.0'}), timeout=4) as response:
                    data = response.read(5*1024*1024+1)
            except urllib.error.HTTPError as error:
                if error.code in {401, 403, 429}:
                    denied.add(host)
                failures['http_'+str(error.code)] += 1
                failed_url(key,'http_'+str(error.code))
                continue
            if len(data) > 5*1024*1024:
                raise ValueError('Image is too large')
            image = image_bytes(data)
            vector, body_hash, phash = encoder.encode(image), digest(data), perceptual_hash(image)
            features[url], content[url], hashes[url] = vector, body_hash, phash
            temporary=cache/(key+'.next.npz')
            np.savez_compressed(temporary, vector=vector, content=body_hash, phash=str(phash) if phash is not None else '')
            temporary.replace(file)
            os.chmod(file, 0o600)
            time.sleep(.15)
        except Exception as error:
            failures[type(error).__name__] += 1
            failed_url(key,type(error).__name__)
        finally:
            if (index+1) % 25 == 0:
                print(json.dumps({'imagesChecked':index+1, 'imagesTotal':len(urls), 'usableImages':len(features), 'failures':dict(failures)}), file=sys.stderr, flush=True)
    return features, content, hashes, {'requested':len(urls), 'usable':len(features), 'failures':dict(failures), 'deniedHosts':sorted(denied)}


def product_groups(records, content, phashes):
    parent = list(range(len(records)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(a, b):
        parent[root(a)] = root(b)
    owners = {}
    phash_owners = []
    for index, row in enumerate(records):
        if row.get('productKey'):
            key='product:'+row['productKey']
            if key in owners:
                union(index,owners[key])
            owners[key]=index
        for item in row['items']:
            url = item.get('imageUrl', '')
            parsed = urllib.parse.urlsplit(url)
            identity = parsed.hostname+parsed.path if parsed.hostname else row.get('productKey') or normalized(item['title'])+'|'+row['category']
            keys = ['url:'+identity]
            if url in content:
                keys.append('bytes:'+content[url])
            for key in keys:
                if key in owners:
                    union(index, owners[key])
                owners[key] = index
            phash = phashes.get(url)
            if phash is not None:
                for previous, owner in phash_owners:
                    if (phash ^ previous).bit_count() <= 3:
                        union(index, owner)
                phash_owners.append((phash, index))
    return np.array([root(i) for i in range(len(records))])


def split_groups(groups, seed=42):
    unique = np.unique(groups)
    if len(unique) < 20:
        raise ValueError('At least 20 independent product groups are required')
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    n = max(2, len(unique)//10)
    buckets = [unique[:-3*n], unique[-3*n:-2*n], unique[-2*n:-n], unique[-n:]]
    return [np.flatnonzero(np.isin(groups, group)) for group in buckets]


def undersample(indices, groups, quantity, cap=12, seed=42):
    rng = np.random.default_rng(seed)
    selected = []
    for group in np.unique(groups[indices]):
        buckets = collections.defaultdict(list)
        for index in indices[groups[indices] == group]:
            buckets[min(4, int(math.log2(max(1, quantity[index]))))].append(int(index))
        for bucket in buckets.values():
            rng.shuffle(bucket)
        picked = []
        while len(picked) < cap and any(buckets.values()):
            for key in sorted(buckets):
                if buckets[key] and len(picked) < cap:
                    picked.append(buckets[key].pop())
        selected.extend(picked)
    return np.array(selected, dtype=int)


def row_features(row, vectors):
    total = sum(item.get('quantity', 1) for item in row['items'])
    available = [vectors[i['imageUrl']] for i in row['items'] if i.get('imageUrl') in vectors]
    image = unit(np.mean(available, axis=0)) if available else np.zeros(1000, dtype=np.float32)
    return image, text_vector(' '.join(i['title'] for i in row['items'])), category_vector(row['category']), total


def predict_values(query, reference, labels, k, image_weight):
    qi, qt, qc, qq = query
    ri, rt, rc, rq = reference
    predictions, distances = [], []
    for i in range(len(qq)):
        # Explicit reduction avoids spurious Accelerate floating-point status flags on macOS.
        cosine = lambda matrix, vector: np.einsum('ij,j->i',matrix,vector,optimize=False)
        distance = image_weight*(1-cosine(ri,qi[i])) + .25*(1-cosine(rt,qt[i])) + (.75-image_weight)*(1-cosine(rc,qc[i]))
        distance += .2*np.minimum(np.abs(np.log1p(rq)-np.log1p(qq[i])), 3)
        if not np.isfinite(distance).all():
            raise ValueError('Non-finite model features')
        neighbors = np.argsort(distance, kind='stable')[:k]
        costs = labels[neighbors]
        weights = 1/np.maximum(distance[neighbors]+.05, .01)**2
        order = np.argsort(costs, kind='stable')
        middle = np.searchsorted(np.cumsum(weights[order]), weights.sum()/2)
        predictions.append(float(costs[order[middle]]))
        distances.append(float(distance[neighbors[0]]))
    return np.array(predictions), np.array(distances)


def ridge_values(query, reference, labels, image_weight, alpha, dual=None):
    def matrix(features):
        image, title, category, quantity = features
        return np.concatenate([image*math.sqrt(image_weight),title*.5,category*math.sqrt(.75-image_weight),np.log1p(quantity)[:,None]*.2],axis=1)
    train_x, query_x = matrix(reference), matrix(query)
    target = np.log1p(labels.astype(np.float64))
    mean = float(target.mean())
    if dual is None:
        kernel = np.einsum('ik,jk->ij',train_x,train_x,optimize=False).astype(np.float64)
        dual = np.linalg.solve(kernel+np.eye(len(labels))*alpha,target-mean)
    kernel = np.einsum('ik,jk->ij',query_x,train_x,optimize=False)
    predicted = np.expm1(np.clip(np.einsum('ij,j->i',kernel,dual,optimize=False)+mean,float(target.min()),float(target.max())))
    if not np.isfinite(predicted).all():
        raise ValueError('Non-finite regression output')
    return predicted, dual


def metrics(actual, predicted, groups):
    error = np.abs(actual-predicted)
    return {'maeKrw':round(float(error.mean()), 2), 'macroProductMaeKrw':round(float(np.mean([error[groups == g].mean() for g in np.unique(groups)])), 2), 'within1000':round(float((error<=1000).mean()), 4), 'records':len(actual), 'productGroups':len(np.unique(groups))}


def train(args):
    started = time.monotonic()
    directory = Path(args.model_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    source = json.loads(Path(args.data).read_text())
    records = source['records']
    if not records or any(not math.isfinite(r['shippingFee']) or r['shippingFee'] <= 0 or not r['items'] or any(not math.isfinite(i['quantity']) or not 1 <= i['quantity'] <= 100000 for i in r['items']) for r in records):
        raise ValueError('Positive finite fee labels are required')
    encoder_file = directory / 'encoder.onnx'
    if Path(args.encoder).resolve() != encoder_file.resolve():
        shutil.copyfile(args.encoder, encoder_file)
    encoder_source=json.loads(Path(__file__).with_name('encoder.json').read_text())
    if digest(encoder_file.read_bytes())!=encoder_source['sha256']:
        raise ValueError('The encoder does not match its pinned source')
    encoder = Encoder(encoder_file)
    vectors, content, phashes, images = fetch_images(records, directory, encoder)
    groups = product_groups(records, content, phashes)
    train_all, validation, calibration, test = split_groups(groups)
    values = [row_features(row, vectors) for row in records]
    features = tuple(np.array([row[i] for row in values], dtype=np.float32) for i in range(4))
    labels = np.array([r['shippingFee'] for r in records], dtype=np.float32)
    selected = undersample(train_all, groups, features[3])
    take = lambda indices: tuple(feature[indices] for feature in features)
    reference = take(selected)
    settings = []
    for weight in [0., .35, .60]:
        for k in [1, 3, 7]:
            predicted, _ = predict_values(take(validation), reference, labels[selected], k, weight)
            settings.append((metrics(labels[validation], predicted, groups[validation])['macroProductMaeKrw'], weight, k, 'neighbors', 0.))
        for alpha in [.03,.3,3.,30.]:
            predicted,_=ridge_values(take(validation),reference,labels[selected],weight,alpha)
            settings.append((metrics(labels[validation],predicted,groups[validation])['macroProductMaeKrw'],weight,1,'ridge',alpha))
    best = min(s for s in settings if s[1] > 0)
    text_best = min(s for s in settings if s[1] == 0)
    _, weight, k, algorithm, alpha = best
    dual=None
    if algorithm=='ridge':
        calibrated,dual=ridge_values(take(calibration),reference,labels[selected],weight,alpha)
    else:
        calibrated,_=predict_values(take(calibration),reference,labels[selected],k,weight)
    calibration_errors = np.abs(labels[calibration]-calibrated)
    group_errors = [calibration_errors[groups[calibration] == g].max() for g in np.unique(groups[calibration])]
    q = min(len(group_errors), math.ceil((len(group_errors)+1)*.9))
    radius = float(np.sort(group_errors)[q-1])
    # Independent calibration groups support narrower category-conditional bands.
    category_radii = {}
    for prefix in {records[i]['category'][:2] for i in calibration}:
        positions = np.array([j for j, i in enumerate(calibration) if records[i]['category'][:2] == prefix], dtype=int)
        category_groups = groups[calibration[positions]]
        scores = [calibration_errors[positions][category_groups == g].max() for g in np.unique(category_groups)]
        if len(scores) >= 10:
            category_radii[prefix] = float(np.sort(scores)[math.ceil((len(scores)+1)*.9)-1])
    if algorithm=='ridge':
        predicted,_=ridge_values(take(test),reference,labels[selected],weight,alpha,dual)
    else:
        predicted,_=predict_values(take(test),reference,labels[selected],k,weight)
    if text_best[3]=='ridge':
        text_predicted,_=ridge_values(take(test),reference,labels[selected],0.,text_best[4])
    else:
        text_predicted,_=predict_values(take(test),reference,labels[selected],text_best[2],0.)
    baseline = np.full(len(test), np.median(labels[train_all]))
    report = {'schemaVersion':1, 'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'pythonExecutable':sys.executable, 'model':'frozen-MobileNetV2+title+HS+quantity-weighted-neighbours', 'categorySystem':'HS', 'target':'recorded_shipping_fee_as_base', 'remoteSurchargeKrw':SURCHARGE, 'images':images, 'source':source['sourceSummary'], 'seed':42, 'undersampling':{'capPerProduct':12, 'trainingBefore':len(train_all), 'trainingAfter':len(selected), 'largestGroupBefore':max(collections.Counter(groups[train_all]).values()), 'largestGroupAfter':max(collections.Counter(groups[selected]).values())}, 'splits':{name:{'records':len(indices), 'groups':len(np.unique(groups[indices]))} for name, indices in zip(['training','validation','calibration','test'], [train_all,validation,calibration,test])}, 'groupOverlap':0, 'settings':{'neighbors':k,'imageWeight':weight}, 'evaluation':{'medianBaseline':metrics(labels[test],baseline,groups[test]), 'titleCategoryControl':metrics(labels[test],text_predicted,groups[test]), 'multimodal':metrics(labels[test],predicted,groups[test]), 'intervalCoverage':round(float((np.abs(labels[test]-predicted)<=radius).mean()),4)}, 'intervalRadiusKrw':radius, 'categoryCodes':sorted(set(r['category'] for r in records if r['category']!='unknown')), 'encoderSha256':digest(encoder_file.read_bytes()), 'seconds':round(time.monotonic()-started,2), 'peakMemoryMb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024*1024 if sys.platform=='darwin' else 1024),1), 'limitations':['Historical remote fees are not separately labeled; recorded fee is assumed base.', 'Source names are customs declarations; categories are HS, not marketplace category IDs.', 'No dates: this is an unseen-product split, not a future-time backtest.', 'Missing/rare images and categories reduce reliability.']}
    report['settings'].update(algorithm=algorithm,alpha=alpha)
    report['encoderSource']=encoder_source
    report['imageRecordCoverage']=round(float((np.linalg.norm(features[0],axis=1)>0).mean()),4)
    report['model']='frozen-MobileNetV2+title+HS+quantity-'+algorithm
    report['selection']='Validation macro-product MAE only; test labels do not select settings.'
    np.savez_compressed(directory/'model.npz', images=reference[0], titles=reference[1], categories=reference[2], quantities=reference[3], labels=labels[selected], dual=dual if dual is not None else np.zeros(0))
    for name in ['model.npz','encoder.onnx']:
        os.chmod(directory/name, 0o600)
    report['intervalRadiiByHs2'] = category_radii
    test_radii = np.array([category_radii.get(records[i]['category'][:2],radius) for i in test])
    report['evaluation']['intervalCoverage'] = round(float((np.abs(labels[test]-predicted)<=test_radii).mean()),4)
    report['sourceProductIdCoverage'] = sum(bool(row.get('productKey')) for row in records)/len(records)
    report['artifactSha256']=digest((directory/'model.npz').read_bytes())
    report['limitations'].append('Groups join source product IDs and observed image identities; records without either use a title/category fallback.')
    report['readiness'] = 'experimental-estimate-only'
    temp = directory/'manifest.next.json'
    temp.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    os.chmod(temp, 0o600)
    temp.replace(directory/'manifest.json')
    print(json.dumps(report, ensure_ascii=False))


def estimate(directory, request):
    manifest = json.loads((directory/'manifest.json').read_text())
    items = request.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 5:
        raise ValueError('One to five product items are required')
    vectors, warnings = {}, list(manifest['limitations'][:2])
    clean_items = []
    encoder = None
    for index, item in enumerate(items):
        title, quantity = item.get('title'), item.get('quantity',1)
        if not isinstance(title,str) or not 1 <= len(title.strip()) <= 500 or isinstance(quantity,bool) or not isinstance(quantity,(int,float)) or not math.isfinite(quantity) or not 1 <= quantity <= 100000:
            raise ValueError('Check product title and quantity')
        clean = {'title':title,'quantity':quantity,'imageUrl':str(index)}
        if item.get('imageBase64'):
            data = base64.b64decode(item['imageBase64'], validate=True)
            if len(data) > 5*1024*1024:
                raise ValueError('Image is too large')
            if encoder is None:
                if digest((directory/'encoder.onnx').read_bytes()) != manifest['encoderSha256']:
                    raise ValueError('Encoder checksum mismatch')
                encoder = Encoder(directory/'encoder.onnx')
            vectors[str(index)] = encoder.encode(image_bytes(data))
        clean_items.append(clean)
    category = request.get('category','unknown')
    if not isinstance(category,str) or len(category)>200:
        raise ValueError('Check HS category')
    remote = request.get('remoteArea')
    if remote is not None and not isinstance(remote,bool):
        raise ValueError('Remote-area flag must be boolean or unknown')
    if not vectors:
        warnings.append('No usable image supplied; image features are missing.')
    if category not in manifest['categoryCodes']:
        warnings.append('HS category was not present in training data.')
    if remote is None:
        warnings.append('Remote-area status is unknown; total remains conditional.')
    feature = row_features({'items':clean_items,'category':category},vectors)
    if manifest.get('artifactSha256') and digest((directory/'model.npz').read_bytes())!=manifest['artifactSha256']:
        raise ValueError('Model checksum mismatch')
    with np.load(directory/'model.npz',allow_pickle=False) as saved:
        ref = tuple(saved[k] for k in ['images','titles','categories','quantities'])
        query = tuple(np.array([v],dtype=np.float32) for v in feature)
        predicted, distance = predict_values(query,ref,saved['labels'],manifest['settings']['neighbors'],manifest['settings']['imageWeight'])
        if manifest['settings'].get('algorithm')=='ridge':
            predicted,_=ridge_values(query,ref,saved['labels'],manifest['settings']['imageWeight'],manifest['settings']['alpha'],saved['dual'])
    base = max(0,round(float(predicted[0])/100)*100)
    radius = math.ceil(manifest.get('intervalRadiiByHs2',{}).get(category[:2],manifest['intervalRadiusKrw'])/100)*100
    surcharge = SURCHARGE if remote is True else 0 if remote is False else None
    return {'baseFeeKrw':base, 'remoteSurchargeKrw':surcharge, 'totalFeeKrw':base+surcharge if surcharge is not None else None, 'ifRemoteTotalKrw':base+SURCHARGE, 'baseIntervalKrw':[max(0,base-radius),base+radius], 'totalIntervalKrw':[max(0,base-radius)+surcharge,base+radius+surcharge] if surcharge is not None else None, 'categorySystem':'HS', 'imageFeaturesUsed':len(vectors), 'nearestDistance':round(float(distance[0]),4), 'confidence':'low' if not vectors or category not in manifest['categoryCodes'] or distance[0]>.6 or radius>base*.5 else 'limited', 'readiness':'experimental-estimate-only', 'modelCreatedAt':manifest['createdAt'], 'warnings':warnings}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command',required=True)
    training = sub.add_parser('train')
    for flag in ['data','model-dir','encoder']:
        training.add_argument('--'+flag,required=True)
    prediction = sub.add_parser('predict')
    prediction.add_argument('--model-dir',required=True)
    args = parser.parse_args()
    try:
        if args.command == 'train':
            train(args)
        else:
            request = json.loads(sys.stdin.buffer.read(12*1024*1024))
            print(json.dumps(estimate(Path(args.model_dir),request),ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'message':'Shipping model operation failed; check input, artifacts and dependencies.'}),file=sys.stderr)
        sys.exit(1)
