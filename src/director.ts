import { ProblemManager, Problem, isSingleFileProblem, isMultiFileProblem, FileContent } from './problemManager';

export const EXECUTE_SCENE = 'EXECUTE_SCENE';
export const NEXT_FILE = 'NEXT_FILE';

interface FileScript {
    filename: string;
    content: string;
}

export class Director {
    private problemManager: ProblemManager;
    private currentProblem: Problem | undefined;
    private isActive: boolean = false;
    
    // For single-file problems
    private script: string = '';
    private bufferIndex: number = 0;
    
    // For multi-file problems
    private fileScripts: FileScript[] = [];
    private currentFileIndex: number = 0;
    private entryFile: string = '';

    constructor(extensionPath: string) {
        this.problemManager = new ProblemManager(extensionPath);
    }

    public toggle(): boolean {
        this.isActive = !this.isActive;
        if (this.isActive && !this.currentProblem) {
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
        this.bufferIndex = 0;
        this.currentFileIndex = 0;

        if (isSingleFileProblem(problem)) {
            this.script = this.problemManager.getRunnableCodeForSingleFile(problem);
            this.fileScripts = [];
            this.entryFile = '';
            console.log(`Started new single-file scene: ${problem.task_id} - ${problem.entry_point}`);
        } else if (isMultiFileProblem(problem)) {
            this.fileScripts = problem.files.map((f: FileContent) => ({
                filename: f.filename,
                content: f.content
            }));
            this.entryFile = problem.entry_file;
            this.script = this.fileScripts[0]?.content || '';
            console.log(`Started new multi-file scene: ${problem.task_id} - ${problem.files.length} files`);
        }

        return true;
    }

    public getNextChar(): string {
        if (this.bufferIndex >= this.script.length) {
            // Current file is done
            if (this.isMultiFile() && this.currentFileIndex < this.fileScripts.length - 1) {
                // More files to type
                return NEXT_FILE;
            }
            // All files done
            return EXECUTE_SCENE;
        }

        const char = this.script[this.bufferIndex];
        this.bufferIndex++;
        return char;
    }

    public advanceToNextFile(): FileScript | undefined {
        if (!this.isMultiFile()) {
            return undefined;
        }

        this.currentFileIndex++;
        if (this.currentFileIndex >= this.fileScripts.length) {
            return undefined;
        }

        this.script = this.fileScripts[this.currentFileIndex].content;
        this.bufferIndex = 0;

        return this.fileScripts[this.currentFileIndex];
    }

    public getCurrentFile(): FileScript | undefined {
        if (this.isMultiFile() && this.currentFileIndex < this.fileScripts.length) {
            return this.fileScripts[this.currentFileIndex];
        }
        return undefined;
    }

    public getEntryFile(): string {
        return this.entryFile;
    }

    public isMultiFile(): boolean {
        return this.currentProblem ? isMultiFileProblem(this.currentProblem) : false;
    }

    public getCurrentProblem(): Problem | undefined {
        return this.currentProblem;
    }

    public getProgress(): { current: number; total: number; fileIndex: number; totalFiles: number } {
        return {
            current: this.bufferIndex,
            total: this.script.length,
            fileIndex: this.currentFileIndex,
            totalFiles: this.isMultiFile() ? this.fileScripts.length : 1
        };
    }
}
