import * as https from 'https';
import { MultiFileProblem, GENERATION_PROMPT } from './types';

export async function generateWithOpenAI(apiKey: string): Promise<MultiFileProblem> {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: GENERATION_PROMPT
                }
            ],
            temperature: 0.3,
            max_tokens: 4096,
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
                    
                    // Extract the text content from OpenAI's response
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
                    
                    // Parse the JSON from the text
                    let problem: MultiFileProblem;
                    try {
                        problem = JSON.parse(text);
                    } catch {
                        // Try to extract JSON from markdown code blocks
                        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
                        if (jsonMatch) {
                            problem = JSON.parse(jsonMatch[1].trim());
                        } else {
                            // Try to find JSON object in the text
                            const jsonStart = text.indexOf('{');
                            const jsonEnd = text.lastIndexOf('}');
                            if (jsonStart !== -1 && jsonEnd !== -1) {
                                problem = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
                            } else {
                                throw new Error('Could not find valid JSON in response');
                            }
                        }
                    }

                    // Validate the problem structure
                    if (!problem.task_id || !problem.files || !Array.isArray(problem.files) || problem.files.length === 0) {
                        reject(new Error('Invalid problem structure from OpenAI'));
                        return;
                    }

                    // Ensure type is set
                    problem.type = 'multi';

                    // Ensure entry_file is set
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
