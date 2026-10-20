"""Separate objects on a fixed counter; deliberately not a general retail detector."""
import cv2
import numpy as np


class SceneError(ValueError):
    pass


def product_regions(image, background):
    if image.size != background.size:
        raise SceneError('Camera dimensions changed. Set the empty scan area again.')
    pixels = np.asarray(image).astype(np.int16)
    base = np.asarray(background).astype(np.int16)
    height, width = pixels.shape[:2]
    # Compensate small global exposure changes using the outside border.
    difference = pixels - base
    border = np.concatenate((difference[:5].reshape(-1, 3), difference[-5:].reshape(-1, 3),
                             difference[:, :5].reshape(-1, 3), difference[:, -5:].reshape(-1, 3)))
    shift = np.median(border, axis=0)
    if np.max(np.abs(shift)) > 35:
        raise SceneError('Lighting changed too much. Set the empty scan area again.')
    mask = (np.max(np.abs(difference - shift), axis=2) > 32).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    boxes = []
    for x, y, w, h, area in stats[1:]:
        if area < width * height * .004 or min(w, h) < 18:
            continue
        if x < 3 or y < 3 or x + w > width - 3 or y + h > height - 3:
            raise SceneError('Keep every product fully inside the camera view, with gaps between items.')
        if w * h > width * height * .65:
            raise SceneError('Products are too close or the counter changed. Separate items and recalibrate if needed.')
        pad = 4
        boxes.append([max(0, int(x)-pad), max(0, int(y)-pad), min(width, int(x+w)+pad), min(height, int(y+h)+pad)])
    if len(boxes) > 10:
        raise SceneError('Too many separate regions. Show up to ten products on a clear counter.')
    # Overlapping crop rectangles commonly mean fragmented packaging or occlusion.
    for i, a in enumerate(boxes):
        for b in boxes[i+1:]:
            if min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1]):
                raise SceneError('Product regions overlap. Leave larger gaps and try again.')
    return sorted(boxes, key=lambda box: (box[1] // 40, box[0]))
