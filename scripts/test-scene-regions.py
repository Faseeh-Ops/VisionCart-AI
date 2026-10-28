"""Geometry checks only; these are not real-camera accuracy measurements."""
import sys
import unittest
from pathlib import Path
import numpy as np
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

    def test_partial_product_can_be_skipped_without_losing_complete_products(self):
        image = self.background.copy()
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 40, 120, 220), fill='red')
        draw.rectangle((260, 100, 400, 300), fill='blue')
        boxes, details = product_regions(image, self.background, allow_partial=True,
                                         return_details=True)
        self.assertEqual(len(boxes), 1)
        self.assertEqual(details['skippedEdgeRegions'], 1)
        self.assertLessEqual(boxes[0][0], 260)
        self.assertGreaterEqual(boxes[0][2], 400)

    def test_small_noise_is_not_counted(self):
        image = self.background.copy()
        draw = ImageDraw.Draw(image)
        for x in range(20, 620, 20):
            draw.rectangle((x, 20, x+2, 22), fill='black')
        self.assertEqual(product_regions(image, self.background), [])

    def test_textured_counter_is_aligned_before_separating_products(self):
        y, x = np.indices((480, 640))
        texture = np.stack(((x*7+y*3)%180+35, (x*5+y*11)%170+45,
                            (x*13+y*2)%160+55), axis=2).astype(np.uint8)
        background = Image.fromarray(texture)
        shifted = np.roll(texture, shift=(3, -4), axis=(0, 1))
        empty_shifted = Image.fromarray(shifted)
        self.assertEqual(product_regions(empty_shifted, background), [])
        scene = empty_shifted.copy()
        draw = ImageDraw.Draw(scene)
        draw.rectangle((100, 110, 220, 330), fill='#a82028')
        draw.rectangle((390, 90, 520, 320), fill='#303ca8')
        boxes = product_regions(scene, background)
        self.assertEqual(len(boxes), 2)

    def test_disconnected_fragments_inside_one_wrapper_are_merged(self):
        image = self.background.copy()
        draw = ImageDraw.Draw(image)
        draw.rectangle((120, 80, 300, 340), outline='#a82028', width=28)
        draw.rectangle((175, 155, 245, 265), fill='#303ca8')
        boxes = product_regions(image, self.background)
        self.assertEqual(len(boxes), 1)
        self.assertLessEqual(boxes[0][0], 120)
        self.assertGreaterEqual(boxes[0][2], 300)


if __name__ == '__main__':
    unittest.main()
