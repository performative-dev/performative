import { ProblemManager, Problem } from './problemManager';

export const EXECUTE_SCENE = 'EXECUTE_SCENE';

export class Director {
    private problemManager: ProblemManager;
    private script: string = '';
    private bufferIndex: number = 0;
    private isActive: boolean = false;
    private currentProblem: Problem | undefined;

    constructor(extensionPath: string) {
        this.problemManager = new ProblemManager(extensionPath);
    }

    public toggle(): boolean {
        this.isActive = !this.isActive;
        if (this.isActive && this.script === '') {
            // Start first scene when toggling on
            this.startNewScene();
        }
        return this.isActive;
    }

    public getIsActive(): boolean {
        return this.isActive;
    }

    public startNewScene(): boolean {
        const problem = this.problemManager.getRandomProblem();
        if (!problem) {
            console.error('No problems available');
            return false;
        }

        this.currentProblem = problem;
        this.script = this.problemManager.getRunnableCode(problem);
        this.bufferIndex = 0;

        console.log(`Started new scene: ${problem.task_id} - ${problem.entry_point}`);
        return true;
    }

    public getNextChar(): string {
        if (this.bufferIndex >= this.script.length) {
            return EXECUTE_SCENE;
        }

        const char = this.script[this.bufferIndex];
        this.bufferIndex++;
        return char;
    }

    public getCurrentProblem(): Problem | undefined {
        return this.currentProblem;
    }

    public getProgress(): { current: number; total: number } {
        return {
            current: this.bufferIndex,
            total: this.script.length
        };
    }
}
