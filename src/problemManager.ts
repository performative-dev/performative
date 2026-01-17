import * as fs from 'fs';
import * as path from 'path';

export interface Problem {
    task_id: string;
    prompt: string;
    canonical_solution: string;
    test: string;
    entry_point: string;
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
                this.problems = parsed as Problem[];
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
                const problem = JSON.parse(line) as Problem;
                this.problems.push(problem);
            } catch (error) {
                console.error(`Failed to parse line: ${line}`, error);
            }
        }

        console.log(`Loaded ${this.problems.length} problems from HumanEval dataset (JSONL format)`);
    }

    public getRandomProblem(): Problem | undefined {
        if (this.problems.length === 0) {
            return undefined;
        }
        const randomIndex = Math.floor(Math.random() * this.problems.length);
        return this.problems[randomIndex];
    }

    public getRunnableCode(problem: Problem): string {
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
