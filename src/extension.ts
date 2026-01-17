import * as vscode from 'vscode';
import * as path from 'path';
import { Director, EXECUTE_SCENE, NEXT_FILE } from './director';
import { 
	generateMultiFileProblem, 
	AIProvider, 
	getProviderDisplayName, 
	getProviderKeyPlaceholder, 
	getProviderKeyUrl,
	getProviderEnvVar,
	getProviderSettingKey
} from './unifiedGenerator';

let director: Director | undefined;
let typeCommandDisposable: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

// Debug output channel
let outputChannel: vscode.OutputChannel;

// Lock to prevent race conditions with rapid typing
let isProcessingKeystroke = false;
let keystrokeQueue: Array<() => Promise<void>> = [];

// Store original settings to restore later
let originalSettings: Map<string, unknown> = new Map();

// Track the working directory for multi-file projects
let workingDirectory: string | undefined;

// Auto-type mode variables
let autoTypeInterval: NodeJS.Timeout | undefined;
let isAutoTypeMode = false;
let autoTypeSpeed = 50; // milliseconds between characters

// Track if we've generated a problem for this session
let hasGeneratedProblem = false;

// Current AI provider
let currentProvider: AIProvider = 'groq';

function log(message: string): void {
	const timestamp = new Date().toISOString();
	outputChannel.appendLine(`[${timestamp}] ${message}`);
	console.log(`[Performative] ${message}`);
}

async function processNextKeystroke(): Promise<void> {
	if (isProcessingKeystroke || keystrokeQueue.length === 0) {
		return;
	}
	
	isProcessingKeystroke = true;
	const task = keystrokeQueue.shift();
	
	if (task) {
		try {
			await task();
		} catch (error) {
			log(`Error processing keystroke: ${error}`);
		}
	}
	
	isProcessingKeystroke = false;
	
	// Process next in queue if any
	if (keystrokeQueue.length > 0) {
		processNextKeystroke();
	}
}

// Settings to disable when performative mode is active
const settingsToDisable: Record<string, unknown> = {
	'editor.autoClosingBrackets': 'never',
	'editor.autoClosingQuotes': 'never',
	'editor.autoSurround': 'never',
	'editor.autoIndent': 'none',
	'editor.formatOnType': false,
	'editor.acceptSuggestionOnEnter': 'off',
	'editor.quickSuggestions': false,
	'editor.suggestOnTriggerCharacters': false,
	'editor.wordBasedSuggestions': 'off',
	'editor.parameterHints.enabled': false,
	'editor.inlineSuggest.enabled': false,
	'editor.codeLens': false,
	'editor.hover.enabled': false,
	'editor.snippetSuggestions': 'none',
	'editor.tabCompletion': 'off',
	'editor.linkedEditing': false,
	'github.copilot.editor.enableAutoCompletions': false,
};

async function disableAutoFeatures(): Promise<void> {
	log('Disabling auto-complete and other interfering features...');
	const config = vscode.workspace.getConfiguration();
	
	for (const [key, value] of Object.entries(settingsToDisable)) {
		try {
			// Store original value
			const originalValue = config.get(key);
			originalSettings.set(key, originalValue);
			
			// Set new value
			await config.update(key, value, vscode.ConfigurationTarget.Global);
			log(`  ${key}: ${originalValue} -> ${value}`);
		} catch (error) {
			log(`  Failed to update ${key}: ${error}`);
		}
	}
	log('Auto-features disabled');
}

async function restoreAutoFeatures(): Promise<void> {
	log('Restoring auto-complete and other features...');
	const config = vscode.workspace.getConfiguration();
	
	for (const [key, originalValue] of originalSettings.entries()) {
		try {
			await config.update(key, originalValue, vscode.ConfigurationTarget.Global);
			log(`  ${key}: restored to ${originalValue}`);
		} catch (error) {
			log(`  Failed to restore ${key}: ${error}`);
		}
	}
	originalSettings.clear();
	log('Auto-features restored');
}

async function selectProvider(): Promise<AIProvider | undefined> {
	const items: vscode.QuickPickItem[] = [
		{
			label: '$(zap) Groq (Llama 3.3 70B)',
			description: 'Fast inference with Llama 3.3 70B model',
			detail: 'Free tier available at console.groq.com'
		},
		{
			label: '$(sparkle) Google Gemini 2.0 Flash',
			description: 'Google\'s latest multimodal model',
			detail: 'Free tier available at aistudio.google.com'
		},
		{
			label: '$(hubot) OpenAI (GPT-4o mini)',
			description: 'OpenAI\'s fast and affordable model',
			detail: 'Requires API credits at platform.openai.com'
		}
	];

	const selected = await vscode.window.showQuickPick(items, {
		title: 'Select AI Provider',
		placeHolder: 'Choose which AI to generate your Python project'
	});

	if (!selected) {
		return undefined;
	}

	if (selected.label.includes('Groq')) {
		return 'groq';
	} else if (selected.label.includes('OpenAI')) {
		return 'openai';
	} else {
		return 'gemini';
	}
}

