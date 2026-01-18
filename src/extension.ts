import * as vscode from 'vscode';
import * as path from 'path';
import { Director, EXECUTE_SCENE, NEXT_FILE, DELETE_LINE, SWITCH_TO_FILE } from './director';
import { 
	generateMultiFileProblem,
	extendProject,
	AIProvider,
	MultiFileProblem,
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

// Extension workflow state
let isGeneratingExtension = false;
let copilotSuggestion: string | undefined;

// Lock to prevent race conditions with rapid typing
let isProcessingKeystroke = false;
let keystrokeQueue: Array<() => Promise<void>> = [];

// GUI manipulation tracking
let keystrokesSinceLastAction = 0;
let nextActionThreshold = 0;
let isPerformingGuiAction = false;

// Scene execution tracking - ignore keystrokes while executing
let isExecutingScene = false;

// Pending file switch - execute at next newline
let pendingFileSwitch = false;

function getRandomThreshold(): number {
	// Trigger GUI action every 10-15 keystrokes (reduced for testing)
	// TODO: Change back to 80-200 for production
	return Math.floor(Math.random() * 5) + 10;
}

const guiActions = [
	// { name: 'toggle sidebar', command: 'workbench.action.toggleSidebarVisibility' },
	{ name: 'toggle terminal', command: 'custom:toggleTerminal' },
	{ name: 'switch file', command: 'custom:switchFile' },
	// Layout actions - need special handling to preserve cursor state
	{ name: 'single layout', command: 'custom:singleLayout' },
	{ name: 'two columns', command: 'custom:twoColumns' },
	// Copilot distraction - opens copilot chat with a random funny question
	{ name: 'copilot distraction', command: 'custom:copilotDistraction' },
	// Intrusive thought - types an embarrassing comment then frantically deletes it
	{ name: 'intrusive thought', command: 'custom:intrusiveThought' },
	// Heavy install - opens terminal and simulates npm dependency hell
	{ name: 'heavy install', command: 'custom:heavyInstall' },
	// Micro-manager - fake Slack message from annoying coworker
	{ name: 'micro manager', command: 'custom:microManager' },
];

// Intrusive thoughts that "accidentally" get typed before being frantically deleted
const intrusiveThoughts = [
	"# TODO: Fix this garbage later",
	"password = \"correcthorsebatterystaple\"",
	"# I have no idea why this works",
	"# git commit -m \"please work goddamnit\"",
	"# Dear future me: I'm sorry",
	"API_KEY = \"sk-1234567890abcdef\"",
	"# This is held together by prayers and duct tape",
	"# TODO: Delete before code review",
	"# Note to self: update resume",
	"# If you're reading this, the code works and I have no idea why",
	"salary = 45000  # TODO: ask for raise",
	"# Written at 3am, good luck",
	"# Copied from StackOverflow, don't touch",
	"# Here be dragons",
	"# This function was written by my cat",
	"# I'll refactor this later (narrator: they never did)",
	"CLIENT_SECRET = \"hunter2\"",
	"# If this breaks, blame the intern",
	"# Magic number, do not change or everything explodes",
	"# I should have been a farmer",
];

// Track keystrokes since last intrusive thought (to make it rare but not too rare)
let keystrokesSinceLastIntrusiveThought = 0;
const MIN_KEYSTROKES_BETWEEN_INTRUSIVE = 200; // Only allow intrusive thoughts every 200+ keystrokes

// Track keystrokes since last heavy install
let keystrokesSinceLastHeavyInstall = 0;
const MIN_KEYSTROKES_BETWEEN_HEAVY_INSTALL = 600; // Only allow heavy install every 600+ keystrokes

// Micro-manager messages - annoying Slack/Teams interruptions
const microManagerMessages = [
	{ name: 'Michael from Product', message: 'Hey, quick question - can we make the logo bigger? 🙏' },
	{ name: 'Sandra (HR)', message: 'Reminder: Please complete your timesheet by EOD 📋' },
	{ name: 'Dave from Sales', message: 'Can you jump on a quick call? Just 5 mins I promise' },
	{ name: 'Your Manager', message: 'Hey are you free for a quick sync?' },
	{ name: 'Jennifer (PM)', message: 'Did you update the JIRA ticket? The sprint ends today' },
	{ name: 'IT Support', message: 'Your password expires in 3 days. Click here to reset.' },
	{ name: 'Kevin from QA', message: 'Found a bug. Can you look at it ASAP? Its blocking release' },
	{ name: 'CEO', message: 'Love what the team is doing! Quick thought - what if we added AI? 🚀' },
	{ name: 'Slack Bot', message: 'You have 47 unread messages in #general' },
	{ name: 'Calendar', message: '⏰ Reminder: "Weekly Standup" starts in 5 minutes' },
	{ name: 'Rachel (Design)', message: 'Can we use a different shade of blue? This one feels off' },
	{ name: 'Your Manager', message: 'Lets circle back on this. Can you ping me when youre free?' },
	{ name: 'Tom (Backend)', message: 'Hey did you push to main? Prod is down 🔥' },
	{ name: 'HR Bot', message: '🎂 Wish Kevin a happy birthday in #celebrations!' },
	{ name: 'Compliance', message: 'Please complete your annual security training by Friday' },
];

// Track keystrokes since last micro-manager
let keystrokesSinceLastMicroManager = 0;
const MIN_KEYSTROKES_BETWEEN_MICRO_MANAGER = 300; // Every 300+ keystrokes

// Funny questions to ask Copilot during "coding"
// Note: Set your Copilot model to a fast one (e.g., GPT-4o-mini) manually for quicker responses
const copilotQuestions = [
	"tell me the recipe to make a tiramisu flavoured iced coffee",
	"what's the most efficient way to procrastinate while looking productive?",
	"explain quantum computing but make it sound like a recipe for lasagna",
	"if a rubber duck could debug code, what would its linkedin profile look like?",
	"write me a haiku about null pointer exceptions",
	"what's the best excuse for when your code works but you don't know why?",
	"explain recursion using only pizza toppings as examples",
	"if stackoverflow went down for a day, how would civilization collapse?",
	"write a motivational speech for a semicolon that feels unappreciated",
	"what would gordon ramsay say about my spaghetti code?",
	"explain the difference between git merge and git rebase using a soap opera plot",
	"if bugs were pokemon, what types would they be?",
	"write a breakup letter to Internet Explorer",
	"what's the optimal coffee to code ratio for maximum productivity?",
	"explain machine learning to a medieval peasant",
	"if my code were a horror movie, what would the tagline be?",
	"write a yelp review for the void that null points to",
	"what would a therapist say to an infinite loop?",
	"explain blockchain but make it sound like a cooking competition",
	"if tabs vs spaces were a civil war, who would win and why?",
	"write a dating profile for a lonely API endpoint",
	"what's the best way to name variables when you've completely given up?",
	"explain docker containers using only ikea furniture assembly instructions",
	"if my git history were a novel, what genre would it be?",
	"write a formal apology letter from Monday to all developers",
];

// Track if terminal panel is visible
let isTerminalVisible = false;

// Track if a copilot distraction is currently in progress
let isCopilotDistractionInProgress = false;

// Track keystrokes since last copilot distraction (to make it rare)
let keystrokesSinceLastCopilot = 0;
const MIN_KEYSTROKES_BETWEEN_COPILOT = 300; // Only allow copilot every 300+ keystrokes

async function performRandomGuiAction(): Promise<void> {
	isPerformingGuiAction = true;

	let action = guiActions[Math.floor(Math.random() * guiActions.length)];

	// GUARANTEED: Force heavy install if cooldown has passed (high-impact visual)
	if (keystrokesSinceLastHeavyInstall >= MIN_KEYSTROKES_BETWEEN_HEAVY_INSTALL) {
		action = { name: 'heavy install', command: 'custom:heavyInstall' };
		log('Forcing heavy install - cooldown passed');
	}

	// GUARANTEED: Force micro-manager if cooldown has passed
	if (keystrokesSinceLastMicroManager >= MIN_KEYSTROKES_BETWEEN_MICRO_MANAGER) {
		action = { name: 'micro manager', command: 'custom:microManager' };
		log('Forcing micro-manager - cooldown passed');
	}

	// GUARANTEED: Force intrusive thought if cooldown has passed
	if (keystrokesSinceLastIntrusiveThought >= MIN_KEYSTROKES_BETWEEN_INTRUSIVE) {
		action = { name: 'intrusive thought', command: 'custom:intrusiveThought' };
		log('Forcing intrusive thought - cooldown passed');
	}

	// If copilot was selected but not enough keystrokes have passed, pick a different action
	if (action.command === 'custom:copilotDistraction' && keystrokesSinceLastCopilot < MIN_KEYSTROKES_BETWEEN_COPILOT) {
		log(`Skipping copilot distraction - only ${keystrokesSinceLastCopilot}/${MIN_KEYSTROKES_BETWEEN_COPILOT} keystrokes since last one`);
		// Pick a different action (exclude copilot)
		const otherActions = guiActions.filter(a => a.command !== 'custom:copilotDistraction');
		action = otherActions[Math.floor(Math.random() * otherActions.length)];
	}

	// If intrusive thought was selected but not enough keystrokes have passed, pick a different action
	if (action.command === 'custom:intrusiveThought' && keystrokesSinceLastIntrusiveThought < MIN_KEYSTROKES_BETWEEN_INTRUSIVE) {
		log(`Skipping intrusive thought - only ${keystrokesSinceLastIntrusiveThought}/${MIN_KEYSTROKES_BETWEEN_INTRUSIVE} keystrokes since last one`);
		// Pick a different action (exclude intrusive thought and copilot)
		const otherActions = guiActions.filter(a => a.command !== 'custom:intrusiveThought' && a.command !== 'custom:copilotDistraction');
		action = otherActions[Math.floor(Math.random() * otherActions.length)];
	}

	// If heavy install was selected but not enough keystrokes have passed, pick a different action
	if (action.command === 'custom:heavyInstall' && keystrokesSinceLastHeavyInstall < MIN_KEYSTROKES_BETWEEN_HEAVY_INSTALL) {
		log(`Skipping heavy install - only ${keystrokesSinceLastHeavyInstall}/${MIN_KEYSTROKES_BETWEEN_HEAVY_INSTALL} keystrokes since last one`);
		// Pick a different action (exclude heavy install, intrusive thought, and copilot)
		const otherActions = guiActions.filter(a =>
			a.command !== 'custom:heavyInstall' &&
			a.command !== 'custom:intrusiveThought' &&
			a.command !== 'custom:copilotDistraction'
		);
		action = otherActions[Math.floor(Math.random() * otherActions.length)];
	}

	// If micro-manager was selected but not enough keystrokes have passed, pick a different action
	if (action.command === 'custom:microManager' && keystrokesSinceLastMicroManager < MIN_KEYSTROKES_BETWEEN_MICRO_MANAGER) {
		log(`Skipping micro-manager - only ${keystrokesSinceLastMicroManager}/${MIN_KEYSTROKES_BETWEEN_MICRO_MANAGER} keystrokes since last one`);
		const otherActions = guiActions.filter(a =>
			a.command !== 'custom:microManager' &&
			a.command !== 'custom:heavyInstall' &&
			a.command !== 'custom:intrusiveThought' &&
			a.command !== 'custom:copilotDistraction'
		);
		action = otherActions[Math.floor(Math.random() * otherActions.length)];
	}
	
	log(`Performing GUI action: ${action.name}`);

	// Capture current editor state BEFORE any action (use offset for reliability)
	const editorBefore = vscode.window.activeTextEditor;
	const documentUriBefore = editorBefore?.document.uri;
	const cursorOffsetBefore = editorBefore ? editorBefore.document.offsetAt(editorBefore.selection.active) : 0;

	if (action.command === 'custom:toggleTerminal') {
		// Custom terminal toggle that never takes focus
		if (isTerminalVisible) {
			await vscode.commands.executeCommand('workbench.action.togglePanel');
			isTerminalVisible = false;
		} else {
			let terminal = vscode.window.activeTerminal;
			if (!terminal) {
				terminal = vscode.window.createTerminal('Performative');
			}
			terminal.show(true); // true = preserve focus
			isTerminalVisible = true;
		}
	} else if (action.command === 'custom:switchFile') {
		// Schedule a file switch for next newline
		if (director && director.isMultiFile() && !director.isCurrentFileComplete()) {
			pendingFileSwitch = true;
			log('File switch scheduled for next newline');
		}
	} else if (action.command === 'custom:singleLayout') {
		// Join all editor groups back to single column
		await vscode.commands.executeCommand('workbench.action.joinAllGroups');
	} else if (action.command === 'custom:twoColumns') {
		const currentGroups = vscode.window.tabGroups.all.length;
		
		if (currentGroups >= 3) {
			log('Already at max editor groups (3)');
		} else {
			// Simply move current editor to next group - this creates a split
			// and the original group shows the next tab in line
			await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
			log(`Moved to new group`);
		}
	} else if (action.command === 'custom:copilotDistraction') {
		// Perform the copilot distraction - this handles its own editor restoration
		await performCopilotDistraction();
		keystrokesSinceLastCopilot = 0; // Reset the counter
		// Skip the normal editor restoration below since copilot distraction handles it
		isPerformingGuiAction = false;
		if (keystrokeQueue.length > 0) {
			processNextKeystroke();
		}
		return;
	} else if (action.command === 'custom:intrusiveThought') {
		// Perform the intrusive thought - types something embarrassing then deletes it
		await performIntrusiveThought();
		keystrokesSinceLastIntrusiveThought = 0; // Reset the counter
		isPerformingGuiAction = false;
		if (keystrokeQueue.length > 0) {
			processNextKeystroke();
		}
		return;
	} else if (action.command === 'custom:heavyInstall') {
		// Perform the heavy install - npm dependency hell simulator
		await performHeavyInstall();
		keystrokesSinceLastHeavyInstall = 0; // Reset the counter
		isPerformingGuiAction = false;
		if (keystrokeQueue.length > 0) {
			processNextKeystroke();
		}
		return;
	} else if (action.command === 'custom:microManager') {
		// Perform the micro-manager - fake Slack popup
		await performMicroManager();
		keystrokesSinceLastMicroManager = 0; // Reset the counter
		isPerformingGuiAction = false;
		if (keystrokeQueue.length > 0) {
			processNextKeystroke();
		}
		return;
	} else {
		await vscode.commands.executeCommand(action.command);
	}

	// Quick restore of editor focus and cursor using offset (no long delays)
	if (documentUriBefore && editorBefore) {
		// Focus the correct editor
		const currentEditor = vscode.window.activeTextEditor;
		if (currentEditor && currentEditor.document.uri.toString() === documentUriBefore.toString()) {
 		// In diff mode, restore to current write position
      	const restorePos = director?.isInDiffMode()                              
      	  ? currentEditor.document.positionAt(director.getDiffWritePosition())                                                                   
      	  : currentEditor.document.positionAt(cursorOffsetBefore);     
			currentEditor.selection = new vscode.Selection(restorePos, restorePos);
		} else {
			// Different editor active, find and focus ours
			const editors = vscode.window.visibleTextEditors;
			const targetEditor = editors.find(e => e.document.uri.toString() === documentUriBefore.toString());
			if (targetEditor) {
				await vscode.window.showTextDocument(targetEditor.document, {
					viewColumn: targetEditor.viewColumn,
					preserveFocus: false,
					preview: false
				});
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					const restorePos = director?.isInDiffMode()
					  ? editor.document.positionAt(director.getDiffWritePosition())
					  : editor.document.positionAt(cursorOffsetBefore); 
					editor.selection = new vscode.Selection(restorePos, restorePos);
				}
			}
		}
	}

	isPerformingGuiAction = false;

	// Process any queued keystrokes
	if (keystrokeQueue.length > 0) {
		processNextKeystroke();
	}
}

