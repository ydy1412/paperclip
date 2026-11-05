import unittest
import math
import numpy as np
from multimodal_model import enclosing, group_scores, guarded_intervals, predict_raw, radius, semantic_features, weighted_quantile
from size_routing import CLASSES, calibrated_bands, descriptive_price_bands, route_size, routed_raw


class MultimodalFeeTests(unittest.TestCase):
    def test_observed_volume_is_not_treated_as_mass_and_package_dimensions_stay_separate(self):
        a={'typeGroup':'cosmetics','sizeClass':'handheld','kind':'shampoo','description':'bottle','materials':['plastic'],
           'evidence':[{'kind':'volume','value':820,'unit':'ml','scope':'product'},
                       {'kind':'length','value':30,'unit':'cm','scope':'package'}],
           'weightPriorKg':{'lower':None,'upper':None},'bulky':False,'fragile':None}
        row={'items':[{'title':'Shampoo','quantity':2}],'category':'330510'}
        feature=semantic_features(row,[a]);numbers=feature[0][:48]
        self.assertGreater(numbers[20],0);self.assertEqual(numbers[21],0)
        self.assertGreater(numbers[26],0);self.assertEqual(numbers[22],0)
        self.assertEqual(feature[3],2)

    def test_frequent_product_rows_do_not_dominate_neighbor_quantiles(self):
        features=(np.ones((102,1)),np.ones((102,1)),np.ones((102,1)),np.ones(102))
        labels=np.array([5000.]*100+[10000.,20000.]);groups=np.array([0]*100+[1,2])
        q=tuple(x[:1] for x in features)
        raw=predict_raw(q,features,labels,groups,3,.35,.8)
        self.assertEqual(raw[0,0],10000.)
        self.assertEqual(raw[0,1],5000.);self.assertEqual(raw[0,2],20000.)

    def test_calibration_is_per_group_and_insufficient_groups_are_unbounded(self):
        raw=np.array([[5.,4.,6.,1.],[5.,4.,6.,1.],[5.,4.,6.,1.]])
        scores=group_scores(np.array([6.,8.,9.]),raw,np.array([0,0,1]))
        self.assertEqual(scores,[2.,3.])
        self.assertTrue(math.isinf(radius([1.]*8,.9)))
        self.assertEqual(guarded_intervals(raw,None,1000),[[0,None]]*3)

    def test_absolute_guard_and_outer_interval_never_shrink_the_inner_range(self):
        raw=np.array([[6500.,6000.,7000.,1000.]])
        self.assertEqual(guarded_intervals(raw,0,2000),[[4500,8500]])
        self.assertEqual(enclosing([[5000,8000]],[[4500,8500]]),[[4500,8500]])
        self.assertEqual(enclosing([[5000,8000]],[[0,None]]),[[0,None]])

    def test_visible_small_heavy_item_is_not_forced_into_a_small_price_class(self):
        a={'sizeClass':'handheld','evidence':[{'kind':'mass','unit':'kg','value':20,'scope':'product'}]}
        size=route_size({'items':[{'quantity':1}]},[a])
        self.assertEqual(size['primary'],'large');self.assertEqual(size['candidates'],['large'])
        self.assertIn('vision_read_mass',size['basis']);self.assertFalse(size['measuredPackageClass'])

    def test_product_dimensions_are_not_package_dimensions_and_mixed_sizes_take_the_larger_route(self):
        dimensions=[{'kind':k,'unit':'cm','value':10,'scope':'product'} for k in ['length','width','height']]
        a={'sizeClass':'floor_standing','evidence':dimensions}
        size=route_size({'items':[{},{}]},[{'sizeClass':'handheld'},a])
        self.assertEqual(size['primary'],'large');self.assertEqual(size['candidates'],['medium','large'])
        a['evidence']=[{**e,'scope':'package'} for e in dimensions]
        size=route_size({'items':[{}]},[a]);self.assertEqual(size['candidates'],['small'])
        self.assertIn('vision_read_package_dimensions',size['basis'])

    def test_unknown_scale_and_inferred_weight_are_explicitly_uncertain(self):
        unknown=route_size({'items':[{}]},[{'sizeClass':'unknown'}])
        self.assertEqual(unknown['candidates'],['special']);self.assertTrue(unknown['requiresReview'])
        inferred=route_size({'items':[{}]},[{'sizeClass':'handheld','weightPriorKg':{'lower':1,'upper':20}}])
        self.assertEqual(inferred['primary'],'small');self.assertEqual(inferred['candidates'],['small','medium','large'])
        self.assertNotIn('vision_read_mass',inferred['basis'])

    def test_size_pool_uses_independent_groups_and_sparse_sizes_borrow_shared_pool(self):
        ref=(np.ones((18,1)),np.ones((18,1)),np.ones((18,1)),np.ones(18))
        labels=np.array([5000.]*8+[90000.]*10);groups=np.arange(18)
        sizes=np.array(['small']*8+['large']*10)
        route={'primary':'small','candidates':['small']};query=tuple(v[:1] for v in ref)
        raw,pools=routed_raw(query,ref,labels,groups,3,.35,.9,[route],sizes,predict_raw)
        self.assertEqual(raw[0,0],5000);self.assertEqual(pools[0]['small']['referencePool'],'same-size')
        # Eight rows of one product cannot satisfy the independent-group threshold.
        raw,pools=routed_raw(query,ref,labels,np.array([0]*8+list(range(1,11))),3,.35,.9,[route],sizes,predict_raw)
        self.assertEqual(pools[0]['small']['referencePool'],'shared-fallback')

    def test_training_price_categories_do_not_weight_frequent_products_more_heavily(self):
        labels=np.array([1000.]*100+[10000.,20000.]);groups=np.array([0]*100+[1,2]);sizes=np.array(['small']*102)
        bands=descriptive_price_bands(labels,groups,sizes,weighted_quantile)
        self.assertEqual(bands['small']['medianKrw'],10000);self.assertEqual(bands['small']['trainingGroups'],3)
        self.assertIsNone(bands['large']['observedTrainingBandKrw'])

    def test_ambiguous_size_keeps_both_ranges_and_reports_calibration_fallback(self):
        ref=(np.ones((16,1)),np.ones((16,1)),np.ones((16,1)),np.ones(16))
        labels=np.array([5000.]*8+[50000.]*8);groups=np.arange(16);sizes=np.array(['small']*8+['large']*8)
        route={'primary':'small','candidates':['small','large']}
        raw,_=routed_raw(tuple(v[:1] for v in ref),ref,labels,groups,3,.35,.9,[route],sizes,predict_raw)
        self.assertEqual(raw[0,1:3].tolist(),[5000,50000])
        calibration={'global':{'0.9':{'relative':0,'absoluteKrw':1000}},'bySize':{
            size:{'mode':'global-fallback','levels':{}} for size in CLASSES}}
        bands,modes=calibrated_bands(raw,[route],calibration,.9,guarded_intervals)
        self.assertLessEqual(bands[0][0],5000);self.assertGreaterEqual(bands[0][1],50000)
        self.assertEqual(modes,['global-fallback'])
        special={**route,'primary':'special','candidates':['special']}
        self.assertEqual(calibrated_bands(raw,[special],calibration,.9,guarded_intervals),([[0,None]],['manual-review']))

    def test_supported_size_uses_its_own_calibration_and_insufficient_global_calibration_stays_unbounded(self):
        raw=np.array([[10000.,10000.,10000.,1000.]])
        route={'primary':'medium','candidates':['medium']}
        calibration={'global':{'0.9':{'relative':None,'absoluteKrw':None}},'bySize':{
            'medium':{'mode':'size-conditional','levels':{'0.9':{'relative':0,'absoluteKrw':1000}}}}}
        self.assertEqual(calibrated_bands(raw,[route],calibration,.9,guarded_intervals),([[9000,11000]],['size-conditional']))
        calibration['bySize']['medium']['mode']='global-fallback'
        self.assertEqual(calibrated_bands(raw,[route],calibration,.9,guarded_intervals),([[0,None]],['global-fallback']))


if __name__=='__main__':unittest.main()
