// Re-export types for convenience
export { 
    FileContent, 
    MultiFileProblem, 
    AIProvider,
    GENERATION_PROMPT,
    FileDiff,
    ProjectDiff,
    generateProjectDiff,
    getExtensionPrompt,
    getProviderDisplayName,
    getProviderKeyPlaceholder,
    getProviderKeyUrl,
    getProviderEnvVar,
    getProviderSettingKey
} from './types';

import { AIProvider, MultiFileProblem, getExtensionPrompt } from './types';
import { generateWithGroq, extendWithGroq } from './groqGenerator';
import { generateWithGemini, extendWithGemini } from './geminiGenerator';
import { generateWithOpenAI, extendWithOpenAI } from './openaiGenerator';

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

export async function extendProject(
    provider: AIProvider,
    apiKey: string,
    currentProject: MultiFileProblem,
    copilotSuggestion: string
): Promise<MultiFileProblem> {
    const prompt = getExtensionPrompt(currentProject, copilotSuggestion);
    
    switch (provider) {
        case 'groq':
            return extendWithGroq(apiKey, prompt);
        case 'gemini':
            return extendWithGemini(apiKey, prompt);
        case 'openai':
            return extendWithOpenAI(apiKey, prompt);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}
