"""Geometry checks only; these are not real-camera accuracy measurements."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from PIL import Image, ImageDraw
from scene_regions import product_regions, SceneError


class CounterRegionsTest(unittest.TestCase):
    def setUp(self):
        self.background = Image.new('RGB', (640, 480), '#eeeeee')

    def test_empty_and_small_exposure_shift(self):
        self.assertEqual(product_regions(self.background, self.background), [])
        self.assertEqual(product_regions(Image.new('RGB', (640, 480), '#f8f8f8'), self.background), [])

    def test_three_and_five_separated_products(self):
        for count in (3, 5):
            image = self.background.copy()
            draw = ImageDraw.Draw(image)
            for i in range(count):
                x = 20 + i * 120
                draw.rectangle((x, 100, x+70, 280), fill='#b32028')
            boxes = product_regions(image, self.background)
            self.assertEqual(len(boxes), count)
            for i, (x1, y1, x2, y2) in enumerate(boxes):
                self.assertLessEqual(x1, 20+i*120)
                self.assertGreaterEqual(x2, 90+i*120)

    def test_changed_camera_dimensions_and_lighting(self):
        with self.assertRaises(SceneError):
            product_regions(Image.new('RGB', (320, 240)), self.background)
        with self.assertRaises(SceneError):
            product_regions(Image.new('RGB', (640, 480), '#222222'), self.background)

    def test_cut_off_product_rejected(self):
        image = self.background.copy()
        ImageDraw.Draw(image).rectangle((0, 40, 120, 220), fill='red')
        with self.assertRaises(SceneError):
            product_regions(image, self.background)

    def test_small_noise_is_not_counted(self):
        image = self.background.copy()
        draw = ImageDraw.Draw(image)
        for x in range(20, 620, 20):
            draw.rectangle((x, 20, x+2, 22), fill='black')
        self.assertEqual(product_regions(image, self.background), [])


if __name__ == '__main__':
    unittest.main()
