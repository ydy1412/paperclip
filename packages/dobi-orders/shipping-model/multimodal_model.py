"""Vision-language attributes + group-balanced local fee prediction intervals."""
import argparse
import base64
import collections
import json
import math
import os
from pathlib import Path
import resource
import sys
import time
from model import category_vector, digest, image_bytes, metrics, product_groups, ridge_values, row_features, split_groups, text_vector, undersample, unit
from size_routing import DEFAULT_POLICY, calibrated_bands, calibration_entry, route_size, routed_raw
from physical_routing import load_policy, physical_route, reference_physical_route, physical_raw, fit_calibration, physical_bands, price_bands, weight_candidates
import numpy as np

VISION_MODEL = 'gpt-6-luna'
VISION_VERSION = 'shipping-physical-attributes-1'
LEVELS = (.8,.9)
FAMILIES = ['cosmetics','food','apparel','textile','furniture','electronics','tools','lighting','decor','fitness','toys','household','battery','other','unknown']
SIZES = ['handheld','tabletop','floor_standing','large_furniture','unknown']
LIMITATIONS = [
    'Recorded shipping fees are assumed base: historical remote charges and routes are not separately labeled.',
    'Vision-read text and inferred physical priors are model outputs, not independently verified measurements.',
    'HS codes are customs categories. 80/90% are marginal prediction coverage targets, not per-product confidence guarantees.',
    'Small independent product samples and absent shipment dates limit generalization and future-time validation.',
    'The label is the recorded forwarding fee, excluding separately recorded collect freight and taxes.',
    'Parcel-size and weight bands use a dated provider policy; visual scale is not measured package size.',
    'Photo weight ranges are uncalibrated physical priors. Product mass is only a lower bound for packed weight.',
    'Historical Weight is an offline label with a legacy kg assumption; unverified Volume units are excluded.',
    'Grade price bands describe training history. They are not fixed price caps or prediction intervals.',
    'Unknown dimensions and freight conditions require review. This is not a current route/member tariff quote.',
]


def semantic_features(row, attributes):
    numeric = np.zeros(48,dtype=np.float32); words = []; n = len(row['items'])
    for item,a in zip(row['items'],attributes):
        q = item.get('quantity',1); family = a.get('typeGroup','unknown'); size = a.get('sizeClass','unknown')
        if family not in FAMILIES or size not in SIZES:
            raise ValueError('Unknown vision vocabulary')
        numeric[FAMILIES.index(family)] += 1/n
        numeric[15+SIZES.index(size)] += 1/n
        words += [item['title'],a['kind'],a['description'],family,size,*a.get('materials',[])]
        for e in a.get('evidence',[]):
            v,u,kind,scope = e['value'],e['unit'],e['kind'],e['scope']
            if not math.isfinite(v) or v <= 0:
                raise ValueError('Invalid physical evidence')
            if kind=='volume' and u in {'ml','l'}:
                index=20; value=v*(.001 if u=='ml' else 1)*q
            elif kind=='mass' and u in {'g','kg'}:
                index={'product':21,'package':25,'unspecified':39}[scope]; value=v*(.001 if u=='g' else 1)*q
            elif kind in {'length','width','height'} and u in {'mm','cm','m'}:
                index={'length':22,'width':23,'height':24}[kind]+(4 if scope=='package' else 18 if scope=='unspecified' else 0)
                value=v*{'mm':.1,'cm':1,'m':100}[u]
            elif kind=='count' and u=='pcs':
                index=29;value=v*q
            else:
                continue
            numeric[index]=max(numeric[index],math.log1p(value)/6)
        prior=a.get('weightPriorKg',{})
        if prior.get('lower') is not None and prior.get('upper') is not None:
            lo,hi=prior['lower'],prior['upper']
            if not 0<lo<=hi<=1000:
                raise ValueError('Invalid inferred physical prior')
            numeric[30]+=math.log1p(lo*q)/(6*n);numeric[31]+=math.log1p(hi*q)/(6*n);numeric[32]+=1/n
        for field,index in [('bulky',33),('fragile',35)]:
            if isinstance(a.get(field),bool):numeric[index]+=int(a[field])/n;numeric[index+1]+=1/n
        numeric[37]+=bool(a.get('evidence'))/n
    semantic=' '.join(words)
    # No prices, labels, source IDs, customer fields or actual shipment weights enter features.
    return unit(np.concatenate([numeric*1.5,text_vector(semantic,128)*.5])),text_vector(semantic),category_vector(row['category']),sum(i.get('quantity',1) for i in row['items'])