async function promptForApiKey(provider: AIProvider, forcePrompt: boolean = false): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('performative');
	const settingKey = getProviderSettingKey(provider);
	const envVar = getProviderEnvVar(provider);
	
	if (!forcePrompt) {
		const apiKey = config.get<string>(settingKey) || process.env[envVar];
		if (apiKey) {
			log(`API key found for ${provider} in settings or environment`);
			return apiKey;
		}
	}

	const displayName = getProviderDisplayName(provider);
	const placeholder = getProviderKeyPlaceholder(provider);
	const keyUrl = getProviderKeyUrl(provider);

	// Prompt the user for API key
	const result = await vscode.window.showInputBox({
		title: forcePrompt ? `Enter New ${displayName} API Key` : `${displayName} API Key Required`,
		prompt: forcePrompt 
			? `Your previous API key failed. Enter a new API key. Get one at ${keyUrl}`
			: `Enter your API key to generate dynamic Python projects. Get one at ${keyUrl}`,
		placeHolder: placeholder,
		password: true,
		ignoreFocusOut: true
	});

	if (result) {
		// Store the API key in settings
		await config.update(settingKey, result, vscode.ConfigurationTarget.Global);
		log(`API key stored for ${provider}`);
		return result;
	}

	return undefined;
}

// Track if this is the first generation (extension just started)
let isFirstGeneration = true;

async function generateProblem(forceNewKey: boolean = false): Promise<boolean> {
	// Always let user choose provider on first generation or when forcing new key
	if (isFirstGeneration || forceNewKey) {
		const selected = await selectProvider();
		if (!selected) {
			log('No provider selected');
			return false;
		}
		currentProvider = selected;
		isFirstGeneration = false;
	}

	const apiKey = await promptForApiKey(currentProvider, forceNewKey);
	const displayName = getProviderDisplayName(currentProvider);

	if (!apiKey) {
		log(`No API key provided for ${currentProvider}. Cannot generate problem.`);
		vscode.window.showWarningMessage(`No API key provided. Please set your ${displayName} API key.`);
		return false;
	}

	log(`Generating new multi-file problem from ${displayName}...`);
	updateStatusBar(false, 'generating');

	try {
		const problem = await generateMultiFileProblem(currentProvider, apiKey);
		log(`Generated problem: ${problem.task_id} - ${problem.description}`);
		log(`Files: ${problem.files.map(f => f.filename).join(', ')}`);

		if (director) {
			director.setGeneratedProblem(problem);
			hasGeneratedProblem = true;
			updateStatusBar(false);
			vscode.window.showInformationMessage(`🤖 Generated: ${problem.description}`);
			return true;
		}
	} catch (error) {
		const errorMessage = String(error);
		log(`Failed to generate problem from ${currentProvider}: ${errorMessage}`);
		updateStatusBar(false);
		
		// Check if it's an auth/quota error
		const isAuthError = errorMessage.includes('401') || 
			errorMessage.includes('403') || 
			errorMessage.includes('400') ||
			errorMessage.includes('invalid') ||
			errorMessage.includes('expired') ||
			errorMessage.includes('quota') ||
			errorMessage.includes('rate');
		
		if (isAuthError) {
			const action = await vscode.window.showErrorMessage(
				`API Error: ${errorMessage}`,
				'Enter New API Key',
				'Switch Provider',
				'Cancel'
			);
			
			if (action === 'Enter New API Key') {
				// Clear the old key and retry with a new one
				const config = vscode.workspace.getConfiguration('performative');
				const settingKey = getProviderSettingKey(currentProvider);
				await config.update(settingKey, undefined, vscode.ConfigurationTarget.Global);
				return generateProblem(true);
			} else if (action === 'Switch Provider') {
				// Switch to different provider
				const newProvider = currentProvider === 'groq' ? 'gemini' : 'groq';
				currentProvider = newProvider;
				return generateProblem(false);
			}
		} else {
			vscode.window.showErrorMessage(`Failed to generate: ${errorMessage}`);
		}
	}

	return false;
}

// Track if we're currently generating
let isGenerating = false;

