import unittest
import numpy as np
from physical_routing import load_policy, physical_route, reference_physical_route, reference_pool, physical_raw, fit_calibration, physical_bands, validate_parcel
from multimodal_model import calibration_entry, radius, group_scores, guarded_intervals, predict_raw, semantic_features


def attribute(**extra):
    return {'sizeClass':'handheld','typeGroup':'tools','kind':'item','description':'item','materials':[],
            'evidence':[],'weightPriorKg':{'lower':None,'upper':None}, **extra}


class PhysicalRoutingTests(unittest.TestCase):
    def setUp(self):
        self.policy=load_policy();self.row={'items':[{'title':'item','quantity':1}],'category':'unknown'}

    def route(self, parcel=None, a=None, row=None):
        return physical_route(row or self.row,[a or attribute()],self.policy,parcel)

    def test_small_heavy_and_large_light_parcels_keep_independent_axes(self):
        small=self.route({'weightKg':20,'dimensionsCm':{'length':10,'width':10,'height':10}})
        self.assertEqual(small['volume']['grade'],'small');self.assertEqual(small['weight']['grade'],'heavy')
        self.assertTrue(small['handling']['thresholdsExceeded'])
        large=self.route({'weightKg':1,'dimensionsCm':{'length':70,'width':50,'height':30},'hub':'other'})
        self.assertEqual(large['volume']['grade'],'large');self.assertEqual(large['weight']['grade'],'light')
        self.assertFalse(large['handling']['thresholdsExceeded'])

    def test_surcharge_upper_endpoints_and_inclusive_freight_checks_are_distinct(self):
        for kg,grade in [(5,'light'),(5.01,'medium'),(10,'medium'),(10.01,'heavy'),(20,'heavy'),(20.01,'overweight')]:
            self.assertEqual(self.route({'weightKg':kg})['weight']['grade'],grade)
        for total,grade in [(100,'small'),(100.01,'medium'),(120,'medium'),(120.01,'large'),(160,'large'),(160.01,'oversize')]:
            r=self.route({'dimensionsCm':{'length':total/3,'width':total/3,'height':total/3}})
            self.assertEqual(r['volume']['grade'],grade)
        self.assertTrue(self.route({'weightKg':20})['handling']['thresholdsExceeded'])
        for longest in [94.99,95]:
            r=self.route({'weightKg':1,'dimensionsCm':{'length':longest,'width':1,'height':1},'hub':'other'})
            self.assertEqual(r['handling']['thresholdsExceeded'],longest==95)

    def test_unknown_hub_preserves_gunsan_boundary_uncertainty(self):
        parcel={'weightKg':1,'dimensionsCm':{'length':50,'width':50,'height':50}}
        self.assertTrue(self.route({**parcel,'hub':'gunsan'})['handling']['thresholdsExceeded'])
        self.assertFalse(self.route({**parcel,'hub':'other'})['handling']['freightPossible'])
        unknown=self.route(parcel)['handling']
        self.assertFalse(unknown['thresholdsExceeded']);self.assertTrue(unknown['freightPossible'])

    def test_product_dimensions_and_unitless_volume_do_not_become_package_ground_truth(self):
        evidence=[{'kind':k,'value':10,'unit':'cm','scope':'product'} for k in ['length','width','height']]
        row={**self.row,'physicalLabels':{'recordedVolume':.2,'volumeUnit':None,'recordedWeightKg':99}}
        r=self.route(a=attribute(evidence=evidence),row=row)
        self.assertEqual(r['volume']['grade'],'unknown');self.assertIsNone(r['volume']['volumeCbm'])
        self.assertEqual(r['weight']['grade'],'unknown')
        packed=self.route(a=attribute(evidence=[{**e,'scope':'package'} for e in evidence]))
        self.assertEqual(packed['volume']['grade'],'small');self.assertAlmostEqual(packed['volume']['volumeCbm'],.001)

    def test_product_mass_is_a_lower_bound_and_visual_prior_stays_uncalibrated(self):
        a=attribute(evidence=[{'kind':'mass','value':4000,'unit':'g','scope':'product'}])
        r=self.route(a=a);self.assertEqual(r['weight']['rangeKg'],[4,None]);self.assertEqual(r['weight']['grade'],'unknown')
        self.assertIn('overweight',r['weight']['candidates'])
        a['weightPriorKg']={'lower':4,'upper':8}
        r=self.route(a=a);self.assertEqual(r['weight']['candidates'],['light','medium'])
        self.assertFalse(r['weight']['calibratedWeightInterval']);self.assertEqual(r['volume']['grade'],'unknown')

    def test_query_routes_and_features_ignore_historical_outcome_labels(self):
        a=attribute(weightPriorKg={'lower':1,'upper':2});row={**self.row,'physicalLabels':{'recordedWeightKg':50,'recordedVolume':999}}
        self.assertEqual(self.route(a=a,row=row),self.route(a=a))
        for before,after in zip(semantic_features(row,[a]),semantic_features(self.row,[a])):
            np.testing.assert_array_equal(before,after)
        reference=reference_physical_route(row,[a],self.policy)
        self.assertEqual(reference['weight']['grade'],'overweight');self.assertEqual(reference['volume']['grade'],'unknown')

    def test_reference_fallback_uses_independent_groups_and_preserves_joint_conditions(self):
        keys=np.array(['small|heavy']*8+['large|heavy']*8+['small|light']*8);groups=np.arange(24)
        mask,info=reference_pool('small|heavy',keys,groups,self.policy)
        self.assertEqual(info['referencePool'],'joint');self.assertEqual(sum(mask),8)
        mask,info=reference_pool('medium|heavy',keys,groups,self.policy)
        self.assertEqual(info['referencePool'],'weight-only');self.assertEqual(sum(mask),16)
        mask,info=reference_pool('small|unknown',keys,groups,self.policy)
        self.assertEqual(info['referencePool'],'size-only')
        _,info=reference_pool('small|heavy',keys,np.zeros(24,dtype=int),self.policy)
        self.assertEqual(info['referencePool'],'shared-fallback')

    def test_weight_ambiguity_keeps_all_candidate_fee_ranges(self):
        a=attribute(weightPriorKg={'lower':1,'upper':20});route=self.route(a=a)
        reference=(np.ones((24,1)),np.ones((24,1)),np.ones((24,1)),np.ones(24))
        keys=np.array(['unknown|light']*8+['unknown|medium']*8+['unknown|heavy']*8)
        labels=np.array([1000.]*8+[10000.]*8+[50000.]*8)
        raw,pools=physical_raw(tuple(v[:1] for v in reference),reference,labels,np.arange(24),3,.35,.9,[route],keys,predict_raw,self.policy)
        self.assertEqual(raw[0,1:3].tolist(),[1000,50000]);self.assertEqual(len(pools[0]),3)

    def test_calibration_uses_predicted_grades_and_independent_product_counts(self):
        raw=np.tile([10000.,9000.,11000.,1000.],(10,1));labels=np.full(10,12000.)
        routes=[{'primary':'unknown|light'}]*10
        cal=fit_calibration(labels,raw,np.arange(10),routes,.9,self.policy,calibration_entry,radius,group_scores)
        self.assertEqual(cal['byPredictedGrade']['unknown|light']['mode'],'predicted-grade-conditional')
        repeated=fit_calibration(labels,raw,np.zeros(10),routes,.9,self.policy,calibration_entry,radius,group_scores)
        self.assertEqual(repeated['byPredictedGrade']['unknown|light']['mode'],'global-fallback')
        bands,modes=physical_bands(raw[:1],routes[:1],{'0.9':repeated},.9,guarded_intervals)
        self.assertEqual(bands,[[0,None]]);self.assertEqual(modes,['global-fallback'])

    def test_reported_parcel_rejects_bad_units_partial_dimensions_and_non_numeric_values(self):
        for parcel in [{},[],{'weightKg':True},{'weightKg':-1},{'weightKg':'1kg'},
                       {'dimensionsCm':{'length':10}},{'hub':'guessed'},{'hub':{}},{'weightKg':float('inf')}]:
            with self.assertRaises(ValueError):validate_parcel(parcel)
        self.assertEqual(validate_parcel({'weightKg':1,'source':'arbitrary'}),{'weightKg':1})


if __name__=='__main__':unittest.main()
