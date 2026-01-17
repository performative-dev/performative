import * as vscode from 'vscode';
import { Director, EXECUTE_SCENE } from './director';

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

export function activate(context: vscode.ExtensionContext) {
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

	// Register the toggle command
	const toggleCommand = vscode.commands.registerCommand('performative.toggle', async () => {
		log('Toggle command triggered');
		
		if (!director) {
			log('ERROR: Director not initialized');
			return;
		}

		const isActive = director.toggle();
		log(`Toggled to: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

		if (isActive) {
			updateStatusBar(true);
			await disableAutoFeatures();
			vscode.window.showInformationMessage('🎬 Performative Developer: ACTIVATED - Start typing!');
			registerTypeCommand(context);
			outputChannel.show(true); // Show output channel for debugging
		} else {
			updateStatusBar(false);
			await restoreAutoFeatures();
			vscode.window.showInformationMessage('🎬 Performative Developer: DEACTIVATED');
			unregisterTypeCommand();
		}
	});

	context.subscriptions.push(toggleCommand);
	log('Extension activated successfully');
}

function updateStatusBar(active: boolean): void {
	if (!statusBarItem) {
		return;
	}
	
	if (active) {
		statusBarItem.text = '$(record) Performative';
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		statusBarItem.tooltip = 'Performative Developer: ACTIVE - Click to deactivate';
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
			log(`Next char: "${nextChar === '\n' ? '\\n' : nextChar}" (${progress.current}/${progress.total})`);

			if (nextChar === EXECUTE_SCENE) {
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

	// Get the file path and run it with python3
	const filePath = editor.document.uri.fsPath;
	log(`Running: python3 "${filePath}"`);
	terminal.sendText(`python3 "${filePath}"`);

	// Wait a moment for the script to execute, then clear and start next scene
	setTimeout(async () => {
		log('Clearing editor and loading next scene...');
		
		// Clear the editor content
		const fullRange = new vscode.Range(
			editor.document.positionAt(0),
			editor.document.positionAt(editor.document.getText().length)
		);

		await editor.edit(editBuilder => {
			editBuilder.delete(fullRange);
		});

		// Load the next problem
		const success = director?.startNewScene();
		log(`New scene loaded: ${success}`);

		vscode.window.showInformationMessage('🎬 New scene loaded! Keep typing...');
	}, 3000); // 3 second delay to see the output
}

export async function deactivate() {
	log('Extension deactivating...');
	await restoreAutoFeatures();
	unregisterTypeCommand();
	keystrokeQueue = [];
	director = undefined;
}
