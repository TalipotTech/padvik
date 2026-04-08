/**
 * Client-side image compression utility.
 * Resizes images to max 1920px and compresses to JPEG 0.85 quality.
 * Used before uploading handwritten notes and exam answer photos.
 */

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.85;

/**
 * Compress an image file client-side using Canvas.
 * @param file - The image File from input or camera
 * @returns Compressed Blob and base64 string
 */
export async function compressImage(file: File): Promise<{ blob: Blob; base64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;

        // Scale down if larger than MAX_DIMENSION
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas not supported")); return; }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error("Compression failed")); return; }
            // Convert to base64 for AI processing
            const base64Reader = new FileReader();
            base64Reader.onload = () => {
              const base64 = (base64Reader.result as string).split(",")[1]; // Remove data:image/jpeg;base64, prefix
              resolve({ blob, base64, width, height });
            };
            base64Reader.onerror = reject;
            base64Reader.readAsDataURL(blob);
          },
          "image/jpeg",
          JPEG_QUALITY
        );
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