// Helper to type text character by character with delays (for visual effect)
async function typeTextSlowly(text: string, delayMs: number = 30): Promise<void> {
	for (const char of text) {
		// Type each character by simulating the 'type' command directly to the active input
		await vscode.commands.executeCommand('default:type', { text: char });
		await sleep(delayMs);
	}
}

// Sleep helper
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Perform the copilot distraction - opens chat, types a question, waits for response
async function performCopilotDistraction(): Promise<void> {
	// Skip if a copilot distraction is already in progress
	if (isCopilotDistractionInProgress) {
		log('Copilot distraction already in progress - skipping');
		return;
	}
	
	isCopilotDistractionInProgress = true;
	log('Starting Copilot distraction...');
	
	// Capture current editor state BEFORE opening copilot
	const editorBefore = vscode.window.activeTextEditor;
	const documentUriBefore = editorBefore?.document.uri;
	const cursorPositionBefore = editorBefore?.selection.active;
	
	// Pick a random question
	const question = copilotQuestions[Math.floor(Math.random() * copilotQuestions.length)];
	log(`Copilot question: "${question}"`);
	
	try {
		// Open GitHub Copilot Chat panel
		// Try the inline chat first (appears as a floating window in the editor)
		try {
			await vscode.commands.executeCommand('workbench.action.chat.open');
			log('Opened Copilot Chat panel');
		} catch (e) {
			// Fallback to other copilot commands if available
			try {
				await vscode.commands.executeCommand('github.copilot.interactiveEditor.explain');
			} catch {
				log('Could not open Copilot Chat - extension may not be installed');
				return;
			}
		}
		
		// Wait a moment for the chat to open and for any stray keystrokes to settle
		await sleep(600);

		// Clear any gibberish that may have been typed by user keystrokes
		// Select all text in the input and delete it
		await vscode.commands.executeCommand('editor.action.selectAll');
		await sleep(50);
		await vscode.commands.executeCommand('deleteLeft');
		await sleep(100);

		// Type the question character by character for visual effect
		await typeTextSlowly(question, 25);
		
		// Small pause after typing, then submit
		await sleep(300);
		
		// Submit the question using the chat submit command (Enter just creates newline)
		try {
			await vscode.commands.executeCommand('workbench.action.chat.submit');
			log('Submitted question to Copilot via chat.submit');
		} catch {
			// Fallback: try using acceptInput or other methods
			try {
				await vscode.commands.executeCommand('workbench.action.chat.acceptInput');
				log('Submitted question to Copilot via acceptInput');
			} catch {
				log('Could not submit chat message');
			}
		}
		
		// Wait for the AI to generate a response
		// Conservative wait time - assume response takes a while
		const responseWaitTime = 12000 + Math.random() * 5000; // 12-17 seconds
		log(`Waiting ${Math.round(responseWaitTime)}ms for Copilot response...`);
		await sleep(responseWaitTime);
		
		// "Read" the response - stay on the chat for a bit longer
		const readingTime = 3000 + Math.random() * 2000; // 3-5 seconds of "reading"
		log(`Reading response for ${Math.round(readingTime)}ms...`);
		await sleep(readingTime);
		
		// First restore editor focus and cursor position (chat stays open)
		log('Returning focus to editor (chat still visible)...');
		
		if (documentUriBefore && cursorPositionBefore) {
			try {
				const document = await vscode.workspace.openTextDocument(documentUriBefore);
				const editor = await vscode.window.showTextDocument(document, {
					preview: false,
					preserveFocus: false
				});
				editor.selection = new vscode.Selection(cursorPositionBefore, cursorPositionBefore);
				editor.revealRange(
					new vscode.Range(cursorPositionBefore, cursorPositionBefore),
					vscode.TextEditorRevealType.InCenterIfOutsideViewport
				);
				log('Restored editor focus after Copilot distraction');
			} catch (e) {
				log(`Failed to restore editor: ${e}`);
			}
		}
		
		// Wait 3 seconds before closing the chat window
		log('Waiting 3 seconds before closing chat...');
		await sleep(3000);
		
		// Now close the copilot chat
		log('Closing Copilot Chat...');
		
		// Close the chat view - try multiple methods to ensure it's closed
		try {
			await vscode.commands.executeCommand('workbench.action.chat.close');
		} catch {
			// Ignore
		}
		try {
			await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
		} catch {
			// Ignore
		}
		
	} catch (error) {
		log(`Copilot distraction error: ${error}`);
		// Try to restore editor even on error
		if (documentUriBefore && cursorPositionBefore) {
			try {
				const document = await vscode.workspace.openTextDocument(documentUriBefore);
				await vscode.window.showTextDocument(document);
			} catch {
				// Ignore restore errors
			}
		}
	}
	
	isCopilotDistractionInProgress = false;
	log('Copilot distraction complete');
}

