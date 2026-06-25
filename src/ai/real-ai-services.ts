import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { AIServices } from '../engine/index';
import { GeminiImageService, type GenAiImageClient } from './gemini-image-service';
import { ClaudeCaptionService, type ClaudeMessagesClient } from './claude-caption-service';

export interface RealAIEnv {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CAPTION_MODEL?: string;
  IMAGE_MODEL?: string;
}

export function createRealAIServices(env: RealAIEnv = process.env): AIServices {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  return {
    // The SDK clients are broader than our minimal interfaces; cast at this boundary only.
    image: new GeminiImageService(genai as unknown as GenAiImageClient, { model: env.IMAGE_MODEL }),
    caption: new ClaudeCaptionService(anthropic as unknown as ClaudeMessagesClient, {
      model: env.CAPTION_MODEL ?? 'claude-haiku-4-5',
    }),
  };
}
