import * as https from 'https';
import { MultiFileProblem, GENERATION_PROMPT } from './types';

// Shared function to make Gemini API calls
async function callGeminiAPI(apiKey: string, prompt: string): Promise<MultiFileProblem> {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            contents: [
                {
                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 8192,
                responseMimeType: "application/json"
            }
        });

        const options: https.RequestOptions = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Gemini API error (${res.statusCode}): ${data}`));
                        return;
                    }

                    const response = JSON.parse(data);
                    
                    const candidates = response.candidates;
                    if (!candidates || candidates.length === 0) {
                        reject(new Error('No candidates in Gemini response'));
                        return;
                    }

                    const content = candidates[0].content;
                    if (!content || !content.parts || content.parts.length === 0) {
                        reject(new Error('No content parts in Gemini response'));
                        return;
                    }

                    const text = content.parts[0].text;
                    
                    let problem: MultiFileProblem;
                    try {
                        problem = JSON.parse(text);
                    } catch {
                        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
                        if (jsonMatch) {
                            problem = JSON.parse(jsonMatch[1].trim());
                        } else {
                            const jsonStart = text.indexOf('{');
                            const jsonEnd = text.lastIndexOf('}');
                            if (jsonStart !== -1 && jsonEnd !== -1) {
                                problem = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
                            } else {
                                throw new Error('Could not find valid JSON in response');
                            }
                        }
                    }

                    if (!problem.task_id || !problem.files || !Array.isArray(problem.files) || problem.files.length === 0) {
                        reject(new Error('Invalid problem structure from Gemini'));
                        return;
                    }

                    problem.type = 'multi';

                    if (!problem.entry_file) {
                        problem.entry_file = problem.files[problem.files.length - 1].filename;
                    }

                    resolve(problem);
                } catch (error) {
                    reject(new Error(`Failed to parse Gemini response: ${error}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });

        req.write(requestBody);
        req.end();
    });
}

export async function generateWithGemini(apiKey: string): Promise<MultiFileProblem> {
    return callGeminiAPI(apiKey, GENERATION_PROMPT);
}

export async function extendWithGemini(apiKey: string, extensionPrompt: string): Promise<MultiFileProblem> {
    return callGeminiAPI(apiKey, extensionPrompt);
}