// Extension request prompt for Copilot
const EXTENSION_REQUEST_PROMPT = `I just finished writing this Python project. Can you suggest ONE specific feature or extension I could add to make it more useful? Just describe the feature briefly in 1-2 sentences - don't write any code.`;

// Ask Copilot for an extension idea and capture the response
async function askCopilotForExtension(): Promise<string | undefined> {
	log('Asking Copilot for extension idea...');
	
	// Capture current editor state
	const editorBefore = vscode.window.activeTextEditor;
	const documentUriBefore = editorBefore?.document.uri;
	const cursorPositionBefore = editorBefore?.selection.active;
	
	try {
		// Open GitHub Copilot Chat panel
		try {
			await vscode.commands.executeCommand('workbench.action.chat.open');
			log('Opened Copilot Chat panel');
		} catch (e) {
			log('Could not open Copilot Chat - extension may not be installed');
			return undefined;
		}
		
		await sleep(600);
		
		// Clear any existing text
		await vscode.commands.executeCommand('editor.action.selectAll');
		await sleep(50);
		await vscode.commands.executeCommand('deleteLeft');
		await sleep(100);
		
		// Type the extension request
		await typeTextSlowly(EXTENSION_REQUEST_PROMPT, 25);
		
		await sleep(300);
		
		// Submit the question
		try {
			await vscode.commands.executeCommand('workbench.action.chat.submit');
			log('Submitted extension request to Copilot');
		} catch {
			try {
				await vscode.commands.executeCommand('workbench.action.chat.acceptInput');
			} catch {
				log('Could not submit chat message');
				return undefined;
			}
		}
		
		// Wait for Copilot to respond
		const responseWaitTime = 15000 + Math.random() * 5000; // 15-20 seconds
		log(`Waiting ${Math.round(responseWaitTime)}ms for Copilot response...`);
		await sleep(responseWaitTime);
		
		// Try to capture the response using clipboard
		// First, select the last response in chat
		try {
			// Use keyboard to select and copy
			await vscode.commands.executeCommand('workbench.action.chat.selectLastResponse');
			await sleep(200);
			await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
			await sleep(100);
			
			// Read from clipboard
			const clipboardContent = await vscode.env.clipboard.readText();
			if (clipboardContent && clipboardContent.length > 10) {
				log(`Captured Copilot suggestion: ${clipboardContent.substring(0, 100)}...`);
				copilotSuggestion = clipboardContent;
			}
		} catch (e) {
			log(`Could not capture Copilot response: ${e}`);
		}
		
		// If we couldn't capture the response, use a fallback
		if (!copilotSuggestion) {
			copilotSuggestion = "Add a search/filter feature to find items quickly";
			log(`Using fallback suggestion: ${copilotSuggestion}`);
		}
		
		// Read the response for a bit
		await sleep(3000);
		
		// Type "thank you!" in response
		log('Typing thank you message...');
		await typeTextSlowly("thank you!", 30);
		await sleep(500);
		
		// Submit the thank you
		try {
			await vscode.commands.executeCommand('workbench.action.chat.submit');
		} catch {
			// Ignore
		}
		
		await sleep(2000);
		
		// Restore editor focus
		if (documentUriBefore && cursorPositionBefore) {
			try {
				const document = await vscode.workspace.openTextDocument(documentUriBefore);
				const editor = await vscode.window.showTextDocument(document, {
					preview: false,
					preserveFocus: false
				});
				editor.selection = new vscode.Selection(cursorPositionBefore, cursorPositionBefore);
				log('Restored editor focus after Copilot interaction');
			} catch (e) {
				log(`Failed to restore editor: ${e}`);
			}
		}
		
		// Close the chat after a moment
		await sleep(2000);
		try {
			await vscode.commands.executeCommand('workbench.action.chat.close');
		} catch {
			// Ignore
		}
		
		return copilotSuggestion;
		
	} catch (error) {
		log(`Copilot extension request error: ${error}`);
		return undefined;
	}
}

// Generate extended project using AI and start diff mode
async function generateExtendedProject(suggestion: string): Promise<boolean> {
	if (!director) {
		log('ERROR: Director not available for extension');
		return false;
	}
	
	const currentProblem = director.getCurrentProblem();
	if (!currentProblem || currentProblem.type !== 'multi') {
		log('ERROR: No current multi-file problem to extend');
		return false;
	}
	
	const apiKey = await promptForApiKey(currentProvider, false);
	if (!apiKey) {
		log('No API key for extension generation');
		return false;
	}
	
	log(`Generating extended project with suggestion: ${suggestion.substring(0, 50)}...`);
	updateStatusBar(false, 'extending');
	
	try {
		const extendedProject = await extendProject(
			currentProvider, 
			apiKey, 
			currentProblem as MultiFileProblem, 
			suggestion
		);
		
		log(`Generated extended project: ${extendedProject.description}`);
		log(`Files: ${extendedProject.files.map(f => f.filename).join(', ')}`);
		
		// Start diff mode in director
		director.startDiffMode(extendedProject);
		
		updateStatusBar(true);
		vscode.window.showInformationMessage(`🔄 Extending: ${extendedProject.description}`);
		
		return true;
	} catch (error) {
		log(`Failed to generate extended project: ${error}`);
		updateStatusBar(false);
		vscode.window.showErrorMessage(`Failed to extend project: ${error}`);
		return false;
	}
}

