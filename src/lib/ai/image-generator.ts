/**
 * Educational image generation using OpenAI DALL-E 3.
 * Generates concept illustrations for foundation content.
 * Falls back gracefully if API key not set.
 */
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads", "foundations");

function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/**
 * Generate an educational image using DALL-E 3.
 * Returns the local URL path or null if generation fails/unavailable.
 */
export async function generateEducationalImage(
  prompt: string,
  size: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024"
): Promise<string | null> {
  const openai = getOpenAI();
  if (!openai) {
    console.warn("[ImageGenerator] OPENAI_API_KEY not set, skipping image generation");
    return null;
  }

  try {
    // Enhance the prompt for educational clarity
    const enhancedPrompt = `Educational diagram for Indian school students: ${prompt}. Clean, professional, labeled, white background, simple flat illustration style. No text overlay except labels.`;

    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: enhancedPrompt,
      n: 1,
      size,
      quality: "standard",
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) return null;

    // Download and save locally
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) return null;

    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    return `/api/uploads/foundations/${filename}`;
  } catch (err) {
    console.warn(
      "[ImageGenerator] Failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Process all GENERATE_IMAGE: placeholders in markdown content.
 * Replaces ![alt](GENERATE_IMAGE: prompt) with ![alt](actual-url) or removes if generation fails.
 */
export async function processImagePlaceholders(
  content: string
): Promise<string> {
  const regex = /!\[([^\]]*)\]\(GENERATE_IMAGE:\s*([^)]+)\)/g;
  const matches = [...content.matchAll(regex)];

  if (matches.length === 0) return content;

  // Limit to 3 images per document to control cost
  const toProcess = matches.slice(0, 3);

  let result = content;
  for (const match of toProcess) {
    const [fullMatch, altText, prompt] = match;
    const imageUrl = await generateEducationalImage(prompt.trim());

    if (imageUrl) {
      result = result.replace(fullMatch, `![${altText}](${imageUrl})`);
    } else {
      // Replace with a styled placeholder description
      result = result.replace(
        fullMatch,
        `> *[Illustration: ${altText}]*`
      );
    }
  }

  // Replace any remaining GENERATE_IMAGE placeholders beyond the limit
  result = result.replace(
    /!\[([^\]]*)\]\(GENERATE_IMAGE:\s*[^)]+\)/g,
    (_match, alt) => `> *[Illustration: ${alt}]*`
  );

  return result;
}
