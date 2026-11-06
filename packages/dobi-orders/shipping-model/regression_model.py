"""Small supervised fee models; only pre-shipment content enters features.

Optional research backend. Import only with its isolated requirements installed.
"""
from dataclasses import dataclass
import collections
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction import DictVectorizer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import TruncatedSVD
from sklearn.linear_model import Ridge, HuberRegressor
from sklearn.svm import SVR
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.isotonic import IsotonicRegression
from catboost import CatBoostRegressor

CATEGORICAL = ['hs2','hs4','hs6','family','size','kind','materials','duty','mechanism']
SCOPES = ['product','package','unspecified']
NUMERIC = ['log_quantity','item_count','image_attribute_fraction','bulky','fragile',
           'prior_lower','prior_upper','prior_geometric','has_prior']
for scope in SCOPES:
    NUMERIC += [scope+'_'+name for name in ['mass','volume','length','width','height','volume_cm3','edge_sum']]
    NUMERIC += ['has_'+scope+'_'+name for name in ['mass','volume','length','width','height','3d']]
NUMERIC += ['inferred_'+axis+'_'+bound for axis in ['length','width','height'] for bound in ['lower','upper']]
NUMERIC += ['inferred_volume_cm3','has_inferred_3d']
NUMERIC += ['declared_total_cny','declared_unit_cny','has_declared_value','has_unit_prices','unit_price_spread']


@dataclass
class Features:
    frame: pd.DataFrame
    text: np.ndarray
    images: np.ndarray
    quantities: np.ndarray

    def take(self, indices):
        return Features(self.frame.iloc[indices].reset_index(drop=True),self.text[indices],self.images[indices],self.quantities[indices])


def make_features(rows, attributes, image_vectors):
    """Allowlist input fields. IDs, URLs and outcome measurements are never encoded."""
    tables=[];texts=[];images=[];quantities=[]
    for row in rows:
        items=row['items'];n=len(items);q_total=sum(i.get('quantity',1) for i in items)
        if not items or not np.isfinite(q_total) or q_total<=0:raise ValueError('Invalid product quantity')
        values=collections.defaultdict(float);words=[];families=[];sizes=[];kinds=[];materials=[];duties=[];mechanisms=[];vectors=[]
        values['log_quantity']=np.log1p(q_total);values['item_count']=n
        total_value=row.get('declaredValueCny');item_prices=[item.get('unitPriceCny') for item in items]
        valid_price=lambda price:isinstance(price,(int,float)) and not isinstance(price,bool) and np.isfinite(price) and price>=0
        values['has_unit_prices']=sum(valid_price(p) for p in item_prices)/n
        if not valid_price(total_value) and all(valid_price(p) for p in item_prices):total_value=sum(p*item.get('quantity',1) for p,item in zip(item_prices,items))
        if valid_price(total_value):values['declared_total_cny']=total_value;values['declared_unit_cny']=total_value/q_total;values['has_declared_value']=1
        known_prices=[p for p in item_prices if valid_price(p)]
        if known_prices:values['unit_price_spread']=np.log1p(max(known_prices))-np.log1p(min(known_prices))
        for item in items:
            q=item.get('quantity',1);key=item.get('imageUrl','');a=attributes.get(key,{})
            if not np.isfinite(q) or q<=0:raise ValueError('Invalid item quantity')
            values['image_attribute_fraction']+=bool(a)/n;families.append(a.get('typeGroup','unknown'));sizes.append(a.get('sizeClass','unknown'));kinds.append(a.get('kind','unknown'));materials+=a.get('materials',[]);duties.append(a.get('dutyClass','unknown'));mechanisms.append(a.get('mechanism','unknown'))
            words += [item['title'],a.get('kind',''),a.get('description',''),*a.get('materials',[]),*a.get('visibleText',[])]
            values['bulky']+=int(a.get('bulky') is True)/n;values['fragile']+=int(a.get('fragile') is True)/n
            prior=a.get('weightPriorKg',{});lo,hi=prior.get('lower'),prior.get('upper')
            if lo is not None and hi is not None and 0<lo<=hi<=1000:
                values['prior_lower']+=lo*q;values['prior_upper']+=hi*q;values['prior_geometric']+=np.sqrt(lo*hi)*q;values['has_prior']+=1/n
            dims={}
            for evidence in a.get('evidence',[]):
                value,unit,kind,scope=evidence['value'],evidence['unit'],evidence['kind'],evidence['scope']
                if scope not in SCOPES:continue  # Working capacity is not a device dimension.
                if not np.isfinite(value) or value<=0:raise ValueError('Invalid physical evidence')
                name=scope+'_'+kind
                if kind=='mass' and unit in ['kg','g']:
                    values[name]+=value*(.001 if unit=='g' else 1)*q;values['has_'+name]+=1
                if kind=='volume' and unit in ['l','ml']:
                    values[name]+=value*(.001 if unit=='ml' else 1)*q;values['has_'+name]+=1
                if kind in ['length','width','height'] and unit in ['mm','cm','m']:
                    cm=value*{'mm':.1,'cm':1,'m':100}[unit];values[name]=max(values[name],cm);values['has_'+name]+=1;dims[name]=cm
            for scope in SCOPES:
                axes=[dims.get(scope+'_'+axis) for axis in ['length','width','height']]
                if all(x is not None for x in axes):
                    values[scope+'_volume_cm3']+=np.prod(axes)*q;values['has_'+scope+'_3d']+=1;values[scope+'_edge_sum']=max(values[scope+'_edge_sum'],sum(axes))
            estimated=a.get('estimatedDimensionsCm',{});centers=[]
            for axis in ['length','width','height']:
                bounds=estimated.get(axis,{})
                if bounds.get('lower') is not None and bounds.get('upper') is not None and 0<bounds['lower']<=bounds['upper']<=10000:
                    for bound in ['lower','upper']:values['inferred_'+axis+'_'+bound]=max(values['inferred_'+axis+'_'+bound],bounds[bound])
                    centers.append(np.sqrt(bounds['lower']*bounds['upper']))
            if len(centers)==3:values['inferred_volume_cm3']+=np.prod(centers)*q;values['has_inferred_3d']+=1
            if key in image_vectors:vectors.append(image_vectors[key])
        for key in NUMERIC:
            if not key.startswith('has_') and key not in ['log_quantity','item_count','image_attribute_fraction','bulky','fragile']:values[key]=np.log1p(values[key])
        unique=lambda values:'|'.join(sorted(set(values))) or 'unknown'
        category=row.get('category','unknown')
        cat={'hs2':category[:2],'hs4':category[:4],'hs6':category,'family':unique(families),'size':unique(sizes),'kind':unique(kinds),'materials':unique(materials),'duty':unique(duties),'mechanism':unique(mechanisms)}
        tables.append({**{key:float(values[key]) for key in NUMERIC},**cat});texts.append(' '.join(words));quantities.append(q_total)
        images.append(np.mean(vectors,axis=0) if vectors else np.zeros(1000))
    return Features(pd.DataFrame(tables,columns=CATEGORICAL+NUMERIC),np.array(texts),np.array(images,dtype=np.float32),np.array(quantities,dtype=float))