def weighted_quantile(values,weights,quantile):
    order=np.argsort(values,kind='stable'); cumulative=np.cumsum(weights[order]); at=np.searchsorted(cumulative,quantile*cumulative[-1],side='left')
    return float(values[order[min(at,len(order)-1)]])


def predict_raw(query,reference,labels,groups,k,image_weight,coverage):
    ri,rt,rc,rq=reference; result=[]; tail=(1-coverage)/2
    for vi,vt,vc,vq in zip(*query):
        cosine=lambda m,v:np.einsum('ij,j->i',m,v,optimize=False)
        distances=image_weight*(1-cosine(ri,vi))+.25*(1-cosine(rt,vt))+(.75-image_weight)*(1-cosine(rc,vc))+.2*np.minimum(np.abs(np.log1p(rq)-math.log1p(vq)),3)
        if not np.isfinite(distances).all():raise ValueError('Non-finite features')
        picked=[];seen=set()
        for index in np.argsort(distances,kind='stable'):
            if groups[index] in seen:continue
            seen.add(groups[index]);picked.append(index)
            if len(picked)==k:break
        picked=np.array(picked);weights=1/np.maximum(distances[picked]+.05,.05)**2
        lower=weighted_quantile(labels[picked],weights,tail);upper=weighted_quantile(labels[picked],weights,1-tail)
        result.append([weighted_quantile(labels[picked],weights,.5),lower,upper,max(1000.,(upper-lower)/2)])
    return np.array(result)


def radius(scores,coverage):
    if coverage not in LEVELS or any(not math.isfinite(s) or s<0 for s in scores):raise ValueError('Invalid calibration')
    rank=math.ceil((len(scores)+1)*coverage)
    return sorted(scores)[rank-1] if rank<=len(scores) else math.inf


def group_scores(labels,raw,groups):
    errors=np.maximum.reduce([(raw[:,1]-labels)/raw[:,3],(labels-raw[:,2])/raw[:,3],np.zeros(len(labels))])
    return [float(errors[groups==g].max()) for g in np.unique(groups)]


def intervals(raw,calibration_radius):
    if calibration_radius is None or math.isinf(calibration_radius):return [[0,None] for _ in raw]
    if calibration_radius<0 or not math.isfinite(calibration_radius):raise ValueError('Invalid interval calibration')
    return [[max(0,math.floor((r[1]-calibration_radius*r[3])/100)*100),math.ceil((r[2]+calibration_radius*r[3])/100)*100] for r in raw]


def guarded_intervals(raw,relative_radius,absolute_radius):
    bands=intervals(raw,relative_radius)
    if absolute_radius is None or math.isinf(absolute_radius):return [[0,None] for _ in raw]
    return [[min(lo,max(0,math.floor((r[0]-absolute_radius)/100)*100)),
             max(hi,math.ceil((r[0]+absolute_radius)/100)*100) if hi is not None else None] for r,(lo,hi) in zip(raw,bands)]


def enclosing(outer,inner):
    return [[min(a[0],b[0]),max(a[1],b[1]) if a[1] is not None and b[1] is not None else None] for a,b in zip(outer,inner)]


def interval_report(labels,bands,groups):
    covered=np.array([lo<=y and (hi is None or y<=hi) for y,(lo,hi) in zip(labels,bands)])
    widths=[hi-lo for lo,hi in bands if hi is not None]
    return {'records':len(labels),'productGroups':len(np.unique(groups)),'recordCoverage':round(float(covered.mean()),4),
            'wholeProductCoverage':round(float(np.mean([covered[groups==g].all() for g in np.unique(groups)])),4),
            'medianWidthKrw':round(float(np.median(widths)),2) if widths else None,'meanWidthKrw':round(float(np.mean(widths)),2) if widths else None,
            'finiteRecords':len(widths),'unboundedRecords':len(bands)-len(widths),'unbounded':len(widths)!=len(bands)}