export async function activate(context: vscode.ExtensionContext) {
	// Create output channel for debug messages
	outputChannel = vscode.window.createOutputChannel('Performative Developer');
	context.subscriptions.push(outputChannel);
	
	log('Extension activating...');

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'performative.toggle';
	statusBarItem.text = '$(circle-outline) Performative';
	statusBarItem.tooltip = 'Click to toggle Performative Developer mode';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Initialize the Director with the extension path
	log(`Extension path: ${context.extensionPath}`);
	director = new Director(context.extensionPath);

	// Generate a fresh problem from Groq on activation
	isGenerating = true;
	const success = await generateProblem();
	isGenerating = false;
	
	if (success) {
		log('Successfully generated problem from Groq - Ready to perform!');
		vscode.window.showInformationMessage('🎬 Performative Developer ready! Toggle mode to start typing.');
	} else {
		log('Failed to generate problem - extension not ready');
	}

	// Register the toggle command
	const toggleCommand = vscode.commands.registerCommand('performative.toggle', async () => {
		log('Toggle command triggered');
		
		if (!director) {
			log('ERROR: Director not initialized');
			return;
		}

		// Check if we have a generated problem
		if (!hasGeneratedProblem) {
			vscode.window.showWarningMessage('No problem generated yet. Please set your Groq API key first.');
			isGenerating = true;
			const success = await generateProblem();
			isGenerating = false;
			if (!success) {
				return;
			}
		}

		const isActive = director.toggle();
		log(`Toggled to: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

		if (isActive) {
			updateStatusBar(true);
			await disableAutoFeatures();
			registerTypeCommand(context);
			
			// Create the first file automatically
			await createFirstFile();
			
			outputChannel.show(true); // Show output channel for debugging
		} else {
			updateStatusBar(false);
			await restoreAutoFeatures();
			vscode.window.showInformationMessage('🎬 Performative Developer: DEACTIVATED');
			unregisterTypeCommand();
		}
	});

	context.subscriptions.push(toggleCommand);

	// Register the auto-type command
	const autoTypeCommand = vscode.commands.registerCommand('performative.autoType', async () => {
		log('Auto-type command triggered');
		
		if (!director) {
			log('ERROR: Director not initialized');
			return;
		}

		// Check if we have a generated problem
		if (!hasGeneratedProblem) {
			vscode.window.showWarningMessage('No problem generated yet. Please set your Groq API key first.');
			isGenerating = true;
			const success = await generateProblem();
			isGenerating = false;
			if (!success) {
				return;
			}
		}

		// If not active, activate first
		if (!director.getIsActive()) {
			director.toggle();
			updateStatusBar(true);
			await disableAutoFeatures();
			await createFirstFile();
		}

		// Toggle auto-type mode
		if (isAutoTypeMode) {
			stopAutoType();
			vscode.window.showInformationMessage('⏸️ Auto-type PAUSED');
		} else {
			startAutoType();
			vscode.window.showInformationMessage('▶️ Auto-type STARTED - Sit back and watch!');
		}
	});

	context.subscriptions.push(autoTypeCommand);

	// Register speed control commands
	const speedUpCommand = vscode.commands.registerCommand('performative.speedUp', () => {
		autoTypeSpeed = Math.max(10, autoTypeSpeed - 20);
		vscode.window.showInformationMessage(`⚡ Speed: ${autoTypeSpeed}ms per character`);
		if (isAutoTypeMode) {
			stopAutoType();
			startAutoType();
		}
	});

	const slowDownCommand = vscode.commands.registerCommand('performative.slowDown', () => {
		autoTypeSpeed = Math.min(500, autoTypeSpeed + 20);
		vscode.window.showInformationMessage(`🐢 Speed: ${autoTypeSpeed}ms per character`);
		if (isAutoTypeMode) {
			stopAutoType();
			startAutoType();
		}
	});

	context.subscriptions.push(speedUpCommand, slowDownCommand);

	// Register regenerate command
	const regenerateCommand = vscode.commands.registerCommand('performative.regenerate', async () => {
		log('Regenerate command triggered');
		
		// Stop any current auto-typing
		if (isAutoTypeMode) {
			stopAutoType();
		}
		
		// Deactivate if active
		if (director?.getIsActive()) {
			director.toggle();
			updateStatusBar(false);
			await restoreAutoFeatures();
			unregisterTypeCommand();
		}

		// Generate new problem
		const success = await generateProblem();
		if (success) {
			vscode.window.showInformationMessage('🔄 New project generated! Toggle mode to start.');
		} else {
			vscode.window.showErrorMessage('Failed to generate new project. Check your API key.');
		}
		updateStatusBar(false);
	});

	context.subscriptions.push(regenerateCommand);

	log('Extension activated successfully');
}

function startAutoType(): void {
	if (autoTypeInterval) {
		return; // Already running
	}

	isAutoTypeMode = true;
	updateStatusBar(true);
	log(`Starting auto-type mode with ${autoTypeSpeed}ms delay`);

	autoTypeInterval = setInterval(async () => {
		await autoTypeNextChar();
	}, autoTypeSpeed);
}

function stopAutoType(): void {
	if (autoTypeInterval) {
		clearInterval(autoTypeInterval);
		autoTypeInterval = undefined;
	}
	isAutoTypeMode = false;
	updateStatusBar(true); // Still active, just not auto-typing
	log('Stopped auto-type mode');
}

async function autoTypeNextChar(): Promise<void> {
	if (!director || !director.getIsActive()) {
		stopAutoType();
		return;
	}

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		log('No active editor for auto-type');
		return;
	}

	const nextChar = director.getNextChar();
	const progress = director.getProgress();

	if (nextChar === NEXT_FILE) {
		log('Auto-type: Moving to next file...');
		stopAutoType(); // Pause while switching files
		await handleNextFile(editor);
		// Resume after a short delay
		setTimeout(() => {
			if (director?.getIsActive()) {
				startAutoType();
			}
		}, 500);
	} else if (nextChar === EXECUTE_SCENE) {
		log('Auto-type: Scene complete, executing...');
		stopAutoType();
		await executeScene(editor);
		// Auto-type will resume after the scene loads (handled in executeScene)
	} else {
		// Insert the character
		await editor.edit(editBuilder => {
			editBuilder.insert(editor.selection.active, nextChar);
		}, { undoStopBefore: false, undoStopAfter: false });
	}
}

async function createFirstFile(): Promise<void> {
	if (!director) {
		log('ERROR: Director not available for createFirstFile');
		return;
	}

	log('Creating first file for the scene...');

	// Determine the working directory (use workspace folder or temp)
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length > 0) {
		workingDirectory = workspaceFolders[0].uri.fsPath;
	} else {
		// Use a temporary directory if no workspace is open
		const os = require('os');
		workingDirectory = path.join(os.tmpdir(), 'performative-' + Date.now());
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(workingDirectory));
	}
	log(`Working directory: ${workingDirectory}`);

	// Get the first filename
	let filename: string;
	if (director.isMultiFile()) {
		const currentFile = director.getCurrentFile();
		filename = currentFile?.filename || 'main.py';
		const progress = director.getProgress();
		vscode.window.showInformationMessage(`🎬 Multi-file scene! ${progress.totalFiles} files to type. Starting with: ${filename}`);
	} else {
		filename = 'solution.py';
		vscode.window.showInformationMessage('🎬 Performative Developer: ACTIVATED - Start typing!');
	}

	// Create and open the file
	const filePath = path.join(workingDirectory, filename);
	const fileUri = vscode.Uri.file(filePath);
	
	// Create an empty file
	await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
	
	// Open the file in the editor
	const document = await vscode.workspace.openTextDocument(fileUri);
	await vscode.window.showTextDocument(document, { preview: false });
	
	log(`Created and opened: ${filePath}`);
}

function updateStatusBar(active: boolean, state?: 'generating' | 'ready'): void {
	if (!statusBarItem) {
		return;
	}
	
	if (state === 'generating') {
		statusBarItem.text = '$(sync~spin) Generating...';
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
		statusBarItem.tooltip = 'Generating new project from Llama 3.1 8B...';
		return;
	}
	
	if (active) {
		if (isAutoTypeMode) {
			statusBarItem.text = '$(play) Auto-Typing';
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			statusBarItem.tooltip = 'Auto-type mode ACTIVE - Click to stop';
		} else {
			statusBarItem.text = '$(record) Performative';
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			statusBarItem.tooltip = 'Performative Developer: ACTIVE - Click to deactivate';
		}
	} else {
		statusBarItem.text = '$(circle-outline) Performative';
		statusBarItem.backgroundColor = undefined;
		statusBarItem.tooltip = 'Click to toggle Performative Developer mode';
	}
}

function registerTypeCommand(context: vscode.ExtensionContext): void {
	log('Registering type command...');
	
	if (typeCommandDisposable) {
		log('Type command already registered');
		return;
	}

	typeCommandDisposable = vscode.commands.registerCommand('type', async (args: { text: string }) => {
		log(`Type intercepted! User typed: "${args.text}"`);
		
		if (!director || !director.getIsActive()) {
			log('Director not active, passing through to default type');
			await vscode.commands.executeCommand('default:type', args);
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			log('No active editor');
			return;
		}

		// Queue the keystroke to prevent race conditions
		keystrokeQueue.push(async () => {
			const nextChar = director!.getNextChar();
			const progress = director!.getProgress();
			log(`Next char: "${nextChar === '\n' ? '\\n' : nextChar}" (file ${progress.fileIndex + 1}/${progress.totalFiles}, char ${progress.current}/${progress.total})`);

			if (nextChar === NEXT_FILE) {
				log('Current file complete! Moving to next file...');
				await handleNextFile(editor);
			} else if (nextChar === EXECUTE_SCENE) {
				log('Script complete! Executing scene...');
				await executeScene(editor);
			} else {
				// Insert the scripted character instead of user's keystroke
				await editor.edit(editBuilder => {
					editBuilder.insert(editor.selection.active, nextChar);
				}, { undoStopBefore: false, undoStopAfter: false });
			}
		});
		
		// Process the queue
		processNextKeystroke();
	});

	context.subscriptions.push(typeCommandDisposable);
	log('Type command registered successfully');
}

function unregisterTypeCommand(): void {
	log('Unregistering type command...');
	if (typeCommandDisposable) {
		typeCommandDisposable.dispose();
		typeCommandDisposable = undefined;
		log('Type command unregistered');
	}
}

async function handleNextFile(currentEditor: vscode.TextEditor): Promise<void> {
	if (!director) {
		log('ERROR: Director not available');
		return;
	}

	// Save the current file
	await currentEditor.document.save();
	log('Current file saved');

	// Get the next file info
	const nextFile = director.advanceToNextFile();
	if (!nextFile) {
		log('ERROR: No next file available');
		return;
	}

	log(`Opening next file: ${nextFile.filename}`);

	// Determine the working directory
	if (!workingDirectory) {
		// Use the directory of the current file, or workspace folder
		const currentDir = path.dirname(currentEditor.document.uri.fsPath);
		workingDirectory = currentDir;
		log(`Set working directory: ${workingDirectory}`);
	}

	// Create the new file path
	const newFilePath = path.join(workingDirectory, nextFile.filename);
	const newFileUri = vscode.Uri.file(newFilePath);

	// Create and open the new file
	await vscode.workspace.fs.writeFile(newFileUri, new Uint8Array());
	const document = await vscode.workspace.openTextDocument(newFileUri);
	await vscode.window.showTextDocument(document, { preview: false });

	const progress = director.getProgress();
	vscode.window.showInformationMessage(`📄 File ${progress.fileIndex + 1}/${progress.totalFiles}: ${nextFile.filename}`);
}

async function executeScene(editor: vscode.TextEditor): Promise<void> {
	if (!director) {
		log('ERROR: Director not available in executeScene');
		return;
	}

	log('Executing scene...');

	// Save the document
	await editor.document.save();
	log('Document saved');

	// Get or create a terminal
	let terminal = vscode.window.activeTerminal;
	if (!terminal) {
		terminal = vscode.window.createTerminal('Performative');
		log('Created new terminal');
	}
	terminal.show();

	// Determine what to run
	let runCommand: string;
	
	if (director.isMultiFile()) {
		// For multi-file projects, run the entry file from the working directory
		const entryFile = director.getEntryFile();
		if (workingDirectory) {
			runCommand = `cd "${workingDirectory}" && python3 "${entryFile}"`;
		} else {
			runCommand = `python3 "${entryFile}"`;
		}
		log(`Running multi-file project: ${runCommand}`);
	} else {
		// For single-file projects, just run the current file
		const filePath = editor.document.uri.fsPath;
		runCommand = `python3 "${filePath}"`;
		log(`Running single file: ${runCommand}`);
	}
	
	terminal.sendText(runCommand);

	// Scene complete - deactivate performative mode
	log('Scene complete! Deactivating performative mode.');
	
	// Stop auto-typing if active
	if (isAutoTypeMode) {
		stopAutoType();
	}
	
	// Deactivate the director
	if (director.getIsActive()) {
		director.toggle();
	}
	
	// Restore settings
	await restoreAutoFeatures();
	unregisterTypeCommand();
	updateStatusBar(false);
	
	vscode.window.showInformationMessage('🎉 Scene complete! Code executed in terminal. Use Cmd+Shift+G to generate a new project.');
}

export async function deactivate() {
	log('Extension deactivating...');
	stopAutoType();
	await restoreAutoFeatures();
	unregisterTypeCommand();
	keystrokeQueue = [];
	director = undefined;
}
