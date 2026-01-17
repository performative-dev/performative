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

export type AIProvider = 'groq' | 'gemini' | 'openai';

export const GENERATION_PROMPT = `Generate a multi-file Python project as valid JSON.

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

export function getProviderDisplayName(provider: AIProvider): string {
    switch (provider) {
        case 'groq':
            return 'Groq (Llama 3.3 70B)';
        case 'gemini':
            return 'Google Gemini 2.0 Flash';
        case 'openai':
            return 'OpenAI (GPT-4o mini)';
        default:
            return provider;
    }
}

export function getProviderKeyPlaceholder(provider: AIProvider): string {
    switch (provider) {
        case 'groq':
            return 'gsk_...';
        case 'gemini':
            return 'AIza...';
        case 'openai':
            return 'sk-...';
        default:
            return '';
    }
}

export function getProviderKeyUrl(provider: AIProvider): string {
    switch (provider) {
        case 'groq':
            return 'https://console.groq.com/keys';
        case 'gemini':
            return 'https://aistudio.google.com/apikey';
        case 'openai':
            return 'https://platform.openai.com/api-keys';
        default:
            return '';
    }
}

export function getProviderEnvVar(provider: AIProvider): string {
    switch (provider) {
        case 'groq':
            return 'GROQ_API_KEY';
        case 'gemini':
            return 'GEMINI_API_KEY';
        case 'openai':
            return 'OPENAI_API_KEY';
        default:
            return '';
    }
}

export function getProviderSettingKey(provider: AIProvider): string {
    switch (provider) {
        case 'groq':
            return 'groqApiKey';
        case 'gemini':
            return 'geminiApiKey';
        case 'openai':
            return 'openaiApiKey';
        default:
            return '';
    }
}