// Perform the intrusive thought - types an embarrassing comment then frantically deletes it
async function performIntrusiveThought(): Promise<void> {
	log('Starting intrusive thought...');

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		log('No active editor for intrusive thought');
		return;
	}

	// Pick a random intrusive thought
	const thought = intrusiveThoughts[Math.floor(Math.random() * intrusiveThoughts.length)];
	log(`Intrusive thought: "${thought}"`);

	// Remember EXACTLY where we started (as character offset in document)
	const startOffset = editor.document.offsetAt(editor.selection.active);
	let charsInserted = 0;

	// Get indentation of the previous line
	const currentPos = editor.selection.active;
	const lineAboveNum = currentPos.line > 0 ? currentPos.line - 1 : 0;
	const lineAbove = editor.document.lineAt(lineAboveNum);
	const indentationMatch = lineAbove.text.match(/^\s*/);
	const indentation = indentationMatch ? indentationMatch[0] : '';

	// Insert a newline and indentation first
	const insertNewlineIndent = '\n' + indentation;
	const insertPositionNewline = editor.document.positionAt(startOffset);
	const successNewline = await editor.edit(
		(editBuilder) => {
			editBuilder.insert(insertPositionNewline, insertNewlineIndent);
		},
		{ undoStopBefore: false, undoStopAfter: false },
  	);
	if (successNewline) {
		charsInserted += insertNewlineIndent.length;
		editor.selection = new vscode.Selection(
			editor.document.positionAt(startOffset + charsInserted),
			editor.document.positionAt(startOffset + charsInserted)
		);
		editor.revealRange(
			new vscode.Range(editor.selection.active, editor.selection.active),
			vscode.TextEditorRevealType.InCenterIfOutsideViewport,
		);
		await sleep(30 + Math.random() * 40);
	}

	// Type the intrusive thought character by character (normal typing speed)
	// IMPORTANT: Always insert at explicit calculated position, not editor.selection.active
	// This prevents cursor drift during async operations
	for (const char of thought) {
		const insertPosition = editor.document.positionAt(startOffset + charsInserted);
		const success = await editor.edit(
			(editBuilder) => {
				editBuilder.insert(insertPosition, char);
			},
			{ undoStopBefore: false, undoStopAfter: false },
		);

		if (success) {
			charsInserted++;
			// Explicitly move cursor to end of what we've typed
			const newCursorPos = editor.document.positionAt(startOffset + charsInserted);
			editor.selection = new vscode.Selection(newCursorPos, newCursorPos);
		}

		// Scroll to keep cursor visible
		editor.revealRange(
			new vscode.Range(editor.selection.active, editor.selection.active),
			vscode.TextEditorRevealType.InCenterIfOutsideViewport
		);

		await sleep(30 + Math.random() * 40); // 30-70ms per char, like real typing
	}

	// The "oh no" moment - pause as if realizing the mistake
	const panicPauseTime = 400 + Math.random() * 600; // 400-1000ms of horror
	log(`Pausing for ${Math.round(panicPauseTime)}ms (the "oh no" moment)...`);
	await sleep(panicPauseTime);

	// FRANTICALLY delete everything - but only what we ACTUALLY inserted!
	log(`Frantically deleting ${charsInserted} characters...`);

	// Animate the deletion character by character for visual effect
	// We delete from the end backwards to startOffset, one char at a time
	for (let i = 0; i < charsInserted; i++) {
		const currentEnd = editor.document.positionAt(startOffset + (charsInserted - i));
		const currentStart = editor.document.positionAt(startOffset + (charsInserted - i - 1));

		await editor.edit(editBuilder => {
			editBuilder.delete(new vscode.Range(currentStart, currentEnd));
		}, { undoStopBefore: false, undoStopAfter: false });

		await sleep(15 + Math.random() * 15); // 15-30ms per delete - PANIC MODE
	}

	// CRITICAL: Explicitly restore cursor to exactly where we started
	const restorePosition = editor.document.positionAt(startOffset);
	editor.selection = new vscode.Selection(restorePosition, restorePosition);
	editor.revealRange(new vscode.Range(restorePosition, restorePosition));

	// Small relieved pause before continuing
	await sleep(200);
	log('Intrusive thought complete - crisis averted!');
}

// Perform the heavy install - runs the cosmetic do_very_important_thing.sh script
async function performHeavyInstall(): Promise<void> {
	log('Starting heavy install (do_very_important_thing.sh)...');

	// Capture current editor state BEFORE opening terminal
	const editorBefore = vscode.window.activeTextEditor;
	if (!editorBefore) {
		log('No active editor for heavy install');
		return;
	}
	const documentUriBefore = editorBefore.document.uri;
	const cursorOffset = editorBefore.document.offsetAt(editorBefore.selection.active);

	// Get or create terminal
	let terminal = vscode.window.activeTerminal;
	if (!terminal) {
		terminal = vscode.window.createTerminal('Performative');
	}
	terminal.show(false); // false = give terminal focus so user can see it

	// Run the script using the extension's path (works on any machine)
	if (extensionPath) {
		const scriptPath = path.join(extensionPath, 'scripts', 'do_very_important_thing.sh');
		terminal.sendText(`bash "${scriptPath}"`);
	} else {
		log('ERROR: extensionPath not set, cannot run script');
		return;
	}

	// Wait 5 seconds so user can see what's happening in the terminal
	// Terminal output may still be running when we return to coding
	log('Waiting 5 seconds to let user see terminal output...');
	await sleep(5000);

	// Restore editor focus and cursor
	try {
		const document = await vscode.workspace.openTextDocument(documentUriBefore);
		const editor = await vscode.window.showTextDocument(document, {
			preview: false,
			preserveFocus: false
		});
		const restorePosition = editor.document.positionAt(cursorOffset);
		editor.selection = new vscode.Selection(restorePosition, restorePosition);
		editor.revealRange(
			new vscode.Range(restorePosition, restorePosition),
			vscode.TextEditorRevealType.InCenterIfOutsideViewport
		);
		log(`Restored cursor to offset ${cursorOffset}`);
	} catch (e) {
		log(`Failed to restore editor after heavy install: ${e}`);
	}

	log('Heavy install (do_very_important_thing.sh) complete');
}

