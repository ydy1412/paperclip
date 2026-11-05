import unittest
import math
import numpy as np
from multimodal_model import enclosing, group_scores, guarded_intervals, predict_raw, radius, semantic_features


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


if __name__=='__main__':unittest.main()
