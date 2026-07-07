export interface PreprocessResult {
  original: string;
  processed: string;
  appliedFilters: string[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function getCanvas(img: HTMLImageElement): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return [c, ctx];
}

/** Auto-crop: detect document region by finding the tightest bounding box around non-background content */
export async function autoCrop(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const [c, ctx] = getCanvas(img);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);

  // Sample edge pixels to determine background color (median of edge pixels)
  const edgePixels: number[] = [];
  const sampleStep = 3;
  for (let x = 0; x < width; x += sampleStep) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      edgePixels.push(data[i] + data[i + 1] + data[i + 2]);
    }
  }
  for (let y = 0; y < height; y += sampleStep) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      edgePixels.push(data[i] + data[i + 1] + data[i + 2]);
    }
  }
  edgePixels.sort((a, b) => a - b);
  const bgBrightness = edgePixels[Math.floor(edgePixels.length / 2)] / 3;

  let minX = width, minY = height, maxX = 0, maxY = 0;
  const step = 2;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (Math.abs(brightness - bgBrightness) > 25) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX >= maxX || minY >= maxY) return dataUrl;

  // Add padding
  const pad = Math.round(Math.min(width, height) * 0.02);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width, maxX + pad);
  maxY = Math.min(height, maxY + pad);

  const cropW = maxX - minX;
  const cropH = maxY - minY;
  if (cropW < 50 || cropH < 50) return dataUrl;

  const out = document.createElement("canvas");
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext("2d")!;
  octx.drawImage(img, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  return out.toDataURL("image/jpeg", 0.92);
}

/** Analyze image and apply smart filters */
export async function smartFilter(dataUrl: string): Promise<{ dataUrl: string; applied: string[] }> {
  const img = await loadImage(dataUrl);
  const [c, ctx] = getCanvas(img);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const { data, width, height } = imageData;
  const total = width * height;
  const step = 3;
  const applied: string[] = [];

  // Compute histogram and statistics
  let sumBrightness = 0;
  const hist = new Array(256).fill(0);
  let minB = 255, maxB = 0;
  let darkCount = 0, lightCount = 0, colorCount = 0;

  for (let i = 0; i < data.length; i += step * 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const brightness = (r + g + b) / 3;
    sumBrightness += brightness;
    const gray = Math.round(brightness);
    hist[gray]++;
    if (gray < minB) minB = gray;
    if (gray > maxB) maxB = gray;
    if (brightness < 60) darkCount++;
    if (brightness > 200) lightCount++;
    if (Math.abs(r - g) > 15 || Math.abs(g - b) > 15 || Math.abs(r - b) > 15) colorCount++;
  }

  const sampled = Math.floor(total / (step * step));
  const avgBrightness = sumBrightness / sampled;
  const counts = sampled;

  // 1. Grayscale if image is mostly grayscale (low color variance)
  const isMostlyGrayscale = (colorCount / counts) < 0.1;

  // 2. Binarize if high contrast (bimodal histogram) or very dark text on light bg
  const contrast = maxB - minB;
  const isHighContrast = contrast > 120;
  const isLowBrightness = avgBrightness < 100;
  const isVeryDark = darkCount / counts > 0.4 && lightCount / counts > 0.2;

  // 3. Brightness/Contrast adjustment
  let autoBrightness = 1.0;
  let autoContrast = 1.0;

  if (isLowBrightness && !isVeryDark) {
    autoBrightness = 1.3;
    applied.push("brightness+");
  }
  if (contrast < 100) {
    autoContrast = 1.4;
    applied.push("contrast+");
  }

  // Apply filters
  if (isHighContrast && isVeryDark) {
    // Binarize using simple threshold
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const val = gray > 128 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = val;
    }
    applied.push("binarize");
  } else if (isMostlyGrayscale) {
    // Apply grayscale + contrast
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      let val = (gray - 128) * autoContrast + 128;
      val = val * autoBrightness;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, val));
    }
    if (!applied.includes("brightness+") && autoBrightness !== 1.0) applied.push("brightness+");
    if (!applied.includes("contrast+") && autoContrast !== 1.0) applied.push("contrast+");
  } else {
    // Apply brightness/contrast to color image
    for (let i = 0; i < data.length; i += 4) {
      for (let j = 0; j < 3; j++) {
        let val = (data[i + j] - 128) * autoContrast + 128;
        val = val * autoBrightness;
        data[i + j] = Math.max(0, Math.min(255, val));
      }
    }
    if (!applied.includes("brightness+") && autoBrightness !== 1.0) applied.push("brightness+");
    if (!applied.includes("contrast+") && autoContrast !== 1.0) applied.push("contrast+");
  }

  ctx.putImageData(imageData, 0, 0);
  const url = c.toDataURL("image/jpeg", 0.9);

  return { dataUrl: url, applied: applied.length > 0 ? applied : ["none needed"] };
}

/** Resize and compress image to reduce token usage */
export async function optimizeImage(dataUrl: string, maxDimension = 1024, quality = 0.8): Promise<string> {
  const img = await loadImage(dataUrl);
  let { naturalWidth: w, naturalHeight: h } = img;

  if (w > maxDimension || h > maxDimension) {
    const ratio = Math.min(maxDimension / w, maxDimension / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

/** Full preprocessing pipeline: crop → filter → optimize */
export async function preprocessImage(dataUrl: string): Promise<PreprocessResult> {
  const appliedFilters: string[] = [];

  let current = dataUrl;

  current = await autoCrop(current);
  appliedFilters.push("auto-crop");

  const filtered = await smartFilter(current);
  current = filtered.dataUrl;
  appliedFilters.push(...filtered.applied);

  current = await optimizeImage(current);
  appliedFilters.push("resize");

  return { original: dataUrl, processed: current, appliedFilters };
}