# Fixed candidates are selected inside training folds, never from outer errors.
CANDIDATES = [
    {'family':'ridge','log':False,'alpha':10}, {'family':'ridge','log':True,'alpha':1},
    {'family':'ridge','log':True,'alpha':10}, {'family':'svr','log':True,'C':3},
    {'family':'svr','log':True,'C':30}, {'family':'cat','log':False,'depth':4,'loss':'MAE'},
    {'family':'cat','log':False,'depth':6,'loss':'MAE'}, {'family':'cat','log':True,'depth':4,'loss':'RMSE'},
    {'family':'cat','log':True,'depth':6,'loss':'RMSE'}, {'family':'extra','log':True,'leaf':1},
    {'family':'extra','log':False,'leaf':3}, {'family':'hist','log':False,'loss':'absolute_error'},
    {'family':'weight_tariff','log':True,'depth':4},
    {'family':'cat','log':True,'depth':4,'loss':'RMSE','per_unit':True},
    {'family':'cat','log':False,'depth':4,'loss':'MAE','per_unit':True},
    {'family':'extra','log':True,'leaf':1,'per_unit':True},
    {'family':'weight_tariff','log':True,'depth':4,'per_unit':True,'linear_tariff':True},
    {'family':'weight_tariff','log':True,'depth':6,'per_unit':True,'linear_tariff':True},
]


