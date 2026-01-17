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

// Diff types for extension workflow
export interface FileDiff {
    filename: string;
    action: 'delete' | 'create' | 'modify';
    oldContent?: string;
    newContent: string;
}

export interface ProjectDiff {
    description: string;
    fileDiffs: FileDiff[];
}

// Generate a diff between old and new project files
export function generateProjectDiff(
    oldFiles: FileContent[],
    newFiles: FileContent[]
): FileDiff[] {
    const diffs: FileDiff[] = [];
    const oldFileMap = new Map(oldFiles.map(f => [f.filename, f.content]));
    const newFileMap = new Map(newFiles.map(f => [f.filename, f.content]));

    // Check for modified or deleted files
    for (const [filename, oldContent] of oldFileMap) {
        const newContent = newFileMap.get(filename);
        if (newContent === undefined) {
            // File was deleted
            diffs.push({
                filename,
                action: 'delete',
                oldContent,
                newContent: ''
            });
        } else if (newContent !== oldContent) {
            // File was modified
            diffs.push({
                filename,
                action: 'modify',
                oldContent,
                newContent
            });
        }
        // If content is same, no diff needed
    }

    // Check for new files
    for (const [filename, newContent] of newFileMap) {
        if (!oldFileMap.has(filename)) {
            diffs.push({
                filename,
                action: 'create',
                newContent
            });
        }
    }

    return diffs;
}

// Prompt for extending an existing project based on Copilot's suggestion
export function getExtensionPrompt(
    currentProject: MultiFileProblem,
    copilotSuggestion: string
): string {
    const filesDescription = currentProject.files
        .map(f => `- ${f.filename}`)
        .join('\n');

    return `You are extending an existing Python project. Here is the current project:

PROJECT: ${currentProject.description}
TASK ID: ${currentProject.task_id}

CURRENT FILES:
${filesDescription}

CURRENT CODE:
${currentProject.files.map(f => `=== ${f.filename} ===\n${f.content}`).join('\n\n')}

EXTENSION REQUEST FROM USER:
${copilotSuggestion}

Generate the UPDATED multi-file Python project as valid JSON.

REQUIREMENTS:
- Implement the extension described above
- Keep existing functionality working
- Use only Python standard library (no pip packages)
- The main.py file must end with: print("Success")
- Code must be complete and runnable
- Include ALL files (both modified and unmodified)

Return JSON in this exact format:
{
  "task_id": "${currentProject.task_id}",
  "type": "multi",
  "description": "Extended: ${currentProject.description} - [brief description of extension]",
  "files": [
    {"filename": "file.py", "content": "..."},
    ...
  ],
  "entry_file": "main.py"
}

CRITICAL JSON RULES:
- Use \\n for newlines inside content strings
- Use \\" for quotes inside content strings  
- Do NOT use triple quotes or multi-line strings
- Content must be a single-line JSON string value
- Return ONLY the JSON object, nothing else`;
}
