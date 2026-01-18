import * as vscode from 'vscode';

const API_KEY_SECRET = 'performative.openai.apiKey';

export class ApiKeyManager {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Store the API key securely in VSCode's secret storage
     */
    async storeApiKey(apiKey: string): Promise<void> {
        await this.context.secrets.store(API_KEY_SECRET, apiKey);
    }

    /**
     * Retrieve the API key from secret storage
     */
    async getApiKey(): Promise<string | undefined> {
        return await this.context.secrets.get(API_KEY_SECRET);
    }

    /**
     * Delete the stored API key
     */
    async deleteApiKey(): Promise<void> {
        await this.context.secrets.delete(API_KEY_SECRET);
    }

    /**
     * Check if an API key is stored
     */
    async hasApiKey(): Promise<boolean> {
        const key = await this.getApiKey();
        return key !== undefined && key.length > 0;
    }

    /**
     * Prompt user for API key with input validation
     */
    async promptForApiKey(): Promise<string | undefined> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your OpenAI API Key',
            placeHolder: 'sk-...',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return 'API key cannot be empty';
                }
                if (!value.startsWith('sk-')) {
                    return 'OpenAI API keys typically start with "sk-"';
                }
                return null;
            }
        });

        if (apiKey) {
            await this.storeApiKey(apiKey.trim());
            return apiKey.trim();
        }

        return undefined;
    }

    /**
     * Ensure API key is available, prompting if necessary
     */
    async ensureApiKey(): Promise<string | undefined> {
        let apiKey = await this.getApiKey();

        if (!apiKey) {
            const result = await vscode.window.showInformationMessage(
                '🤖 Performative Developer needs an OpenAI API key to generate coding problems.',
                'Enter API Key',
                'Cancel'
            );

            if (result === 'Enter API Key') {
                apiKey = await this.promptForApiKey();
            }
        }

        return apiKey;
    }
}