class CandidateRegressor:
    def __init__(self,config):self.config=dict(config)

    def _frame(self,features):
        frame=features.frame.copy()
        if self.config.get('per_unit'):
            for key in NUMERIC:
                if not key.startswith('has_') and (key=='declared_total_cny' or any(token in key for token in ['prior_','_mass','_volume'])):
                    frame[key]=np.log1p(np.expm1(frame[key].to_numpy())/features.quantities)
        return frame

    def _transform(self,features,fit=False):
        frame=self._frame(features)
        if fit:
            self.word=TfidfVectorizer(ngram_range=(1,2),max_features=3000,sublinear_tf=True)
            self.char=TfidfVectorizer(analyzer='char',ngram_range=(3,5),max_features=4000,sublinear_tf=True)
            self.categorical=DictVectorizer();self.scale=StandardScaler()
        apply=lambda transformer,values:transformer.fit_transform(values) if fit else transformer.transform(values)
        word=apply(self.word,features.text);char=apply(self.char,features.text)
        categories=apply(self.categorical,frame[CATEGORICAL].to_dict('records'));numeric=apply(self.scale,frame[NUMERIC].to_numpy())
        if fit:
            count=len(frame);self.text_svd=TruncatedSVD(n_components=min(24,count-1,word.shape[1]+char.shape[1]-1),random_state=29)
            self.image_svd=TruncatedSVD(n_components=min(16,count-1),random_state=29)
        text=apply(self.text_svd,sparse.hstack([word,char]));image=apply(self.image_svd,features.images)
        if self.config['family'] in ['ridge','svr']:return sparse.hstack([word,char,categories,sparse.csr_matrix(numeric*.2)])
        if self.config['family'] in ['cat','weight_tariff']:
            return pd.concat([frame.reset_index(drop=True),pd.DataFrame(text,columns=['text'+str(i) for i in range(text.shape[1])]),pd.DataFrame(image,columns=['image'+str(i) for i in range(image.shape[1])])],axis=1)
        return np.hstack([numeric,text,image,categories.toarray()])

    def fit(self,features,labels,groups,weight_labels=None):
        config=self.config;x=self._transform(features,fit=True)
        unit_labels=labels/features.quantities if config.get('per_unit') else labels
        target=np.log1p(unit_labels) if config['log'] else unit_labels
        sample=np.array([1/np.sqrt(sum(groups==g)) for g in groups])
        family=config['family']
        if family=='ridge':self.model=Ridge(alpha=config['alpha'],solver='lsqr')
        elif family=='svr':self.model=SVR(C=config['C'],epsilon=.08,kernel='rbf',gamma='scale')
        elif family in ['cat','weight_tariff']:
            self.model=CatBoostRegressor(iterations=600,depth=config['depth'],learning_rate=.04,loss_function=config.get('loss','RMSE'),l2_leaf_reg=5,verbose=False,thread_count=1,random_seed=29,allow_writing_files=False)
        elif family=='extra':self.model=ExtraTreesRegressor(n_estimators=250,min_samples_leaf=config['leaf'],max_features=.8,random_state=29,n_jobs=1)
        elif family=='hist':self.model=HistGradientBoostingRegressor(loss=config['loss'],max_iter=300,max_depth=4,min_samples_leaf=5,l2_regularization=5,early_stopping=False,random_state=29)
        else:raise ValueError('Unknown regression family')
        if family=='weight_tariff':
            if weight_labels is None:raise ValueError('Training weight labels required')
            known=np.isfinite(weight_labels)&(weight_labels>0)
            if sum(known)<10:raise ValueError('Insufficient training weight labels')
            target_weight=weight_labels[known]/features.quantities[known] if config.get('per_unit') else weight_labels[known]
            self.model.fit(x.loc[known],np.log1p(target_weight),cat_features=CATEGORICAL,sample_weight=sample[known])
            if config.get('linear_tariff'):self.tariff=HuberRegressor(max_iter=2000).fit(weight_labels[known,None],labels[known],sample_weight=sample[known])
            else:self.tariff=IsotonicRegression(out_of_bounds='clip').fit(weight_labels[known],labels[known],sample_weight=sample[known])
        elif family=='cat':self.model.fit(x,target,cat_features=CATEGORICAL,sample_weight=sample)
        else:self.model.fit(x,target,sample_weight=sample)
        return self

    def predict(self,features):
        config=self.config;pred=self.model.predict(self._transform(features));pred=np.expm1(pred) if config['log'] else pred
        if config.get('per_unit'):pred*=features.quantities
        if config['family']=='weight_tariff':
            pred=self.tariff.predict(np.maximum(0,pred)[:,None] if config.get('linear_tariff') else np.maximum(0,pred))
        if not np.isfinite(pred).all():raise ValueError('Non-finite regression prediction')
        return np.maximum(0,pred)
