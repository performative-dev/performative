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

    // Per-file buffer tracking for random switching
    private fileBufferIndices: number[] = [];

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
            this.fileBufferIndices = [];
            this.entryFile = '';
            console.log(`Started new single-file scene: ${problem.task_id} - ${problem.entry_point}`);
        } else if (isMultiFileProblem(problem)) {
            this.fileScripts = problem.files.map((f: FileContent) => ({
                filename: f.filename,
                content: f.content
            }));
            this.fileBufferIndices = this.fileScripts.map(() => 0); // Initialize all to 0
            this.entryFile = problem.entry_file;
            this.script = this.fileScripts[0]?.content || '';
            console.log(`Started new multi-file scene: ${problem.task_id} - ${problem.files.length} files`);
        }

        return true;
    }

    public getNextChar(): string {
        if (this.isMultiFile()) {
            // Use per-file buffer tracking
            const currentIndex = this.fileBufferIndices[this.currentFileIndex];
            if (currentIndex >= this.script.length) {
                // Current file is done, check if all files are done
                if (this.areAllFilesComplete()) {
                    return EXECUTE_SCENE;
                }
                // Current file done but others remain - signal to switch
                return NEXT_FILE;
            }

            const char = this.script[currentIndex];
            this.fileBufferIndices[this.currentFileIndex]++;
            return char;
        } else {
            // Single file mode - use simple buffer
            if (this.bufferIndex >= this.script.length) {
                return EXECUTE_SCENE;
            }

            const char = this.script[this.bufferIndex];
            this.bufferIndex++;
            return char;
        }
    }

    public areAllFilesComplete(): boolean {
        if (!this.isMultiFile()) {
            return this.bufferIndex >= this.script.length;
        }
        return this.fileScripts.every((file, index) =>
            this.fileBufferIndices[index] >= file.content.length
        );
    }

    public isCurrentFileComplete(): boolean {
        if (this.isMultiFile()) {
            return this.fileBufferIndices[this.currentFileIndex] >= this.script.length;
        }
        return this.bufferIndex >= this.script.length;
    }

    public getIncompleteFileIndices(): number[] {
        if (!this.isMultiFile()) {
            return [];
        }
        return this.fileScripts
            .map((file, index) => ({ index, complete: this.fileBufferIndices[index] >= file.content.length }))
            .filter(f => !f.complete)
            .map(f => f.index);
    }

    public switchToFile(fileIndex: number): FileScript | undefined {
        if (!this.isMultiFile() || fileIndex < 0 || fileIndex >= this.fileScripts.length) {
            return undefined;
        }

        this.currentFileIndex = fileIndex;
        this.script = this.fileScripts[fileIndex].content;
        console.log(`Switched to file ${fileIndex}: ${this.fileScripts[fileIndex].filename} (at char ${this.fileBufferIndices[fileIndex]}/${this.script.length})`);
        return this.fileScripts[fileIndex];
    }

    public switchToRandomIncompleteFile(): FileScript | undefined {
        const incompleteIndices = this.getIncompleteFileIndices();
        if (incompleteIndices.length === 0) {
            return undefined;
        }

        // Pick a random incomplete file (different from current if possible)
        let candidates = incompleteIndices.filter(i => i !== this.currentFileIndex);
        if (candidates.length === 0) {
            candidates = incompleteIndices; // Only current file left
        }

        const randomIndex = candidates[Math.floor(Math.random() * candidates.length)];
        return this.switchToFile(randomIndex);
    }

    public advanceToNextFile(): FileScript | undefined {
        // Use random switching instead of sequential
        return this.switchToRandomIncompleteFile();
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
        const current = this.isMultiFile()
            ? this.fileBufferIndices[this.currentFileIndex]
            : this.bufferIndex;
        return {
            current,
            total: this.script.length,
            fileIndex: this.currentFileIndex,
            totalFiles: this.isMultiFile() ? this.fileScripts.length : 1
        };
    }

    public isAtLineEnd(): boolean {
        // Check if the last character we typed was a newline (safe to switch files)
        const current = this.isMultiFile()
            ? this.fileBufferIndices[this.currentFileIndex]
            : this.bufferIndex;

        if (current === 0) {
            return true; // Start of file is safe
        }

        return this.script[current - 1] === '\n';
    }

    public setGeneratedProblem(problem: Problem): void {
        // Set the generated problem in the problem manager
        this.problemManager.setActiveGeneratedProblem(problem);
        // Reset state so the next toggle/startNewScene uses this problem
        this.currentProblem = undefined;
        this.script = '';
        this.bufferIndex = 0;
        this.fileScripts = [];
        this.currentFileIndex = 0;
        console.log(`Set generated problem: ${problem.task_id}`);
    }
}