def train(args):
    started=time.monotonic();directory=Path(args.model_dir);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    source=json.loads(Path(args.data).read_text());records=source['records']
    if source['target']!='recorded_shipping_fee_as_base' or not records:raise ValueError('Explicit fee export required')
    if any(not math.isfinite(r['shippingFee']) or r['shippingFee']<=0 or not r['items'] or any(not math.isfinite(i.get('quantity',1)) or not 1<=i.get('quantity',1)<=100000 for i in r['items']) for r in records):raise ValueError('Invalid labels or quantities')
    cached=json.loads(Path(args.attributes).read_text());by_url={}
    for e in cached['entries'].values():
        if e['model']!=VISION_MODEL or e['version']!=VISION_VERSION or e.get('toolCalls')!=0:raise ValueError('Untrusted vision provenance')
        for url in e['urls']:by_url[url]=e['attributes']
    vectors,content,phashes={},{},{}
    for url in {i.get('imageUrl','') for r in records for i in r['items']} - {''}:
        file=Path(args.image_cache)/(digest(url.encode())+'.npz')
        if file.exists():
            with np.load(file,allow_pickle=False) as saved:
                vectors[url]=saved['vector'];content[url]=str(saved['content']);phashes[url]=int(str(saved['phash'])) if str(saved['phash']) else None
    # Preserve the original fee split, then filter only on image/attribute availability, never labels.
    groups=product_groups(records,content,phashes);original_splits=split_groups(groups)
    eligible=np.array([all(i.get('imageUrl') in by_url for i in r['items']) for r in records])
    splits=[ix[eligible[ix]] for ix in original_splits];train_all,validation,calibration,test=splits
    if any(not len(ix) for ix in splits):raise ValueError('Insufficient independent image examples')
    overlap=sum(len(set(groups[a]) & set(groups[b])) for j,a in enumerate(splits) for b in splits[j+1:])
    if overlap:raise ValueError('Product leakage across splits')
    values=[semantic_features(r,[by_url[i['imageUrl']] for i in r['items']]) if eligible[j] else (np.zeros(176),np.zeros(256),np.zeros(96),sum(i.get('quantity',1) for i in r['items'])) for j,r in enumerate(records)]
    features=tuple(np.array([v[j] for v in values],dtype=np.float32) for j in range(4));labels=np.array([r['shippingFee'] for r in records]);take=lambda ix:tuple(f[ix] for f in features)
    selected=undersample(train_all,groups,features[3]);reference=take(selected);settings=[]
    policy=load_policy()
    routes=[physical_route(r,[by_url[i['imageUrl']] for i in r['items']],policy) if eligible[j] else None for j,r in enumerate(records)]
    reference_routes=[reference_physical_route(records[i],[by_url[it['imageUrl']] for it in records[i]['items']],policy) for i in selected]
    keys=np.array([r['primary'] for r in reference_routes])
    routed=lambda ix,k,w,level:physical_raw(take(ix),reference,labels[selected],groups[selected],k,w,level,
                                         [routes[i] for i in ix],keys,predict_raw,policy)
    for weight in [.35,.60]:
        for k in [3,7,15]:
            losses=[]
            for level in LEVELS:
                raw,_=routed(validation,k,weight,level)
                loss=raw[:,2]-raw[:,1]+2/(1-level)*(np.maximum(raw[:,1]-labels[validation],0)+np.maximum(labels[validation]-raw[:,2],0))
                losses.append(np.mean([loss[groups[validation]==g].mean() for g in np.unique(groups[validation])]))
            settings.append((float(np.mean(losses)),k,weight))
    validation_score,k,weight=min(settings);radii={};absolute_radii={};evaluation={};raw_test={};test_bands={}
    hierarchy_calibration={}
    for level in LEVELS:
        raw_cal,_=routed(calibration,k,weight,level)
        radii[str(level)]=radius(group_scores(labels[calibration],raw_cal,groups[calibration]),level)
        errors=np.abs(labels[calibration]-raw_cal[:,0])
        absolute_radii[str(level)]=radius([float(errors[groups[calibration]==g].max()) for g in np.unique(groups[calibration])],level)
        hierarchy_calibration[str(level)]=fit_calibration(labels[calibration],raw_cal,groups[calibration],[routes[i] for i in calibration],level,policy,calibration_entry,radius,group_scores)
        raw_test[str(level)],_=routed(test,k,weight,level)
        test_bands[str(level)],_=physical_bands(raw_test[str(level)],[routes[i] for i in test],hierarchy_calibration,level,guarded_intervals)
    test_bands['0.9']=enclosing(test_bands['0.9'],test_bands['0.8'])
    for level in LEVELS:evaluation[str(level)]=interval_report(labels[test],test_bands[str(level)],groups[test])
    base=Path(args.baseline);bm=json.loads((base/'manifest.json').read_text())
    if digest((base/'model.npz').read_bytes())!=bm['artifactSha256']:raise ValueError('Baseline artifact mismatch')
    old_values=[row_features(records[i],vectors) for i in test];old_query=tuple(np.array([v[j] for v in old_values],dtype=np.float32) for j in range(4))
    with np.load(base/'model.npz',allow_pickle=False) as saved:
        old_ref=tuple(saved[key] for key in ['images','titles','categories','quantities'])
        old_pred,_=ridge_values(old_query,old_ref,saved['labels'],bm['settings']['imageWeight'],bm['settings']['alpha'],saved['dual'])
    point=raw_test['0.9'][:,0];baseline_radius=bm['intervalRadiusKrw']
    evaluation['pairedOriginal']=metrics(labels[test],old_pred,groups[test]);evaluation['pairedOriginal90']=interval_report(labels[test],[[max(0,p-baseline_radius),p+baseline_radius] for p in old_pred],groups[test])
    evaluation['multimodal']=metrics(labels[test],point,groups[test]);evaluation['medianBaseline']=metrics(labels[test],np.full(len(test),np.median(labels[original_splits[0]])),groups[test])
    evaluation['byPredictedWeight']={}
    for grade in [*policy['weightBands']['names'],'unknown']:
        mask=np.array([routes[i]['weight']['grade']==grade for i in test])
        if mask.any():
            evaluation['byPredictedWeight'][grade]={'point':metrics(labels[test][mask],point[mask],groups[test][mask]),
                'intervals':{str(level):interval_report(labels[test][mask],[b for b,m in zip(test_bands[str(level)],mask) if m],groups[test][mask]) for level in LEVELS}}
    # Evaluate photo-derived grades against historical Weight labels without using those labels to route queries.
    weight_checks=[]
    for i in test:
        actual=records[i].get('physicalLabels',{}).get('recordedWeightKg')
        if actual is not None and actual>0:
            lo,hi=routes[i]['weight']['rangeKg'];observed=weight_candidates(actual,actual,policy)[0]
            weight_checks.append({'gradeCovered':observed in routes[i]['weight']['candidates'],'priorCovered':(lo is None or lo<=actual) and (hi is None or actual<=hi),'boundedPrior':hi is not None})
    evaluation['weightAxis']={'records':len(weight_checks),'gradeCandidateCoverage':float(np.mean([v['gradeCovered'] for v in weight_checks])) if weight_checks else None,
                              'boundedPriors':sum(v['boundedPrior'] for v in weight_checks),'priorRangeCoverage':float(np.mean([v['priorCovered'] for v in weight_checks])) if weight_checks else None,
                              'volumeGroundTruthAvailable':False,'weightLabelContract':source.get('physicalLabelContract')}
    evaluation['handlingReview']={'records':len(test),'missingPackedDimensions':sum(routes[i]['volume']['dimensionsCm'] is None for i in test),
                                  'manualQuoteRequired':sum(routes[i]['handling']['freightPossible'] or test_bands['0.9'][j][1] is None for j,i in enumerate(test)),
                                  'actualDispatchDecisionsAvailable':False}
    training_weights=[records[i]['physicalLabels']['recordedWeightKg'] for i in selected if records[i].get('physicalLabels',{}).get('recordedWeightKg') is not None]
    np.savez_compressed(directory/'model.npz',images=reference[0],titles=reference[1],categories=reference[2],quantities=reference[3],labels=labels[selected],groups=groups[selected],physicalKeys=keys)
    report={'schemaVersion':3,'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'pythonExecutable':sys.executable,
            'model':'vision-language+separate-parcel-weight-axes+group-balanced-quantile-neighbours','vision':{'model':VISION_MODEL,'version':VISION_VERSION,'images':len(cached['entries']),'priceLabelsInPrompt':False},
            'categorySystem':'HS','target':source['target'],'remoteSurchargeKrw':5000,'coverageLevels':list(LEVELS),'source':source['sourceSummary'],
            'featureCoverage':{'eligibleRecords':int(eligible.sum()),'excludedMissingAttributes':int((~eligible).sum())},'groupOverlap':overlap,
            'splits':{name:{'records':len(ix),'groups':len(np.unique(groups[ix]))} for name,ix in zip(['training','validation','calibration','test'],splits)},
            'originalSplitRecords':[len(ix) for ix in original_splits],'settings':{'neighbors':k,'imageWeight':weight},'selection':'Validation macro-product interval score only; fixed original held-out fee groups.',
            'validationIntervalScore':round(validation_score,2),'undersampling':{'capPerProduct':12,'trainingBefore':len(train_all),'trainingAfter':len(selected),'largestGroupBefore':max(collections.Counter(groups[train_all]).values()),'largestGroupAfter':max(collections.Counter(groups[selected]).values())},
            'calibration':{'method':'group-maximum-CQR-union-absolute-residual','groups':len(np.unique(groups[calibration])),'radii':{l:r if math.isfinite(r) else None for l,r in radii.items()},'absoluteRadiiKrw':{l:r if math.isfinite(r) else None for l,r in absolute_radii.items()}},
            'physicalHierarchy':{'policy':policy,'priceBandsAreDescriptive':True,'queryOutcomesUsed':False,
                'calibratedInputMode':'photo-context-only; reported parcel measurements are an unvalidated input mode',
                'weightSupportKg':[min(training_weights),max(training_weights)] if training_weights else None,
                'priceBands':price_bands(labels[selected],groups[selected],keys,weighted_quantile),'calibration':hierarchy_calibration,
                'labelCoverage':{'trainingWeightLabels':sum(records[i].get('physicalLabels',{}).get('recordedWeightKg') is not None for i in selected),
                    'volumeUnitUnverified':sum(bool(r.get('physicalLabels',{}).get('recordedVolume')) for r in records),
                    'packageDimensionsFromVision':sum(routes[i]['volume']['dimensionsCm'] is not None for i in train_all),'verifiedPackageDimensionLabels':0}},
            'evaluation':evaluation,'categoryCodes':sorted({records[i]['category'] for i in selected}),
            'evaluationProtocol':'Previously inspected historical fee groups. Routing policy fixed before this fit; settings selected on validation only. All comparisons are exploratory, not fresh future holdout results.',
            'quantityRange':[float(features[3][train_all].min()),float(features[3][train_all].max())],
            'artifactSha256':digest((directory/'model.npz').read_bytes()),'limitations':LIMITATIONS,'readiness':'experimental-physical-axes-fee-only',
            'seconds':round(time.monotonic()-started,2),'peakMemoryMb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024*1024 if sys.platform=='darwin' else 1024),1)}
    os.chmod(directory/'model.npz',0o600);tmp=directory/'manifest.next.json';tmp.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False));os.chmod(tmp,0o600);tmp.replace(directory/'manifest.json')
    print(json.dumps(report,ensure_ascii=False,allow_nan=False))


