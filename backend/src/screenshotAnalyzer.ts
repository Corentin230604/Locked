import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

export interface ScreenshotAnalysis {
  anomaly: boolean;
  confidence: number;
  reason: string;
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    anomaly: {
      type: "boolean",
      description:
        "true if the screenshot shows anything inconsistent with a student working in fullscreen Excel during an exam",
    },
    confidence: {
      type: "number",
      description: "confidence from 0 to 1 that this is a genuine anomaly",
    },
    reason: {
      type: "string",
      description: "brief explanation, in French, of what was observed",
    },
  },
  required: ["anomaly", "confidence", "reason"],
  additionalProperties: false,
} as const;

const PROMPT =
  "Ceci est une capture d'écran prise pendant un examen surveillé. L'étudiant doit avoir " +
  "Excel affiché en plein écran, sans autre fenêtre, boîte de dialogue, navigateur ou " +
  "application visible. Indique si cette capture est cohérente avec ce contexte, ou si elle " +
  "montre un signe d'anomalie (autre application, navigateur, boîte de dialogue d'ouverture " +
  "de fichier, contenu suspect, etc.).";

let client: Anthropic | null | undefined;

function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  if (!client) {
    console.warn(
      "ANTHROPIC_API_KEY is not set — screenshot AI analysis is disabled."
    );
  }
  return client;
}

/**
 * Best-effort vision-model check of one screenshot. Returns null (rather than
 * throwing) when the API key is missing or the call fails, so a flaky/absent
 * AI layer never interrupts the exam or the upload endpoint.
 */
export async function analyzeScreenshot(
  imagePath: string
): Promise<ScreenshotAnalysis | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const imageData = fs.readFileSync(imagePath).toString("base64");
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imageData },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") return null;
    return JSON.parse(block.text) as ScreenshotAnalysis;
  } catch (err) {
    console.error("Screenshot analysis failed:", err);
    return null;
  }
}
