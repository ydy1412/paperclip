"""Offline grouped model selection. All fitted transforms stay inside training folds."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import numpy as np
from model import digest, product_groups, undersample
from regression_model import CANDIDATES, CandidateRegressor, make_features


def metrics(labels,predicted,groups):
    if len(labels)!=len(predicted) or not np.isfinite(predicted).all():raise ValueError('Invalid predictions')
    errors=np.abs(labels-predicted);unique=np.unique(groups)
    return {'maeKrw':float(errors.mean()),'macroProductMaeKrw':float(np.mean([errors[groups==g].mean() for g in unique])),
            'medianErrorKrw':float(np.median(errors)),'p90ErrorKrw':float(np.quantile(errors,.9)),
            'within2000':float(np.mean(errors<2000)),'underestimationMeanKrw':float(np.maximum(labels-predicted,0).mean()),
            'records':len(labels),'productGroups':len(unique)}


def group_folds(groups,count,seed):
    unique=np.unique(groups).copy()
    if count<2 or len(unique)<count*2:raise ValueError('Insufficient independent groups')
    np.random.default_rng(seed).shuffle(unique)
    return [np.flatnonzero(np.isin(groups,bucket)) for bucket in np.array_split(unique,count)]


def load_dataset(data_file,attributes_file,image_cache):
    source=json.loads(Path(data_file).read_text());cached=json.loads(Path(attributes_file).read_text());rows=source['records'];attributes={};versions=set()
    if source['target']!='recorded_shipping_fee_as_base' or not rows:raise ValueError('Explicit fee source required')
    uses_prices=any('declaredValueCny' in row or any('unitPriceCny' in item for item in row['items']) for row in rows)
    if uses_prices and source.get('priceContract',{}).get('currency')!='CNY':raise ValueError('Price currency must be explicitly CNY')
    labels=np.array([row['shippingFee'] for row in rows],dtype=float)
    if not np.isfinite(labels).all() or (labels<=0).any():raise ValueError('Only positive labeled fees are supported')
    for entry in cached['entries'].values():
        if entry.get('model')!='gpt-6-luna' or entry.get('toolCalls')!=0:raise ValueError('Untrusted image provenance')
        versions.add(entry['version'])
        for url in entry['urls']:attributes[url]=entry['attributes']
    if len(versions)!=1:raise ValueError('Do not mix image prompt versions')
    content={};phashes={};vectors={}
    for url in {item.get('imageUrl','') for row in rows for item in row['items']}:
        cache=Path(image_cache)/(digest(url.encode())+'.npz')
        if cache.exists():
            with np.load(cache,allow_pickle=False) as saved:
                vectors[url]=saved['vector'];content[url]=str(saved['content']);phashes[url]=int(str(saved['phash'])) if str(saved['phash']) else None
    groups=product_groups(rows,content,phashes);features=make_features(rows,attributes,vectors)
    weights=np.array([row.get('physicalLabels',{}).get('recordedWeightKg') or np.nan for row in rows],dtype=float)
    complete=np.array([all(item.get('imageUrl') in attributes for item in row['items']) for row in rows])
    hashes={key:digest(Path(file).read_bytes()) for key,file in [('data',data_file),('attributes',attributes_file)]}
    return {'rows':rows,'features':features,'labels':labels,'weights':weights,'groups':groups,'completeImages':complete,
            'sourceHashes':hashes,'visionVersion':next(iter(versions)),'physicalLabelContract':source.get('physicalLabelContract'),
            'priceInputMode':'reported-CNY' if uses_prices else 'image-text-only'}


def select_candidate(dataset,training,seed=20261106,candidates=CANDIDATES):
    groups=dataset['groups'];features=dataset['features'];labels=dataset['labels'];folds=group_folds(groups[training],2,seed);losses=[]
    for index,config in enumerate(candidates):
        predicted=np.full(len(training),np.nan)
        for local_validation in folds:
            validation=training[local_validation];train=training[~np.isin(groups[training],groups[validation])]
            train=undersample(train,groups,features.quantities)
            assert not(set(groups[train])&set(groups[validation]))
            model=CandidateRegressor(config).fit(features.take(train),labels[train],groups[train],dataset['weights'][train])
            predicted[local_validation]=model.predict(features.take(validation))
        loss=metrics(labels[training],predicted,groups[training])['macroProductMaeKrw'];losses.append(loss)
    selected=int(np.argmin(losses))
    return selected,losses


def nested_benchmark(dataset,output,seed=20261106,candidates=CANDIDATES):
    output=Path(output);output.mkdir(parents=True,exist_ok=True,mode=0o700);started=time.monotonic()
    labels,groups,features=dataset['labels'],dataset['groups'],dataset['features'];folds=group_folds(groups,5,seed)
    predictions=np.full(len(labels),np.nan);results=[]
    code_hash=digest(Path(__file__).with_name('regression_model.py').read_bytes())
    snapshots=output/'source';snapshots.mkdir(exist_ok=True)
    for name in ['regression_model.py','regression_benchmark.py']:(snapshots/name).write_bytes(Path(__file__).with_name(name).read_bytes())
    plan={'seed':seed,'outerFolds':5,'innerFolds':2,'candidates':candidates,'sourceHashes':dataset['sourceHashes'],
          'regressionCodeSha256':code_hash,'selection':'inner macro-product MAE','noImageFiltering':True,
          'records':len(labels),'productGroups':len(np.unique(groups)),'visionVersion':dataset['visionVersion'],
          'priceInputMode':dataset.get('priceInputMode','synthetic')}
    (output/'plan.json').write_text(json.dumps(plan,indent=2))
    for fold,test in enumerate(folds):
        train=np.flatnonzero(~np.isin(groups,groups[test]));selected,losses=select_candidate(dataset,train,seed+fold,candidates)
        sampled=undersample(train,groups,features.quantities)
        assert not(set(groups[sampled])&set(groups[test]))
        model=CandidateRegressor(candidates[selected]).fit(features.take(sampled),labels[sampled],groups[sampled],dataset['weights'][sampled])
        predictions[test]=model.predict(features.take(test))
        result={'fold':fold,'selected':selected,'config':candidates[selected],'innerScores':losses,
                'trainingBefore':len(train),'trainingAfter':len(sampled),'testGroups':np.unique(groups[test]).tolist(),
                'metrics':metrics(labels[test],predictions[test],groups[test])}
        results.append(result)
        np.savez_compressed(output/'predictions.npz',actual=labels,predicted=predictions,groups=groups)
        (output/'progress.json').write_text(json.dumps({'folds':results,'seconds':time.monotonic()-started},indent=2))
        print(json.dumps({'fold':fold,'selected':selected,'metrics':result['metrics']}),flush=True)
    complete=dataset['completeImages']
    report={'plan':plan,'folds':results,'outOfFold':metrics(labels,predictions,groups),
            'imageCompleteOutOfFold':metrics(labels[complete],predictions[complete],groups[complete]),
            'seconds':time.monotonic()-started,'prospectiveValidation':False}
    (output/'report.json').write_text(json.dumps(report,indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ['data','attributes','image-cache','output']:parser.add_argument('--'+key,required=True)
    parser.add_argument('--seed',type=int,default=20261106);args=parser.parse_args()
    loaded=load_dataset(args.data,args.attributes,args.image_cache)
    result=nested_benchmark(loaded,args.output,args.seed)
    print(json.dumps({'outOfFold':result['outOfFold'],'seconds':result['seconds']}))
