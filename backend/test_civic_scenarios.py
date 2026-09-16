import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from civic_intelligence import classify_local, find_duplicates


class ScenarioTests(unittest.TestCase):
    def test_pothole_school(self):
        r = classify_local("Pothole near school entrance")
        self.assertEqual(r["department"], "Municipal")
        self.assertEqual(r["severity"], "High")
        self.assertFalse(r["emergency"])

    def test_garbage(self):
        r = classify_local("Garbage has been piling up for 5 days")
        self.assertEqual(r["department"], "Municipal")
        self.assertIn(r["severity"], ("Medium", "High"))
        self.assertFalse(r["emergency"])

    def test_pipeline_burst(self):
        r = classify_local("Large water pipeline burst and water is flooding houses")
        self.assertEqual(r["department"], "Water")
        self.assertEqual(r["severity"], "Critical")
        self.assertTrue(r["emergency"])

    def test_transformer(self):
        r = classify_local("Transformer is sparking and smoking near crowded houses")
        self.assertEqual(r["department"], "Electricity")
        self.assertEqual(r["severity"], "Critical")
        self.assertTrue(r["emergency"])

    def test_armed_attack(self):
        r = classify_local("Someone is attacking people with a weapon")
        self.assertEqual(r["department"], "Police")
        self.assertEqual(r["severity"], "Critical")
        self.assertTrue(r["emergency"])

    def test_medical(self):
        r = classify_local("Person collapsed and is not responding")
        self.assertEqual(r["department"], "Health")
        self.assertEqual(r["severity"], "Critical")
        self.assertTrue(r["emergency"])

    def test_collapse(self):
        r = classify_local("Building has collapsed")
        self.assertEqual(r["department"], "Municipal")
        self.assertEqual(r["severity"], "Critical")
        self.assertTrue(r["emergency"])

    def test_streetlight(self):
        r = classify_local("Streetlight stopped working")
        self.assertEqual(r["department"], "Electricity")
        self.assertIn(r["severity"], ("High", "Medium"))
        self.assertFalse(r["emergency"])

    def test_does_not_claim_dispatch(self):
        r = classify_local("Someone is attacking people with a weapon")
        self.assertIn("has not contacted emergency", r["immediateAction"].lower())

    def test_duplicate_streetlight(self):
        matches = find_duplicates(
            {
                "problem": "Streetlight not working near Benz Circle",
                "department": "Electricity",
                "latitude": 16.5062,
                "longitude": 80.6480,
            },
            [
                {
                    "id": "102",
                    "problem": "Streetlight broken near Benz Circle",
                    "department": "Electricity",
                    "status": "Pending",
                    "latitude": 16.5065,
                    "longitude": 80.6482,
                }
            ],
        )
        self.assertTrue(matches)
        self.assertGreater(matches[0]["similarity"], 0.42)


if __name__ == "__main__":
    unittest.main()
