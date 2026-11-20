import sys, os
if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'): sys.stderr.reconfigure(encoding='utf-8')

import unittest
from pymongo import MongoClient

class TestComplaintsBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mongo_uri = os.getenv('MONGODB_URI', 'mongodb://127.0.0.1:27017/rushwash')
        cls.client = MongoClient(cls.mongo_uri, serverSelectionTimeoutMS=2000)
        cls.db = cls.client.rushwash

    def test_local_mongo_connection(self):
        """Strict Database Safety: Verify connection is strictly local rushwash"""
        self.assertIn('127.0.0.1', self.mongo_uri)
        collections = self.db.list_collection_names()
        self.assertIn('rushwash_wash_histories', collections)
        self.assertIn('rushwash_sale_orders', collections)
        print("✓ Verified local MongoDB rushwash connection and collections.")

    def test_wash_histories_query(self):
        """Verify queries against rushwash_wash_histories for recent washes"""
        sample_wash = self.db.rushwash_wash_histories.find_one({}, {'_id': 1, 'normalizedPlate': 1, 'customerSnapshot': 1, 'washDate': 1})
        self.assertIsNotNone(sample_wash)
        print(f"✓ Found sample wash history: ID={sample_wash.get('_id')}, Plate={sample_wash.get('normalizedPlate')}")

    def test_complaints_collection_indexing(self):
        """Verify rushwash_complaints collection and indexes"""
        # Ensure collection exists
        self.db.rushwash_complaints.create_index('ticketCode', unique=True)
        self.db.rushwash_complaints.create_index('normalizedPlate')
        self.db.rushwash_complaints.create_index('phone')
        self.db.rushwash_complaints.create_index('status')
        print("✓ Verified rushwash_complaints indexes created.")

if __name__ == '__main__':
    unittest.main()