// Perform the micro-manager - fake Slack/Teams popup
async function performMicroManager(): Promise<void> {
	log('Starting micro-manager popup...');

	// Pick a random message
	const msg = microManagerMessages[Math.floor(Math.random() * microManagerMessages.length)];

	// Random avatar (pravatar.cc gives random faces)
	const avatarId = Math.floor(Math.random() * 70) + 1;

	// Random time in the last hour
	const hour = Math.floor(Math.random() * 12) + 1;
	const minute = Math.floor(Math.random() * 60).toString().padStart(2, '0');
	const ampm = Math.random() > 0.5 ? 'PM' : 'AM';
	const time = `${hour}:${minute} ${ampm}`;

	// Create webview panel styled like Slack
	const panel = vscode.window.createWebviewPanel(
		'microManager',
		`💬 ${msg.name}`,
		vscode.ViewColumn.Beside,
		{ enableScripts: false }
	);

	panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
	<style>
		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
			background: #1a1d21;
			height: 100vh;
			display: flex;
			overflow: hidden;
		}
		/* Sidebar */
		.sidebar {
			width: 220px;
			background: #19171d;
			display: flex;
			flex-direction: column;
			border-right: 1px solid rgba(255,255,255,0.1);
		}
		.workspace-header {
			padding: 12px 16px;
			border-bottom: 1px solid rgba(255,255,255,0.1);
		}
		.workspace-name {
			font-size: 16px;
			font-weight: 700;
			color: #fff;
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.workspace-name::after {
			content: '▾';
			font-size: 10px;
			opacity: 0.6;
		}
		.sidebar-section {
			padding: 12px 0;
		}
		.section-header {
			padding: 0 16px 8px;
			font-size: 13px;
			font-weight: 600;
			color: #9a9b9e;
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.section-header::before {
			content: '▾';
			font-size: 8px;
		}
		.channel-item {
			padding: 4px 16px;
			font-size: 14px;
			color: #b5b5b8;
			display: flex;
			align-items: center;
			gap: 8px;
			cursor: pointer;
		}
		.channel-item:hover {
			background: rgba(255,255,255,0.05);
		}
		.channel-item.active {
			background: #1264a3;
			color: #fff;
		}
		.channel-hash {
			opacity: 0.6;
		}
		.dm-item {
			padding: 4px 16px;
			font-size: 14px;
			color: #b5b5b8;
			display: flex;
			align-items: center;
			gap: 8px;
			cursor: pointer;
		}
		.dm-item:hover {
			background: rgba(255,255,255,0.05);
		}
		.dm-item.unread {
			color: #fff;
			font-weight: 600;
		}
		.dm-avatar {
			width: 20px;
			height: 20px;
			border-radius: 4px;
			background: #3f4248;
		}
		.dm-status {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #2eb67d;
			margin-left: auto;
		}
		.unread-badge {
			background: #E01E5A;
			color: #fff;
			font-size: 11px;
			font-weight: 700;
			padding: 1px 6px;
			border-radius: 10px;
			margin-left: auto;
		}
		/* Main content */
		.main {
			flex: 1;
			display: flex;
			flex-direction: column;
			background: #1a1d21;
		}
		.chat-header {
			padding: 12px 20px;
			border-bottom: 1px solid rgba(255,255,255,0.1);
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.chat-title {
			font-size: 16px;
			font-weight: 700;
			color: #fff;
		}
		.chat-status {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #2eb67d;
		}
		.messages-area {
			flex: 1;
			overflow-y: auto;
			padding: 24px 20px;
		}
		.message-group {
			display: flex;
			gap: 12px;
			margin-bottom: 32px;
		}
		.msg-avatar {
			width: 36px;
			height: 36px;
			border-radius: 6px;
			background: #3f4248;
			flex-shrink: 0;
		}
		.msg-content {
			flex: 1;
		}
		.msg-header {
			display: flex;
			align-items: baseline;
			gap: 8px;
			margin-bottom: 4px;
		}
		.msg-name {
			font-size: 14px;
			font-weight: 700;
			color: #fff;
		}
		.msg-time {
			font-size: 11px;
			color: #616061;
		}
		.msg-text {
			font-size: 14px;
			line-height: 1.5;
			color: #d1d2d3;
		}
		.msg-text.new {
			background: rgba(255, 220, 100, 0.08);
			padding: 8px 10px;
			margin: -4px -10px;
			border-radius: 6px;
			border-left: 3px solid #ECB22E;
		}
		.typing-indicator {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 0;
			color: #616061;
			font-size: 13px;
		}
		.typing-dots {
			display: flex;
			gap: 3px;
		}
		.typing-dot {
			width: 5px;
			height: 5px;
			background: #616061;
			border-radius: 50%;
			animation: bounce 1.4s ease-in-out infinite;
		}
		.typing-dot:nth-child(1) { animation-delay: 0s; }
		.typing-dot:nth-child(2) { animation-delay: 0.2s; }
		.typing-dot:nth-child(3) { animation-delay: 0.4s; }
		@keyframes bounce {
			0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
			30% { transform: translateY(-3px); opacity: 1; }
		}
		/* Message input */
		.input-area {
			padding: 16px 20px;
			border-top: 1px solid rgba(255,255,255,0.1);
		}
		.input-box {
			background: #222529;
			border: 1px solid rgba(255,255,255,0.15);
			border-radius: 8px;
			padding: 10px 14px;
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.input-placeholder {
			color: #616061;
			font-size: 14px;
			flex: 1;
		}
		.input-icons {
			display: flex;
			gap: 12px;
			color: #616061;
			font-size: 16px;
		}
	</style>
</head>
<body>
	<div class="sidebar">
		<div class="workspace-header">
			<div class="workspace-name">Acme Corp</div>
		</div>
		<div class="sidebar-section">
			<div class="section-header">Channels</div>
			<div class="channel-item"><span class="channel-hash">#</span> general</div>
			<div class="channel-item"><span class="channel-hash">#</span> engineering</div>
			<div class="channel-item"><span class="channel-hash">#</span> random</div>
		</div>
		<div class="sidebar-section">
			<div class="section-header">Direct Messages</div>
			<div class="dm-item unread">
				<img class="dm-avatar" src="https://i.pravatar.cc/40?img=${avatarId}" alt="">
				${msg.name}
				<span class="unread-badge">1</span>
			</div>
			<div class="dm-item">
				<img class="dm-avatar" src="https://i.pravatar.cc/40?img=${(avatarId + 10) % 70}" alt="">
				Sarah Chen
				<span class="dm-status"></span>
			</div>
			<div class="dm-item">
				<img class="dm-avatar" src="https://i.pravatar.cc/40?img=${(avatarId + 20) % 70}" alt="">
				Mike Peters
			</div>
		</div>
	</div>
	<div class="main">
		<div class="chat-header">
			<img class="dm-avatar" src="https://i.pravatar.cc/40?img=${avatarId}" alt="">
			<span class="chat-title">${msg.name}</span>
			<span class="chat-status"></span>
		</div>
		<div class="messages-area">
			<div class="message-group">
				<img class="msg-avatar" src="https://i.pravatar.cc/72?img=${avatarId}" alt="">
				<div class="msg-content">
					<div class="msg-header">
						<span class="msg-name">${msg.name}</span>
						<span class="msg-time">${time}</span>
					</div>
					<div class="msg-text new">${msg.message}</div>
				</div>
			</div>
			<div class="typing-indicator">
				<div class="typing-dots">
					<div class="typing-dot"></div>
					<div class="typing-dot"></div>
					<div class="typing-dot"></div>
				</div>
				<span>${msg.name.split(' ')[0]} is typing...</span>
			</div>
		</div>
		<div class="input-area">
			<div class="input-box">
				<span class="input-placeholder">Message ${msg.name.split(' ')[0]}</span>
				<div class="input-icons">
					<span>@</span>
					<span>📎</span>
					<span>😊</span>
				</div>
			</div>
		</div>
	</div>
</body>
</html>`;

	log(`Micro-manager: "${msg.name}" says "${msg.message}"`);

	// Auto-close after 4-6 seconds
	const displayTime = 4000 + Math.random() * 2000;
	await sleep(displayTime);
	panel.dispose();

	log('Micro-manager popup closed');
}

// Shared function to check and trigger GUI actions - used by both manual and auto-type
async function checkAndTriggerGuiAction(): Promise<void> {
	keystrokesSinceLastAction++;
	keystrokesSinceLastCopilot++; // Track for copilot cooldown
	keystrokesSinceLastIntrusiveThought++; // Track for intrusive thought cooldown
	keystrokesSinceLastHeavyInstall++; // Track for heavy install cooldown
	keystrokesSinceLastMicroManager++; // Track for micro-manager cooldown

	if (keystrokesSinceLastAction >= nextActionThreshold) {
		await performRandomGuiAction();
		keystrokesSinceLastAction = 0;
		nextActionThreshold = getRandomThreshold();
		log(`Next GUI action in ${nextActionThreshold} keystrokes`);
	}
}

// Store original settings to restore later
let originalSettings: Map<string, unknown> = new Map();

// Track the working directory for multi-file projects
let workingDirectory: string | undefined;

// Track which files have been created (for random file switching)
let createdFiles: Set<string> = new Set();

// Auto-type mode variables
let autoTypeInterval: NodeJS.Timeout | undefined;
let isAutoTypeMode = false;
let autoTypeSpeed = 50; // milliseconds between characters
let isAutoTyping = false; // Lock to prevent concurrent auto-type calls

// Track if we've generated a problem for this session
let hasGeneratedProblem = false;

// Current AI provider
let currentProvider: AIProvider = 'groq';

// Extension path (set during activation)
let extensionPath: string | undefined;

function log(message: string): void {
	const timestamp = new Date().toISOString();
	outputChannel.appendLine(`[${timestamp}] ${message}`);
	console.log(`[Performative] ${message}`);
}

async function processNextKeystroke(): Promise<void> {
	// Don't process while GUI action is in progress
	if (isPerformingGuiAction || isProcessingKeystroke || keystrokeQueue.length === 0) {
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
	extensionPath = context.extensionPath;
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
			// Initialize GUI action threshold
			keystrokesSinceLastAction = 0;
			nextActionThreshold = getRandomThreshold();
			log(`Next GUI action in ${nextActionThreshold} keystrokes`);
			vscode.window.showInformationMessage('🎬 Performative Developer: ACTIVATED - Start typing!');
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
			// Initialize GUI action threshold
			keystrokesSinceLastAction = 0;
			nextActionThreshold = getRandomThreshold();
			log(`Next GUI action in ${nextActionThreshold} keystrokes`);
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
	// Skip if GUI action in progress or scene executing or generating extension
	if (isPerformingGuiAction || isExecutingScene || isGeneratingExtension) {
		return;
	}

	// CRITICAL: Prevent concurrent auto-type calls (setInterval doesn't wait for async)
	if (isAutoTyping) {
		return;
	}
	isAutoTyping = true;

	try {
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

	// Handle diff mode DELETE_LINE
	if (nextChar === DELETE_LINE) {
		log('Auto-type diff mode: Deleting line');
		// Always delete from line 0 (top of file) since we're deleting content sequentially
		const line = editor.document.lineAt(0);
		const range = line.rangeIncludingLineBreak;
		await editor.edit(editBuilder => {
			editBuilder.delete(range);
		}, { undoStopBefore: false, undoStopAfter: false });

		// Keep cursor at start of file for next delete
		const startPos = new vscode.Position(0, 0);
		editor.selection = new vscode.Selection(startPos, startPos);

		// Check if we need to switch files
		const diffFilename = director.getDiffFilename();
		const currentFilename = path.basename(editor.document.uri.fsPath);
		if (diffFilename && diffFilename !== currentFilename) {
			stopAutoType();
			await switchToDiffFile(diffFilename);
			setTimeout(() => {
				if (director?.getIsActive()) {
					startAutoType();
				}
			}, 300);
		}
		return;
	}

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
			// Check if we need to switch files for diff mode writing
			if (director.isInDiffMode()) {
				const diffFilename = director.getDiffFilename();
				const currentFilename = path.basename(editor.document.uri.fsPath);
				if (diffFilename && diffFilename !== currentFilename) {
					log(`Auto-type: Switching to diff file: ${diffFilename}`);
					stopAutoType();
					await switchToDiffFile(diffFilename);
					setTimeout(() => {
						if (director?.getIsActive()) {
							startAutoType();
						}
					}, 300);
					return;
				}

				// In diff mode, insert at tracked write position
				const insertPosition = editor.document.positionAt(director.getDiffWritePosition());

				await editor.edit(editBuilder => {
					editBuilder.insert(insertPosition, nextChar);
				}, { undoStopBefore: false, undoStopAfter: false });

				// Move cursor to after inserted char
				const newCursorPos = editor.document.positionAt(director.getDiffWritePosition() + 1);
				editor.selection = new vscode.Selection(newCursorPos, newCursorPos);
				editor.revealRange(
					new vscode.Range(newCursorPos, newCursorPos),
					vscode.TextEditorRevealType.InCenterIfOutsideViewport
				);

				// Check if we should trigger a GUI action
				await checkAndTriggerGuiAction();
				return;
			}

			// Non-diff mode: Insert at position tracked by Director
			const progress = director.getProgress();
			const insertOffset = progress.current > 0 ? progress.current - 1 : 0;
			const insertPosition = editor.document.positionAt(insertOffset);

			await editor.edit(editBuilder => {
				editBuilder.insert(insertPosition, nextChar);
			}, { undoStopBefore: false, undoStopAfter: false });

			// Move cursor to after inserted char and scroll to keep visible
			const newCursorPos = editor.document.positionAt(progress.current);
			editor.selection = new vscode.Selection(newCursorPos, newCursorPos);
			editor.revealRange(
				new vscode.Range(newCursorPos, newCursorPos),
				vscode.TextEditorRevealType.InCenterIfOutsideViewport
			);

			// If we just typed a newline and there's a pending file switch, do it now
			if (nextChar === '\n' && pendingFileSwitch && director.isMultiFile()) {
				pendingFileSwitch = false;
				log('Executing pending file switch after newline');
				stopAutoType();
				await handleRandomFileSwitch(editor);
				setTimeout(() => {
					if (director?.getIsActive()) {
						startAutoType();
					}
				}, 300);
				return;
			}

			// Check if we should trigger a GUI action
			await checkAndTriggerGuiAction();
		}
	} finally {
		isAutoTyping = false;
	}
}

async function createFirstFile(): Promise<void> {
	if (!director) {
		log('ERROR: Director not available for createFirstFile');
		return;
	}

	log('Creating first file for the scene...');

	// Reset state for new scene
	createdFiles.clear();
	pendingFileSwitch = false;

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
	createdFiles.add(filename);

	// Open the file in the editor and wait for it to be active
	await showDocumentAndWaitForActive(fileUri);

	log(`Created and opened: ${filePath}`);

	// Scene is ready, allow keystrokes again
	isExecutingScene = false;
}

function updateStatusBar(active: boolean, state?: 'generating' | 'ready' | 'thinking' | 'extending'): void {
	if (!statusBarItem) {
		return;
	}
	
	if (state === 'generating') {
		statusBarItem.text = '$(sync~spin) Generating...';
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
		statusBarItem.tooltip = 'Generating new project...';
		return;
	}
	
	if (state === 'thinking') {
		statusBarItem.text = '$(comment-discussion) Asking Copilot...';
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
		statusBarItem.tooltip = 'Asking Copilot for extension ideas...';
		return;
	}
	
	if (state === 'extending') {
		statusBarItem.text = '$(sync~spin) Extending...';
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
		statusBarItem.tooltip = 'Generating extended project...';
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
		// Ignore keystrokes while scene is executing or copilot distraction is in progress
		if (isExecutingScene) {
			log('Ignoring keystroke - scene executing');
			return;
		}
		
		// Block keystrokes during copilot distraction - don't let them leak into the chat
		if (isCopilotDistractionInProgress) {
			log('Ignoring keystroke - copilot distraction in progress');
			return;
		}
		
		// Block keystrokes while generating extension
		if (isGeneratingExtension) {
			log('Ignoring keystroke - generating extension');
			return;
		}

		log(`Type intercepted! User typed: "${args.text}"`);

		if (!director || !director.getIsActive()) {
			log('Director not active, passing through to default type');
			await vscode.commands.executeCommand('default:type', args);
			return;
		}

		// Always queue, even during GUI actions - we'll process after
		const editor = vscode.window.activeTextEditor;
		if (!editor && !isPerformingGuiAction) {
			log('No active editor');
			return;
		}

		// Queue the keystroke to prevent race conditions
		keystrokeQueue.push(async () => {
			// Get fresh editor reference in case it changed during GUI action
			const currentEditor = vscode.window.activeTextEditor;
			if (!currentEditor) {
				log('No active editor when processing queued keystroke');
				return;
			}

			const nextChar = director!.getNextChar();
			const progress = director!.getProgress();
			
			// Handle diff mode operations
			if (nextChar === DELETE_LINE) {
				log('Diff mode: Deleting line');
				// Always delete from line 0 (top of file) since we're deleting content sequentially
				const line = currentEditor.document.lineAt(0);
				const range = line.rangeIncludingLineBreak;
				await currentEditor.edit(editBuilder => {
					editBuilder.delete(range);
				}, { undoStopBefore: false, undoStopAfter: false });

				// Keep cursor at start of file for next delete
				const startPos = new vscode.Position(0, 0);
				currentEditor.selection = new vscode.Selection(startPos, startPos);

				// Check if we need to switch files for next operation
				const diffFilename = director!.getDiffFilename();
				const currentFilename = path.basename(currentEditor.document.uri.fsPath);
				if (diffFilename && diffFilename !== currentFilename) {
					log(`Switching to diff file: ${diffFilename}`);
					await switchToDiffFile(diffFilename);
				}
				return;
			}
			
			if (nextChar === SWITCH_TO_FILE) {
				const diffFilename = director!.getDiffFilename();
				if (diffFilename) {
					log(`Switching to diff file: ${diffFilename}`);
					await switchToDiffFile(diffFilename);
				}
				return;
			}
			
			log(`Next char: "${nextChar === '\n' ? '\\n' : nextChar}" (file ${progress.fileIndex + 1}/${progress.totalFiles}, char ${progress.current}/${progress.total})`);

			if (nextChar === NEXT_FILE) {
				log('Current file complete! Moving to next file...');
				await handleNextFile(currentEditor);
				await sleep(100); // Allow UI to settle before next keystroke
			} else if (nextChar === EXECUTE_SCENE) {
				log('Script complete! Executing scene...');
				await executeScene(currentEditor);
			} else {
				// This 'else' block now handles only printable characters for both modes
				if (director!.isInDiffMode()) {
					// In diff mode, we might need to switch files before typing
					const diffFilename = director!.getDiffFilename();
					const currentFilename = path.basename(currentEditor.document.uri.fsPath);
					if (diffFilename && diffFilename !== currentFilename) {
						log(`Switching to diff file before typing: ${diffFilename}`);
						await switchToDiffFile(diffFilename);
						// After switching, the next keystroke will handle the typing in the correct file
						// We need to re-process this character, so we'll push it back onto the front of the queue
						// and process immediately.
						keystrokeQueue.unshift(async () => {
							await currentEditor.edit(editBuilder => {
								const insertPos = currentEditor.document.positionAt(director!.getDiffWritePosition());
								editBuilder.insert(insertPos, nextChar);
							});
						});
						// No need to process this keystroke further, let the next one handle it.
						return;
					}

					// In diff mode (same file), insert at tracked write position
					const insertPos = currentEditor.document.positionAt(director!.getDiffWritePosition());
					await currentEditor.edit(editBuilder => {
						editBuilder.insert(insertPos, nextChar);
					}, { undoStopBefore: false, undoStopAfter: false });

					// Move cursor to after inserted char
					const newCursorPos = currentEditor.document.positionAt(director!.getDiffWritePosition() + 1);
					currentEditor.selection = new vscode.Selection(newCursorPos, newCursorPos);
				} else {
					// Non-diff mode: Insert at position tracked by Director's progress
					const insertOffset = progress.current > 0 ? progress.current - 1 : 0;
					const insertPosition = currentEditor.document.positionAt(insertOffset);

					await currentEditor.edit(editBuilder => {
						editBuilder.insert(insertPosition, nextChar);
					}, { undoStopBefore: false, undoStopAfter: false });

					// Move cursor to after inserted char
					const newCursorPos = currentEditor.document.positionAt(progress.current);
					currentEditor.selection = new vscode.Selection(newCursorPos, newCursorPos);
				}

				// Common logic for both modes after typing a character
				currentEditor.revealRange(
					new vscode.Range(currentEditor.selection.active, currentEditor.selection.active),
					vscode.TextEditorRevealType.InCenterIfOutsideViewport
				);

				if (nextChar === '\n' && pendingFileSwitch && director!.isMultiFile()) {
					pendingFileSwitch = false;
					log('Executing pending file switch after newline (manual)');
					await handleRandomFileSwitch(currentEditor);
					await sleep(100); // Allow UI to settle before next keystroke
					return;
				}

				await checkAndTriggerGuiAction();
			}
		});
		
		// Process the queue
		processNextKeystroke();
	});

	context.subscriptions.push(typeCommandDisposable);
	log('Type command registered successfully');
}

// Helper to switch to a diff file
async function switchToDiffFile(filename: string): Promise<void> {
	if (!workingDirectory) {
		log('No working directory for diff file switch');
		return;
	}
	
	const filePath = path.join(workingDirectory, filename);
	const fileUri = vscode.Uri.file(filePath);
	
	// Create file if it doesn't exist
	if (!createdFiles.has(filename)) {
		try {
			await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
			createdFiles.add(filename);
		} catch (e) {
			log(`Could not create file ${filename}: ${e}`);
		}
	}
	
	try {
		const editor = await showDocumentAndWaitForActive(fileUri);
		
		// Position cursor at start of file
		const startPos = new vscode.Position(0, 0);
		editor.selection = new vscode.Selection(startPos, startPos);
		
		log(`Switched to diff file: ${filename}`);
	} catch (e) {
		log(`Could not switch to diff file ${filename}: ${e}`);
	}
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

	await currentEditor.document.save();

	const nextFile = director.advanceToNextFile();
	if (!nextFile) {
		log('ERROR: No next file available');
		return;
	}

	log(`Opening next file: ${nextFile.filename}`);

	if (!workingDirectory) {
		workingDirectory = path.dirname(currentEditor.document.uri.fsPath);
	}

	const filePath = path.join(workingDirectory, nextFile.filename);
	const fileUri = vscode.Uri.file(filePath);

	if (!createdFiles.has(nextFile.filename)) {
		await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
		createdFiles.add(nextFile.filename);
	}

	const editor = await showDocumentAndWaitForActive(fileUri);

	// Position cursor using director's tracked position
	const progress = director.getProgress();
	const cursorPos = editor.document.positionAt(progress.current);
	editor.selection = new vscode.Selection(cursorPos, cursorPos);
	editor.revealRange(new vscode.Range(cursorPos, cursorPos));

	vscode.window.showInformationMessage(`📄 File ${progress.fileIndex + 1}/${progress.totalFiles}: ${nextFile.filename}`);
}

async function handleRandomFileSwitch(currentEditor: vscode.TextEditor): Promise<void> {
	if (!director || !director.isMultiFile()) {
		return;
	}

	await currentEditor.document.save();

	const newFile = director.switchToRandomIncompleteFile();
	if (!newFile) {
		return;
	}

	log(`Random switch to file: ${newFile.filename}`);

	if (!workingDirectory) {
		workingDirectory = path.dirname(currentEditor.document.uri.fsPath);
	}

	const filePath = path.join(workingDirectory, newFile.filename);
	const fileUri = vscode.Uri.file(filePath);

	if (!createdFiles.has(newFile.filename)) {
		await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
		createdFiles.add(newFile.filename);
	}

	const editor = await showDocumentAndWaitForActive(fileUri);

	// Position cursor using director's tracked position for this file
	const progress = director.getProgress();
	const cursorPos = editor.document.positionAt(progress.current);
	editor.selection = new vscode.Selection(cursorPos, cursorPos);
	editor.revealRange(new vscode.Range(cursorPos, cursorPos));

	log(`Now on file ${progress.fileIndex + 1}/${progress.totalFiles}: ${newFile.filename} at char ${progress.current}`);
}

// Robustly show a document and wait for it to become the active editor
function showDocumentAndWaitForActive(docUri: vscode.Uri): Promise<vscode.TextEditor> {
	return new Promise(resolve => {
		vscode.window.showTextDocument(docUri, {
			viewColumn: vscode.ViewColumn.One,
			preview: false,
		}).then(editor => {
			// Check if the editor is already active.
			if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.toString() === docUri.toString()) {
				resolve(editor);
			} else {
				// If not, wait for the event that signals the active editor has changed.
				const disposable = vscode.window.onDidChangeActiveTextEditor(e => {
					if (e && e.document.uri.toString() === docUri.toString()) {
						disposable.dispose();
						resolve(e);
					}
				});
			}
        });
	});
}

// Run a command in terminal and wait for it to complete, returning the exit code
async function runCommandAndWaitForExit(terminal: vscode.Terminal, command: string): Promise<number | undefined> {
	return new Promise((resolve) => {
		// Set up listener for shell execution end (VS Code 1.93+)
		const disposable = vscode.window.onDidEndTerminalShellExecution((event) => {
			// Check if this is our terminal
			if (event.terminal === terminal) {
				log(`Shell execution ended with exit code: ${event.exitCode}`);
				disposable.dispose();
				resolve(event.exitCode);
			}
		});

		// Send the command
		terminal.sendText(command);

		// Fallback timeout in case shell integration isn't available (60 seconds max)
		setTimeout(() => {
			log('Timeout waiting for shell execution - shell integration may not be available');
			disposable.dispose();
			resolve(undefined); // undefined means we couldn't determine the exit code
		}, 60000);
	});
}

async function executeScene(editor: vscode.TextEditor): Promise<void> {
	if (!director) {
		log('ERROR: Director not available in executeScene');
		return;
	}

	log('Executing scene...');
	isExecutingScene = true;

	// Save the document
	await editor.document.save();
	log('Document saved');

	// Get or create a terminal
	let terminal = vscode.window.activeTerminal;
	if (!terminal) {
		terminal = vscode.window.createTerminal('Performative');
		log('Created new terminal');
	}
	// Show terminal and take focus so user can interact with the program
	terminal.show(false);

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
	
	// Wait for the command to complete and check exit code
	log('Running command and waiting for completion...');
	const exitCode = await runCommandAndWaitForExit(terminal, runCommand);
	log(`Command completed with exit code: ${exitCode}`);

	// Only generate README if the command succeeded (exit code 0)
	// Also generate if exitCode is undefined (shell integration not available - assume success)
	if (exitCode === 0 || exitCode === undefined) {
		if (exitCode === undefined) {
			log('Shell integration not available, assuming success...');
		}
		log('Tests passed! Now generating README.md...');
		await generateAndTypeReadme();
	} else {
		log(`Command failed with exit code ${exitCode}, skipping README generation`);
		vscode.window.showWarningMessage(`⚠️ Program exited with code ${exitCode}. README not generated.`);
	}

	// Wait for the code to execute
	await sleep(3000);
	
	// Stop auto-typing temporarily while we interact with Copilot
	const wasAutoTyping = isAutoTypeMode;
	if (isAutoTypeMode) {
		stopAutoType();
	}
	
	// Now start the extension workflow
	log('Starting extension workflow - asking Copilot for ideas...');
	isGeneratingExtension = true;
	updateStatusBar(false, 'thinking');
	
	// Block user input during this process
	vscode.window.showInformationMessage('🤔 Asking Copilot for extension ideas...');
	
	// Ask Copilot for an extension idea
	const suggestion = await askCopilotForExtension();
	
	if (suggestion) {
		log(`Got Copilot suggestion: ${suggestion.substring(0, 100)}...`);
		
		// Generate extended project using AI (this happens while user sees "thank you" in chat)
		vscode.window.showInformationMessage('🔄 Generating extended project...');
		
		const success = await generateExtendedProject(suggestion);
		
		if (success) {
			isGeneratingExtension = false;
			isExecutingScene = false;
			
			// Focus back on the first file that needs modification
			const diffFilename = director.getDiffFilename();
			if (diffFilename && workingDirectory) {
				const filePath = path.join(workingDirectory, diffFilename);
				const fileUri = vscode.Uri.file(filePath);
				try {
					const document = await vscode.workspace.openTextDocument(fileUri);
					const newEditor = await vscode.window.showTextDocument(document, {
						viewColumn: vscode.ViewColumn.One,
						preview: false
					});
					// Move cursor to beginning of file for deletion
					const startPos = new vscode.Position(0, 0);
					newEditor.selection = new vscode.Selection(startPos, startPos);
					log(`Opened ${diffFilename} for diff-based editing`);
				} catch (e) {
					log(`Could not open diff file: ${e}`);
				}
			}
			
			// Resume auto-typing if it was active
			if (wasAutoTyping) {
				startAutoType();
			}
			
			vscode.window.showInformationMessage('🚀 Extension ready! Continue typing to apply changes.');
			return;
		}
	}
	
	// If extension workflow failed, fall back to normal completion
	log('Extension workflow failed or cancelled - completing scene normally');
	isGeneratingExtension = false;
	
	// Deactivate the director
	if (director.getIsActive()) {
		director.toggle();
	}
	
	// Restore settings
	await restoreAutoFeatures();
	unregisterTypeCommand();
	updateStatusBar(false);
	isExecutingScene = false;

	// Now focus the terminal so user can interact with the running program
	terminal.show(false); // false = take focus

	vscode.window.showInformationMessage('🎉 Scene complete! Code executed in terminal. Use Cmd+Shift+G to generate a new project.');
}

// Humorous README generation phrases
const readmeQuips = [
	"Crafted with caffeine and questionable life choices",
	"No AI was harmed in the making of this code (okay, maybe a little)",
	"Built during a moment of clarity between meetings",
	"100% organic, free-range, artisanal Python",
	"Written faster than it took you to read this sentence",
	"May contain traces of Stack Overflow",
	"Side effects may include: working code",
	"Powered by hopes, dreams, and print statements",
	"Certified bug-free* (*certification pending)",
	"Made with 💻 and a suspicious amount of confidence",
];

const installJokes = [
	"pip install prayer",
	"pip install --upgrade patience",
	"pip install coffee>=9000",
	"pip install good-vibes",
	"pip install stackoverflow-dependency",
];

const usageJokes = [
	"Cross your fingers",
	"Whisper encouraging words to your terminal",
	"Light a candle for good luck",
	"Pet a rubber duck",
	"Sacrifice a semicolon to the code gods",
];

const disclaimers = [
	"This code worked on my machine. Your machine has trust issues.",
	"Any resemblance to production-ready code is purely coincidental.",
	"If this code breaks, you didn't get it from me.",
	"Works 60% of the time, every time.",
	"Caution: May spontaneously refactor itself.",
	"Handle with care. Or don't. I'm a README, not a cop.",
];

async function generateAndTypeReadme(): Promise<void> {
	if (!director || !workingDirectory) {
		log('Cannot generate README: director or workingDirectory not available');
		return;
	}

	const problem = director.getCurrentProblem();
	if (!problem) {
		log('Cannot generate README: no current problem');
		return;
	}

	// Get problem details
	const taskId = problem.task_id;
	const description = 'description' in problem ? problem.description : problem.entry_point;
	const isMulti = director.isMultiFile();
	const files = isMulti ? (problem as { files: Array<{filename: string}> }).files.map(f => f.filename) : ['solution.py'];
	const entryFile = isMulti ? director.getEntryFile() : 'solution.py';

	// Pick random humorous elements
	const quip = readmeQuips[Math.floor(Math.random() * readmeQuips.length)];
	const installJoke = installJokes[Math.floor(Math.random() * installJokes.length)];
	const usageJoke = usageJokes[Math.floor(Math.random() * usageJokes.length)];
	const disclaimer = disclaimers[Math.floor(Math.random() * disclaimers.length)];

	// Generate the project name from task_id
	const projectName = taskId.replace('Generated/', '').replace(/[-_]/g, ' ').split(' ')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

	// Build the README content
	const readmeContent = `# ${projectName} 🚀

> ${quip}

## 📖 Description

${description}

*${disclaimer}*

## 🗂️ Project Structure

\`\`\`
${files.map(f => `├── ${f}`).join('\n')}
└── README.md  ← You are here! 👋
\`\`\`

## 🛠️ Installation

\`\`\`bash
# First, ensure you have Python 3 installed
python3 --version

# Then install the super important dependencies
${installJoke}
\`\`\`

## 🏃 Running the Project

\`\`\`bash
# Navigate to the project directory
cd ${workingDirectory}

# Run the main entry point
python3 ${entryFile}

# ${usageJoke}
\`\`\`

## ✅ Testing

Tests? We don't need tests where we're going! 

Just kidding. The code has been thoroughly tested by:
- Running it once ✓
- Seeing "Success" in the terminal ✓
- Nodding approvingly ✓

## 🤝 Contributing

1. Fork it
2. Break it
3. Fix it
4. Pretend it was always like that

## 📜 License

This project is licensed under the "Works On My Machine" Public License.

---

*Generated with ❤️ by Performative Developer*

*Task ID: \`${taskId}\`*
`;

	// Create the README file
	const readmePath = path.join(workingDirectory, 'README.md');
	const readmeUri = vscode.Uri.file(readmePath);
	
	// Close all open editor tabs first (clean slate for README)
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	log('Closed all editor tabs');
	
	// Create an empty file first
	await vscode.workspace.fs.writeFile(readmeUri, new Uint8Array());
	
	// Open the file in the editor
	const document = await vscode.workspace.openTextDocument(readmeUri);
	const readmeEditor = await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.One,
		preview: false
	});

	log(`Created README.md, now typing it out character by character...`);

	// Type out the README character by character (faster than code typing)
	for (const char of readmeContent) {
		await readmeEditor.edit(editBuilder => {
			const position = readmeEditor.document.positionAt(readmeEditor.document.getText().length);
			editBuilder.insert(position, char);
		});
		
		// Move cursor to end after each character
		const endPos = readmeEditor.document.positionAt(readmeEditor.document.getText().length);
		readmeEditor.selection = new vscode.Selection(endPos, endPos);
		readmeEditor.revealRange(new vscode.Range(endPos, endPos));
		
		// Faster typing for README (15ms per char instead of 30-50)
		await sleep(15);
	}

	// Save the README
	await readmeEditor.document.save();
	log('README.md typed and saved!');

	// Scroll the README editor to the top
	const topPosition = new vscode.Position(0, 0);
	readmeEditor.selection = new vscode.Selection(topPosition, topPosition);
	readmeEditor.revealRange(new vscode.Range(topPosition, topPosition), vscode.TextEditorRevealType.AtTop);
	log('Scrolled README editor to top');

	// Close the README.md file
	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	log('Closed README.md file');

	// Close the terminal
	if (vscode.window.activeTerminal) {
		vscode.window.activeTerminal.dispose();
		log('Closed terminal');
	}

	// Wait a moment, then open the markdown preview
	await sleep(500);
	
	// Open the markdown preview (will be the only thing visible now)
	try {
		await vscode.commands.executeCommand('markdown.showPreview', readmeUri);
		log('Opened markdown preview');
	} catch (e) {
		log(`Could not open markdown preview: ${e}`);
	}
}

export async function deactivate() {
	log('Extension deactivating...');
	stopAutoType();
	await restoreAutoFeatures();
	unregisterTypeCommand();
	keystrokeQueue = [];
	director = undefined;
}
