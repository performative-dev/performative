import * as fs from 'fs';
import * as path from 'path';

// Single-file problem (original format)
export interface SingleFileProblem {
    task_id: string;
    type: 'single';
    prompt: string;
    canonical_solution: string;
    test: string;
    entry_point: string;
}

// Multi-file problem (new format)
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

// Union type for all problems
export type Problem = SingleFileProblem | MultiFileProblem;

// Type guards
export function isSingleFileProblem(problem: Problem): problem is SingleFileProblem {
    return problem.type === 'single' || !('files' in problem);
}

export function isMultiFileProblem(problem: Problem): problem is MultiFileProblem {
    return problem.type === 'multi' && 'files' in problem;
}

export class ProblemManager {
    private problems: Problem[] = [];
    private extensionPath: string;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
        this.loadProblems();
    }

    private loadProblems(): void {
        const dataPath = path.join(this.extensionPath, 'data', 'HumanEval.jsonl');
        
        if (!fs.existsSync(dataPath)) {
            console.error(`Dataset not found at: ${dataPath}`);
            return;
        }

        const fileContent = fs.readFileSync(dataPath, 'utf-8');
        
        // Try to parse as JSON array first (standard JSON format)
        try {
            const parsed = JSON.parse(fileContent);
            if (Array.isArray(parsed)) {
                this.problems = parsed.map(p => this.normalizeProblem(p));
                console.log(`Loaded ${this.problems.length} problems from HumanEval dataset (JSON array format)`);
                return;
            }
        } catch {
            // Not a JSON array, try JSONL format
        }

        // Parse as JSONL (one JSON object per line)
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
            try {
                const problem = JSON.parse(line);
                this.problems.push(this.normalizeProblem(problem));
            } catch (error) {
                console.error(`Failed to parse line: ${line}`, error);
            }
        }

        console.log(`Loaded ${this.problems.length} problems from HumanEval dataset (JSONL format)`);
    }

    private normalizeProblem(raw: Record<string, unknown>): Problem {
        // If it has a 'files' array, it's a multi-file problem
        if (raw.files && Array.isArray(raw.files)) {
            return {
                task_id: raw.task_id as string,
                type: 'multi',
                description: raw.description as string || '',
                files: raw.files as FileContent[],
                entry_file: raw.entry_file as string
            };
        }
        
        // Otherwise, it's a single-file problem
        return {
            task_id: raw.task_id as string,
            type: 'single',
            prompt: raw.prompt as string,
            canonical_solution: raw.canonical_solution as string,
            test: raw.test as string,
            entry_point: raw.entry_point as string
        };
    }

    public getRandomProblem(): Problem | undefined {
        if (this.problems.length === 0) {
            return undefined;
        }
        const randomIndex = Math.floor(Math.random() * this.problems.length);
        return this.problems[randomIndex];
    }

    public getRunnableCodeForSingleFile(problem: SingleFileProblem): string {
        // Combine prompt (function signature + docstring), canonical solution, and test
        const code = `${problem.prompt}${problem.canonical_solution}

${problem.test}

# Run the tests
try:
    check(${problem.entry_point})
    print("✅ Success")
except AssertionError as e:
    print(f"❌ Failed: {e}")
except Exception as e:
    print(f"❌ Failed with error: {e}")
`;
        return code;
    }

    public getProblemCount(): number {
        return this.problems.length;
    }
}
