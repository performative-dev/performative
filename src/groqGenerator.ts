import * as https from 'https';

export interface FileContent {
    filename: string;
    content: string;
}

export interface MultiFileProblem {
    task_id: string;
    type: 'multi';
    description: string;
    files: FileContent[];
    entry_file: string;
}

const GENERATION_PROMPT = `Generate a multi-file Python project as valid JSON.

REQUIREMENTS:
- Create 3 Python files that work together
- Use only Python standard library (no pip packages)
- The main.py file must end with: print("Success")
- Code must be complete and runnable

PICK ONE PROJECT TYPE:
- Todo list manager
- Calculator with operations
- Simple key-value store
- Recipe manager
- Playlist manager
- Task scheduler
- Event system

EXAMPLE of valid JSON output:
{
  "task_id": "Generated/todo-app",
  "type": "multi",
  "description": "A todo list manager",
  "files": [
    {"filename": "models.py", "content": "class Item:\\n    def __init__(self, name):\\n        self.name = name\\n"},
    {"filename": "store.py", "content": "from models import Item\\n\\nclass Store:\\n    def __init__(self):\\n        self.items = []\\n"},
    {"filename": "main.py", "content": "from store import Store\\n\\ndef main():\\n    s = Store()\\n    print(\\"Success\\")\\n\\nif __name__ == \\"__main__\\":\\n    main()\\n"}
  ],
  "entry_file": "main.py"
}

CRITICAL JSON RULES:
- Use \\n for newlines inside content strings
- Use \\" for quotes inside content strings  
- Do NOT use triple quotes or multi-line strings
- Content must be a single-line JSON string value
- Return ONLY the JSON object, nothing else`;

export async function generateMultiFileProblem(apiKey: string): Promise<MultiFileProblem> {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            model: 'llama-3.3-70b-versatile',
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
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
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
                        reject(new Error(`Groq API error (${res.statusCode}): ${data}`));
                        return;
                    }

                    const response = JSON.parse(data);
                    
                    // Extract the text content from Groq's OpenAI-compatible response
                    const choices = response.choices;
                    if (!choices || choices.length === 0) {
                        reject(new Error('No choices in Groq response'));
                        return;
                    }

                    const message = choices[0].message;
                    if (!message || !message.content) {
                        reject(new Error('No message content in Groq response'));
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
                        reject(new Error('Invalid problem structure from Groq'));
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
                    reject(new Error(`Failed to parse Groq response: ${error}`));
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
