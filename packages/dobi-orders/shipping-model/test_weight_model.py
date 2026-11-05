import json
import math
from pathlib import Path
import tempfile
import unittest
import numpy as np
from model import digest, row_features
from weight_model import bounds, conformal_radius, coverage_summary, estimate, group_scores


class WeightIntervalTests(unittest.TestCase):
    def test_repeated_shipments_have_one_calibration_vote_per_product(self):
        labels = np.array([1.,2.,4.]); predictions = np.log([1.,1.,1.]); groups = np.array([0,0,1])
        scores = group_scores(labels,predictions,groups)
        self.assertEqual(scores,[math.log(2),math.log(4)])
        repeated = group_scores(np.repeat(labels,1000),np.repeat(predictions,1000),np.repeat(groups,1000))
        self.assertEqual(scores,repeated)
        # Missing-image failure is also calibrated, even when the image prediction is perfect.
        self.assertEqual(group_scores(np.array([2.]),np.log([[2.],[.5]]),np.array([0])),[math.log(4)])

    def test_finite_sample_rank_never_clips_an_unavailable_quantile(self):
        self.assertTrue(math.isinf(conformal_radius([.1]*8,.9)))
        self.assertEqual(conformal_radius(list(range(9)),.9),8)
        self.assertEqual(bounds(0,math.inf),[0.,None])
        self.assertRaises(ValueError,conformal_radius,[float('nan')],.9)

    def test_nested_intervals_round_outward_and_report_width_with_coverage(self):
        scores = [i/20 for i in range(1,24)]
        a = bounds(math.log(.617),conformal_radius(scores,.8))
        b = bounds(math.log(.617),conformal_radius(scores,.9))
        self.assertLessEqual(b[0],a[0]); self.assertGreaterEqual(b[1],a[1])
        self.assertLessEqual(a[0],math.exp(math.log(.617)-conformal_radius(scores,.8)))
        self.assertGreaterEqual(a[1],math.exp(math.log(.617)+conformal_radius(scores,.8)))
        report = coverage_summary(np.array([1.,3.,1.]),np.log([1.,1.,1.]),np.array([0,0,1]),math.log(2))
        self.assertAlmostEqual(report['recordCoverage'],2/3,places=4)
        self.assertEqual(report['wholeProductCoverage'],.5)
        self.assertGreater(report['meanWidthKg'],0)

    def test_real_worker_contract_has_ranges_not_an_exact_mass_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); feature = row_features({'category':'691110','items':[{'title':'cup','quantity':1}]},{})
            np.savez(directory/'model.npz',images=np.array([feature[0]]),titles=np.array([feature[1]]),categories=np.array([feature[2]]),quantities=np.array([feature[3]]),labels=np.array([.5]),dual=np.array([0.]))
            manifest = {'limitations':[],'categoryCodes':['691110'],'quantityRange':[1,2],'settings':{'imageWeight':.35,'alpha':.3},
                        'calibration':{'logRadii':{'0.8':math.log(2),'0.9':math.log(3)},'groups':23},
                        'artifactSha256':digest((directory/'model.npz').read_bytes()),'readiness':'experimental-prediction-interval-only','createdAt':'synthetic','target':'recorded_single_item_shipment_weight_kg'}
            (directory/'manifest.json').write_text(json.dumps(manifest))
            request = {'items':[{'title':'cup','quantity':1}],'category':'691110'}
            result = estimate(directory,request)
            self.assertEqual(result['intervals'][0]['lowerKg'],.25)
            self.assertEqual(result['intervals'][0]['upperKg'],1.)
            self.assertNotIn('estimatedWeightKg',result)
            self.assertTrue(all(x['unbounded'] for x in estimate(directory,{**request,'items':[{'title':'cup','quantity':3}]})['intervals']))
            for items in [[{'title':'a'},{'title':'b'}],[{'title':'a','quantity':1.5}],[{'title':'a','quantity':True}]]:
                self.assertRaises(ValueError,estimate,directory,{**request,'items':items})
            with (directory/'model.npz').open('ab') as f:
                f.write(b'tampered')
            self.assertRaises(ValueError,estimate,directory,request)


if __name__ == '__main__':
    unittest.main()
