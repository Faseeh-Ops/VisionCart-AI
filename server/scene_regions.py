"""Separate objects on a fixed counter; deliberately not a general retail detector."""
import cv2
import numpy as np


class SceneError(ValueError):
    pass


def align_background(pixels, base):
    """Align small camera translations/rotations before foreground subtraction."""
    gray_pixels = cv2.cvtColor(pixels.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    gray_base = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    detector = cv2.ORB_create(nfeatures=1000, fastThreshold=8)
    base_points, base_descriptors = detector.detectAndCompute(gray_base, None)
    pixel_points, pixel_descriptors = detector.detectAndCompute(gray_pixels, None)
    if base_descriptors is None or pixel_descriptors is None:
        return base
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(base_descriptors, pixel_descriptors, k=2)
    matches = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .75 * pair[1].distance]
    if len(matches) < 12:
        return base
    source = np.float32([base_points[item.queryIdx].pt for item in matches])
    target = np.float32([pixel_points[item.trainIdx].pt for item in matches])
    transform, inliers = cv2.estimateAffinePartial2D(source, target, method=cv2.RANSAC,
                                                     ransacReprojThreshold=3.0)
    if transform is None or inliers is None or int(inliers.sum()) < 8:
        return base
    height, width = pixels.shape[:2]
    return cv2.warpAffine(base.astype(np.uint8), transform, (width, height),
                          flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).astype(np.int16)


def merge_overlapping_boxes(boxes):
    """Combine disconnected wrapper fragments that belong to one product."""
    merged = [list(box) for box in boxes]
    changed = True
    while changed:
        changed = False
        result = []
        while merged:
            current = merged.pop(0)
            index = 0
            while index < len(merged):
                other = merged[index]
                overlaps = (min(current[2], other[2]) > max(current[0], other[0]) and
                            min(current[3], other[3]) > max(current[1], other[1]))
                if overlaps:
                    current = [min(current[0], other[0]), min(current[1], other[1]),
                               max(current[2], other[2]), max(current[3], other[3])]
                    merged.pop(index)
                    changed = True
                else:
                    index += 1
            result.append(current)
        merged = result
    return merged


def product_regions(image, background, allow_partial=False, return_details=False):
    if image.size != background.size:
        raise SceneError('Camera dimensions changed. Set the empty scan area again.')
    pixels = np.asarray(image).astype(np.int16)
    base = np.asarray(background).astype(np.int16)
    height, width = pixels.shape[:2]
    base = align_background(pixels, base)
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
    skipped_edge_regions = 0
    for x, y, w, h, area in stats[1:]:
        if area < width * height * .004 or min(w, h) < 18:
            continue
        if x < 3 or y < 3 or x + w > width - 3 or y + h > height - 3:
            if allow_partial:
                skipped_edge_regions += 1
                continue
            raise SceneError('Keep every product fully inside the camera view, with gaps between items.')
        if w * h > width * height * .65:
            raise SceneError('Products are too close or the counter changed. Separate items and recalibrate if needed.')
        pad = 4
        boxes.append([max(0, int(x)-pad), max(0, int(y)-pad), min(width, int(x+w)+pad), min(height, int(y+h)+pad)])
    boxes = merge_overlapping_boxes(boxes)
    if len(boxes) > 10:
        raise SceneError('Too many separate regions. Show up to ten products on a clear counter.')
    boxes = sorted(boxes, key=lambda box: (box[1] // 40, box[0]))
    if return_details:
        return boxes, {'skippedEdgeRegions': skipped_edge_regions}
    return boxes
