/**
 * Logo handling.
 *
 * The logo is stored as a data URI on the workspace row, which every member
 * pulls on every auth refresh. A raw phone photo would be several megabytes of
 * base64 travelling to every device, so files are downscaled and re-encoded
 * before they ever reach the form.
 */

/** Longest edge of the stored logo, in pixels. Plenty for a receipt header. */
const MAX_EDGE = 320;
/** Above this, fall back to JPEG — a PNG of a photographed logo is huge. */
const PNG_BUDGET = 120 * 1024;

export class ImageError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/**
 * Read a picked file into a small data URI suitable for the logo column.
 *
 * SVGs pass through untouched: they are already tiny and rasterising one would
 * throw away the resolution that makes it worth using.
 */
export async function readLogoFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new ImageError("Choose an image file (PNG, JPG or SVG).");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new ImageError("That image is over 8MB. Please pick a smaller one.");
  }

  if (file.type === "image/svg+xml") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new ImageError("That file could not be read."));
      reader.readAsDataURL(file);
    });
  }

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("This browser could not process the image.");
  ctx.drawImage(img, 0, 0, width, height);

  // PNG first, so a logo with a transparent background keeps it.
  const png = canvas.toDataURL("image/png");
  if (png.length <= PNG_BUDGET) return png;

  // Too heavy: flatten onto white and re-encode.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
