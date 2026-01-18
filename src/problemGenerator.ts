/**
 * Problem Generator - Creates random, open-ended coding problems
 */

export interface ProblemTemplate {
    name: string;
    description: string;
    complexity: 'simple' | 'medium' | 'complex';
}

// Collection of generic, open-ended problem templates
const PROBLEM_TEMPLATES: ProblemTemplate[] = [
    {
        name: 'Todo List Application',
        description: 'A command-line todo list manager with add, remove, list, and mark complete functionality',
        complexity: 'simple'
    },
    {
        name: 'Contact Manager',
        description: 'A contact management system to store, search, update, and delete contacts with name, email, and phone',
        complexity: 'simple'
    },
    {
        name: 'Note Taking App',
        description: 'A simple note-taking application with create, edit, delete, search, and tag functionality',
        complexity: 'medium'
    },
    {
        name: 'Expense Tracker',
        description: 'Track personal expenses with categories, dates, and generate summary reports',
        complexity: 'medium'
    },
    {
        name: 'URL Shortener',
        description: 'A URL shortening service with custom short codes, expiration, and statistics tracking',
        complexity: 'medium'
    },
    {
        name: 'Habit Tracker',
        description: 'Track daily habits, mark completions, and view streaks and statistics',
        complexity: 'simple'
    },
    {
        name: 'Simple Blog Engine',
        description: 'A basic blog with posts, comments, categories, and search functionality',
        complexity: 'complex'
    },
    {
        name: 'Quiz Application',
        description: 'A quiz system with multiple-choice questions, scoring, and result tracking',
        complexity: 'medium'
    },
    {
        name: 'Library Management System',
        description: 'Manage books, borrowers, checkouts, returns, and overdue tracking',
        complexity: 'complex'
    },
    {
        name: 'Weather Dashboard',
        description: 'Display weather data with forecasts, historical data, and location management',
        complexity: 'medium'
    },
    {
        name: 'Password Manager',
        description: 'Securely store and retrieve passwords with categories and encryption',
        complexity: 'complex'
    },
    {
        name: 'File Organizer',
        description: 'Automatically organize files by type, date, or custom rules',
        complexity: 'medium'
    },
    {
        name: 'Markdown Previewer',
        description: 'Convert markdown to HTML with live preview and export functionality',
        complexity: 'simple'
    },
    {
        name: 'Chat Application',
        description: 'A simple chat system with rooms, users, and message history',
        complexity: 'complex'
    },
    {
        name: 'Recipe Manager',
        description: 'Store recipes with ingredients, instructions, ratings, and search',
        complexity: 'medium'
    }
];

export class ProblemGenerator {
    /**
     * Get a random problem template
     */
    static getRandomTemplate(): ProblemTemplate {
        const randomIndex = Math.floor(Math.random() * PROBLEM_TEMPLATES.length);
        return PROBLEM_TEMPLATES[randomIndex];
    }

    /**
     * Generate a detailed prompt for GPT to create a multi-file coding problem
     */
    static generatePromptForGPT(template: ProblemTemplate): string {
        return `Generate a complete, working Python project for: ${template.name}

Description: ${template.description}

Requirements:
1. Create a multi-file Python project with proper structure
2. Include 3-5 Python files (no more than 5)
3. Use clean, well-commented code with docstrings
4. Include a main entry file that demonstrates the functionality
5. Include unit tests using pytest
6. Make the code actually runnable and functional
7. Use only Python standard library (no external dependencies except pytest)
8. Keep files reasonably sized (100-300 lines each)

Return your response in this EXACT JSON format (valid JSON only, no markdown):
{
  "task_id": "generated_problem_<random_number>",
  "type": "multi",
  "description": "<brief description of what the project does>",
  "entry_file": "main.py",
  "files": [
    {
      "filename": "main.py",
      "content": "<complete python code>"
    },
    {
      "filename": "module1.py",
      "content": "<complete python code>"
    },
    {
      "filename": "test_module1.py",
      "content": "<complete python code with pytest tests>"
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown code blocks or extra text
- Ensure all strings are properly escaped for JSON
- Include complete, runnable code in each file
- The main.py should have example usage that runs when executed
- Include at least one test file with actual tests`;
    }

    /**
     * Get a simple prompt for requesting a coding problem
     */
    static getSimplePrompt(): string {
        const template = this.getRandomTemplate();
        return this.generatePromptForGPT(template);
    }
}
