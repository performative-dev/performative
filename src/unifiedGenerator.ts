// Re-export types for convenience
export { 
    FileContent, 
    MultiFileProblem, 
    AIProvider,
    GENERATION_PROMPT,
    getProviderDisplayName,
    getProviderKeyPlaceholder,
    getProviderKeyUrl,
    getProviderEnvVar,
    getProviderSettingKey
} from './types';

import { AIProvider, MultiFileProblem } from './types';
import { generateWithGroq } from './groqGenerator';
import { generateWithGemini } from './geminiGenerator';
import { generateWithOpenAI } from './openaiGenerator';

export async function generateMultiFileProblem(
    provider: AIProvider,
    apiKey: string
): Promise<MultiFileProblem> {
    switch (provider) {
        case 'groq':
            return generateWithGroq(apiKey);
        case 'gemini':
            return generateWithGemini(apiKey);
        case 'openai':
            return generateWithOpenAI(apiKey);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}
