import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from model import product_groups, split_groups, undersample, estimate, text_vector, category_vector


class ShippingModelTests(unittest.TestCase):
    def test_connected_products_do_not_cross_splits_and_only_training_is_capped(self):
        rows = [{'category':'330499','items':[{'title':'cream','quantity':1,'imageUrl':'https://img.alicdn.com/'+str(i%40)+'.jpg'}]} for i in range(400)]
        rows += [{'category':'330499','items':[{'title':'cream','quantity':1,'imageUrl':'https://img.alicdn.com/0.jpg'}]} for _ in range(1000)]
        # Two distinct URLs with identical image bytes belong to one product group.
        groups = product_groups(rows, {'https://img.alicdn.com/0.jpg':'same','https://img.alicdn.com/1.jpg':'same'}, {})
        self.assertEqual(groups[0], groups[1])
        views=[{'productKey':'same-original-product','category':'33','items':[{'title':'view','imageUrl':'https://img.alicdn.com/'+str(i)}]} for i in range(2)]
        linked=product_groups(views,{},{});self.assertEqual(linked[0],linked[1])
        splits = split_groups(groups)
        for a in range(4):
            for b in range(a+1,4):
                self.assertFalse(set(groups[splits[a]]) & set(groups[splits[b]]))
        original = [i.copy() for i in splits[1:]]
        # Directly test dominant-group capping even if the shuffle holds that group out.
        selected = undersample(np.arange(len(rows)), groups, np.ones(len(rows)), cap=12)
        self.assertLess(len(selected), len(rows))
        self.assertLessEqual(max(np.unique(groups[selected],return_counts=True)[1]),12)
        for before, after in zip(original,splits[1:]):
            np.testing.assert_array_equal(before, after)

    def test_remote_fee_is_explicit_and_not_learned_from_addresses(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            np.savez(directory/'model.npz', images=np.zeros((1,1000),dtype=np.float32), titles=np.array([text_vector('cup')]), categories=np.array([category_vector('691110')]), quantities=np.array([1]), labels=np.array([6500]))
            (directory/'manifest.json').write_text(json.dumps({'limitations':['Source assumes base.','HS only.'], 'categoryCodes':['691110'], 'settings':{'neighbors':1,'imageWeight':.35}, 'createdAt':'synthetic','intervalRadiusKrw':1000}))
            request={'items':[{'title':'cup','quantity':1}],'category':'691110'}
            unknown=estimate(directory,request)
            self.assertIsNone(unknown['totalFeeKrw'])
            regular=estimate(directory,{**request,'remoteArea':False})
            remote=estimate(directory,{**request,'remoteArea':True})
            self.assertEqual(regular['baseFeeKrw'],6500)
            self.assertEqual(remote['totalFeeKrw']-regular['totalFeeKrw'],5000)
            self.assertEqual(regular['confidence'],'low')
            self.assertRaises(ValueError,estimate,directory,{**request,'remoteArea':'false'})


if __name__ == '__main__':
    unittest.main()
