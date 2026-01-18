import * as https from 'https';
import { MultiFileProblem, GENERATION_PROMPT } from './types';

// Shared function to make OpenAI API calls
async function callOpenAIAPI(apiKey: string, prompt: string): Promise<MultiFileProblem> {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 8192,
            response_format: { type: 'json_object' }
        });

        const options: https.RequestOptions = {
            hostname: 'api.openai.com',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
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
                        reject(new Error(`OpenAI API error (${res.statusCode}): ${data}`));
                        return;
                    }

                    const response = JSON.parse(data);
                    
                    const choices = response.choices;
                    if (!choices || choices.length === 0) {
                        reject(new Error('No choices in OpenAI response'));
                        return;
                    }

                    const message = choices[0].message;
                    if (!message || !message.content) {
                        reject(new Error('No message content in OpenAI response'));
                        return;
                    }

                    const text = message.content;
                    
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
                        reject(new Error('Invalid problem structure from OpenAI'));
                        return;
                    }

                    problem.type = 'multi';

                    if (!problem.entry_file) {
                        problem.entry_file = problem.files[problem.files.length - 1].filename;
                    }

                    resolve(problem);
                } catch (error) {
                    reject(new Error(`Failed to parse OpenAI response: ${error}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`OpenAI request failed: ${error.message}`));
        });

        req.write(requestBody);
        req.end();
    });
}

export async function generateWithOpenAI(apiKey: string): Promise<MultiFileProblem> {
    return callOpenAIAPI(apiKey, GENERATION_PROMPT);
}

export async function extendWithOpenAI(apiKey: string, extensionPrompt: string): Promise<MultiFileProblem> {
    return callOpenAIAPI(apiKey, extensionPrompt);
}
