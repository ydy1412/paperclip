import copy
import tempfile
import unittest
from pathlib import Path
import numpy as np
try:
    import joblib
    from regression_model import make_features,CandidateRegressor,NUMERIC
    from regression_benchmark import group_folds,nested_benchmark
except ModuleNotFoundError as error:
    raise unittest.SkipTest('Optional research requirements are not installed') from error


class RegressionModelTests(unittest.TestCase):
    def examples(self,count=24):
        rows=[];attributes={};vectors={};rng=np.random.default_rng(19)
        for i in range(count):
            key='local-image-'+str(i);quantity=i%4+1
            rows.append({'items':[{'title':'test product '+str(i),'quantity':quantity,'imageUrl':key}],'category':'940320','shippingFee':5000+1000*quantity,'physicalLabels':{'recordedWeightKg':quantity}})
            attributes[key]={'kind':'test table','description':'a small metal item','typeGroup':'furniture','sizeClass':'tabletop','materials':['metal'],
                             'evidence':[],'weightPriorKg':{'lower':1,'upper':2},'bulky':False,'fragile':False}
            vectors[key]=rng.normal(size=1000).astype(np.float32)
        return rows,attributes,vectors

    def test_pre_shipment_features_ignore_labels_customer_fields_and_source_ids(self):
        rows,attributes,vectors=self.examples();before=make_features(rows,attributes,vectors)
        changed=copy.deepcopy(rows)
        for row in changed:
            row.update(shippingFee=999999,id='PRIVATE-ID',address='PRIVATE-ADDRESS',recipient='PRIVATE-NAME',physicalLabels={'recordedWeightKg':999999,'recordedVolume':999999})
        after=make_features(changed,attributes,vectors)
        self.assertTrue(before.frame.equals(after.frame));np.testing.assert_array_equal(before.text,after.text);np.testing.assert_array_equal(before.images,after.images)
        missing=make_features(changed,{},{});self.assertEqual(len(missing.text),len(rows));self.assertTrue((missing.frame['image_attribute_fraction']==0).all());self.assertTrue((missing.images==0).all())
        self.assertNotIn('PRIVATE',str(after.frame.to_dict())+' '.join(after.text))

    def test_compatible_object_size_does_not_become_device_or_packed_dimensions(self):
        rows,attributes,vectors=self.examples(1);a=attributes['local-image-0'];a['evidence']=[{'kind':'height','value':20,'unit':'cm','scope':'compatible_item'}]
        f=make_features(rows,attributes,vectors);self.assertEqual(f.frame.loc[0,'product_height'],0);self.assertEqual(f.frame.loc[0,'package_height'],0)
        a['evidence'][0]['scope']='product';f=make_features(rows,attributes,vectors);self.assertAlmostEqual(f.frame.loc[0,'product_height'],np.log1p(20))

    def test_unit_features_do_not_scale_unit_mass_with_order_quantity(self):
        rows,attributes,vectors=self.examples(2);rows[0]['items'][0]['quantity']=1;rows[1]['items'][0]['quantity']=4
        f=make_features(rows,attributes,vectors);model=CandidateRegressor({'family':'extra','log':True,'leaf':1,'per_unit':True});frame=model._frame(f)
        self.assertAlmostEqual(frame.loc[0,'prior_lower'],frame.loc[1,'prior_lower']);self.assertNotEqual(frame.loc[0,'log_quantity'],frame.loc[1,'log_quantity'])

    def test_confirmed_cny_values_are_pre_shipment_features_with_quantity_applied_once(self):
        rows,attributes,vectors=self.examples(2)
        rows[0]['items'][0].update(quantity=2,unitPriceCny=10)
        rows[0]['declaredValueCny']=20
        rows[1]['items'][0].update(quantity=2,unitPriceCny=10)
        features=make_features(rows,attributes,vectors)
        self.assertAlmostEqual(features.frame.loc[0,'declared_total_cny'],np.log1p(20))
        self.assertAlmostEqual(features.frame.loc[0,'declared_unit_cny'],np.log1p(10))
        self.assertAlmostEqual(features.frame.loc[1,'declared_total_cny'],np.log1p(20))

    def test_group_folds_preserve_all_rows_and_never_split_a_product(self):
        groups=np.repeat(np.arange(20),3);folds=group_folds(groups,5,41);seen=set()
        for fold in folds:
            self.assertFalse(seen&set(groups[fold]));seen.update(groups[fold])
        self.assertEqual(sorted(np.concatenate(folds).tolist()),list(range(60)))
        with self.assertRaises(ValueError):group_folds(np.array([1,1,2]),5,41)

    def test_fitted_model_roundtrip_needs_only_query_content(self):
        rows,attributes,vectors=self.examples();features=make_features(rows,attributes,vectors);labels=np.array([r['shippingFee'] for r in rows]);groups=np.arange(len(rows))
        model=CandidateRegressor({'family':'extra','log':True,'leaf':1}).fit(features,labels,groups);query=features.take(np.array([0,3,6]));before=model.predict(query)
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'model.joblib';joblib.dump(model,file);after=joblib.load(file).predict(query)
        np.testing.assert_allclose(before,after);self.assertTrue(np.isfinite(after).all());self.assertTrue((after>=0).all())

    def test_nested_benchmark_scores_every_synthetic_row_without_accuracy_claim(self):
        rows,attributes,vectors=self.examples(20);features=make_features(rows,attributes,vectors)
        dataset={'features':features,'labels':np.array([r['shippingFee'] for r in rows]),'weights':np.ones(20),'groups':np.arange(20),'completeImages':np.ones(20,dtype=bool),'sourceHashes':{'data':'synthetic'},'visionVersion':'synthetic'}
        with tempfile.TemporaryDirectory() as directory:
            report=nested_benchmark(dataset,directory,13,[{'family':'extra','log':True,'leaf':1}]);saved=np.load(Path(directory)/'predictions.npz')
            self.assertEqual(report['outOfFold']['records'],20);self.assertEqual(report['outOfFold']['productGroups'],20);self.assertTrue(np.isfinite(saved['predicted']).all())
        self.assertFalse(report['prospectiveValidation']);self.assertEqual(len(report['folds']),5)


if __name__=='__main__':unittest.main()