def estimate(directory,request):
    manifest=json.loads((directory/'manifest.json').read_text());items=request.get('items');vision=request.get('vision')
    if not isinstance(items,list) or not 1<=len(items)<=5 or not isinstance(vision,list) or len(vision)!=len(items):raise ValueError('Images and bound vision attributes are required')
    category=request.get('category','unknown');remote=request.get('remoteArea');attributes=[];clean=[]
    if not isinstance(category,str) or len(category)>200 or remote is not None and not isinstance(remote,bool):raise ValueError('Invalid category or remote flag')
    for item,v in zip(items,vision):
        title=item.get('title');q=item.get('quantity',1)
        if not isinstance(title,str) or not 1<=len(title.strip())<=500 or isinstance(q,bool) or not isinstance(q,(int,float)) or not math.isfinite(q) or not 1<=q<=100000:raise ValueError('Invalid product input')
        data=base64.b64decode(item.get('imageBase64',''),validate=True)
        if not data or len(data)>5*1024*1024:raise ValueError('Invalid image')
        image_bytes(data)
        context=digest(json.dumps({'title':title,'category':category},ensure_ascii=False,separators=(',',':')).encode())
        if v.get('imageSha256')!=digest(data) or v.get('contextHash')!=context or v.get('model')!=VISION_MODEL or v.get('version')!=VISION_VERSION or v.get('toolCalls')!=0:raise ValueError('Vision context mismatch')
        attributes.append(v['attributes']);clean.append({'title':title,'quantity':q})
    if digest((directory/'model.npz').read_bytes())!=manifest['artifactSha256']:raise ValueError('Model checksum mismatch')
    row={'items':clean,'category':category}
    f=semantic_features(row,attributes);query=tuple(np.array([x],dtype=np.float32) for x in f);bands=[];point=None
    hierarchy=manifest.get('sizeHierarchy');physical=manifest.get('physicalHierarchy')
    size=route_size(row,attributes,hierarchy['policy']) if hierarchy else None
    axes=physical_route(row,attributes,physical['policy'],request.get('parcel')) if physical else None
    pools=None;calibration_mode=None
    supported=manifest['quantityRange'][0]<=f[3]<=manifest['quantityRange'][1]
    supplied_parcel=request.get('parcel') or {}
    provided_parcel=bool(supplied_parcel.get('weightKg') or supplied_parcel.get('dimensionsCm'))
    weight_supported=True
    if physical and supplied_parcel.get('weightKg') is not None:
        support=physical.get('weightSupportKg');supplied=supplied_parcel['weightKg']
        weight_supported=support is not None and support[0]<=supplied<=support[1]
    with np.load(directory/'model.npz',allow_pickle=False) as saved:
        ref=tuple(saved[k] for k in ['images','titles','categories','quantities'])
        for level in LEVELS:
            if physical:
                if physical['policy']['version']!=load_policy()['version']:raise ValueError('Unknown physical policy version')
                raw,pools=physical_raw(query,ref,saved['labels'],saved['groups'],manifest['settings']['neighbors'],manifest['settings']['imageWeight'],level,[axes],saved['physicalKeys'],predict_raw,physical['policy'])
                ranges,modes=physical_bands(raw,[axes],physical['calibration'],level,guarded_intervals)
                lo,hi=ranges[0];calibration_mode=modes[0]
            elif hierarchy:
                if hierarchy['policy']['version']!=DEFAULT_POLICY['version']:raise ValueError('Unknown size routing version')
                raw,pools=routed_raw(query,ref,saved['labels'],saved['groups'],manifest['settings']['neighbors'],manifest['settings']['imageWeight'],level,[size],saved['sizes'],predict_raw,hierarchy['policy'])
                ranges,modes=calibrated_bands(raw,[size],hierarchy['calibration'],level,guarded_intervals)
                lo,hi=ranges[0];calibration_mode=modes[0]
            else:
                raw=predict_raw(query,ref,saved['labels'],saved['groups'],manifest['settings']['neighbors'],manifest['settings']['imageWeight'],level)
                lo,hi=guarded_intervals(raw,manifest['calibration']['radii'][str(level)],manifest['calibration']['absoluteRadiiKrw'][str(level)])[0]
            point=max(0,round(float(raw[0,0])/100)*100)
            if not supported or not weight_supported:lo,hi=0,None
            bands.append({'coverageTarget':level,'lowerKrw':lo,'upperKrw':hi,'unbounded':hi is None})
    lo,hi=enclosing([[bands[1]['lowerKrw'],bands[1]['upperKrw']]],[[bands[0]['lowerKrw'],bands[0]['upperKrw']]])[0]
    bands[1].update(lowerKrw=lo,upperKrw=hi,unbounded=hi is None)
    surcharge=5000 if remote is True else 0 if remote is False else None
    warnings=list(manifest['limitations'])
    if remote is None:warnings.append('Remote-area status is unknown; total remains conditional.')
    if not supported:
        warnings.append('Quantity outside training support; no finite range is returned.')
        calibration_mode='unsupported-quantity'
    if category not in manifest['categoryCodes']:warnings.append('HS category was absent in training; coverage may not transfer.')
    if physical and provided_parcel:
        warnings.append('Reported parcel measurements change the input mode; historical coverage figures were evaluated with photo context only.')
        if supported and weight_supported:calibration_mode='unvalidated-reported-parcel'
    if not weight_supported:
        warnings.append('Reported parcel weight is outside observed training support; no finite range is returned.')
        calibration_mode='unsupported-weight'
    if size:warnings.extend(size['reviewReasons'])
    if axes:warnings.extend(axes['reviewReasons'])
    if axes and axes['volume']['grade']!='unknown' and all(p['referencePool'] not in {'joint','size-only'} for p in pools[0].values()):
        warnings.append('No matching packed-size labels support this route; fee prediction uses weight or shared references.')
    ninety=bands[1];total=lambda b:[b['lowerKrw']+surcharge,b['upperKrw']+surcharge if b['upperKrw'] is not None else None] if surcharge is not None else None
    result={'baseFeeKrw':point,'baseIntervalKrw':[ninety['lowerKrw'],ninety['upperKrw']],'baseIntervalsKrw':bands,'remoteSurchargeKrw':surcharge,
            'totalFeeKrw':point+surcharge if surcharge is not None else None,'totalIntervalKrw':total(ninety),'attributes':attributes,'visionModel':VISION_MODEL,
            'imageFeaturesUsed':len(attributes),'categorySystem':'HS','confidence':'experimental','readiness':manifest['readiness'],'modelCreatedAt':manifest['createdAt'],'warnings':warnings}
    if hierarchy:
        result['sizePrediction']=size
        result['priceCategory']={**hierarchy['priceBands'][size['primary']],'descriptiveOnly':True,'referencePools':pools[0]}
        result['intervalCalibration']={'mode':calibration_mode,'conditionalOnInferredSize':calibration_mode=='size-conditional'}
        result['requiresManualQuote']=ninety['unbounded']
    if physical:
        result['physicalPrediction']=axes
        result['priceCategory']={'matchingHistoricalBand':physical['priceBands'].get(axes['primary']),
                                 'descriptiveOnly':True,'referencePools':pools[0]}
        result['intervalCalibration']={'mode':calibration_mode,'conditionalOnPredictedGrade':calibration_mode=='predicted-grade-conditional',
                                       'providedMeasurementsEvaluated':False,'inputMode':'reported-parcel' if provided_parcel else 'photo-context'}
        result['requiresManualQuote']=ninety['unbounded'] or axes['handling']['freightPossible']
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True);training=sub.add_parser('train')
    for flag in ['data','attributes','image-cache','baseline','model-dir']:training.add_argument('--'+flag,required=True)
    prediction=sub.add_parser('predict');prediction.add_argument('--model-dir',required=True);args=parser.parse_args()
    try:
        if args.command=='train':train(args)
        else:print(json.dumps(estimate(Path(args.model_dir),json.loads(sys.stdin.buffer.read(12*1024*1024))),ensure_ascii=False,allow_nan=False))
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'message':'Multimodal fee operation failed; check input, attributes and artifacts.'}),file=sys.stderr);sys.exit(1)
