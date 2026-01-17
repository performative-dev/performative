import * as https from 'https';
import { MultiFileProblem, GENERATION_PROMPT } from './types';

export async function generateWithGemini(apiKey: string): Promise<MultiFileProblem> {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            contents: [
                {
                    parts: [
                        {
                            text: GENERATION_PROMPT
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 4096,
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
                    
                    // Extract the text content from Gemini's response
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
                        reject(new Error('Invalid problem structure from Gemini'));
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
