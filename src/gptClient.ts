import { MultiFileProblem } from "./problemManager";
import { ProblemGenerator } from "./problemGenerator";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature: number;
  max_tokens: number;
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class GPTClient {
  private apiKey: string;
  private apiEndpoint = "https://api.openai.com/v1/chat/completions";
  private model = "gpt-4o-mini"; // Using a fast, cost-effective model

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Generate a multi-file coding problem using GPT
   */
  async generateProblem(): Promise<MultiFileProblem> {
    console.log('[GPTClient] generateProblem() called');
    const prompt = ProblemGenerator.getSimplePrompt();
    console.log('[GPTClient] Generated prompt from ProblemGenerator');

    const requestBody: OpenAIRequest = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful coding assistant that generates complete, working Python projects. Always return valid JSON without markdown formatting.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    };

    try {
      console.log('[GPTClient] Making API request to OpenAI...');
      const response = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[GPTClient] API response status: ${response.status}`);

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`[GPTClient] API error response: ${errorData}`);

        // Check if it's an authentication error
        if (response.status === 401) {
          throw new Error(`Authentication failed - Invalid API key. Please check your OpenAI API key.`);
        }

        throw new Error(`OpenAI API error (${response.status}): ${errorData}`);
      }

      console.log('[GPTClient] Parsing API response...');
      // @ts-ignore - fetch response.json() type inference issue
      const data: OpenAIResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        console.error('[GPTClient] No choices in API response');
        throw new Error("No response from OpenAI API");
      }

      const content = data.choices[0].message.content;
      console.log(`[GPTClient] Received content (${content.length} chars)`);

      // Parse the JSON response (handle potential markdown code blocks)
      let jsonContent = content.trim();
      console.log('[GPTClient] Parsing JSON content...');
      console.log('[GPTClient] Raw content preview (first 500 chars):', jsonContent.substring(0, 500));

      // Remove markdown code blocks if present
      if (jsonContent.startsWith("```json")) {
        jsonContent = jsonContent
          .replace(/^```json\s*/, "")
          .replace(/\s*```$/, "");
        console.log('[GPTClient] Removed ```json markdown');
      } else if (jsonContent.startsWith("```")) {
        jsonContent = jsonContent.replace(/^```\s*/, "").replace(/\s*```$/, "");
        console.log('[GPTClient] Removed ``` markdown');
      }

      console.log('[GPTClient] Cleaned content preview (first 500 chars):', jsonContent.substring(0, 500));

      let problem: MultiFileProblem;
      try {
        problem = JSON.parse(jsonContent);
        console.log('[GPTClient] JSON parsed successfully');
      } catch (parseError) {
        console.error('[GPTClient] JSON parse failed!');
        console.error('[GPTClient] Error:', parseError);
        console.error('[GPTClient] Full content length:', jsonContent.length);
        console.error('[GPTClient] Content around error position (chars 1000-1100):', jsonContent.substring(1000, 1100));
        throw parseError;
      }

      // Validate the response structure
      if (
        !problem.files ||
        !Array.isArray(problem.files) ||
        problem.files.length === 0
      ) {
        console.error('[GPTClient] Invalid problem: missing files array');
        throw new Error("Invalid problem structure: missing files array");
      }

      if (!problem.entry_file) {
        console.error('[GPTClient] Invalid problem: missing entry_file');
        throw new Error("Invalid problem structure: missing entry_file");
      }

      // Ensure type is set correctly
      problem.type = "multi";

      console.log(
        `[GPTClient] Generated problem: ${problem.task_id} with ${problem.files.length} files`,
      );
      console.log(
        `[GPTClient] Token usage: ${data.usage?.total_tokens || "unknown"} tokens`,
      );

      return problem;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse GPT response as JSON: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Generate extensions to an existing project based on suggestions
   */
  async extendProject(
    projectDescription: string,
    existingFiles: Array<{ filename: string; content: string }>,
    extensionSuggestions: string,
  ): Promise<MultiFileProblem> {
    const filesContext = existingFiles
      .map((f) => `${f.filename}:\n${f.content}`)
      .join("\n\n");

    const prompt = `You are extending an existing Python project with new features.

EXISTING PROJECT:
${projectDescription}

EXISTING FILES:
${filesContext}

EXTENSION SUGGESTIONS:
${extensionSuggestions}

Based on the suggestions above, extend this project with new features. You can:
1. Add new files for new functionality
2. Modify existing files to add features
3. Add tests for the new features

Return a complete updated project in this EXACT JSON format (valid JSON only, no markdown):
{
  "task_id": "extended_project_<random_number>",
  "type": "multi",
  "description": "<brief description including the new features>",
  "entry_file": "main.py",
  "files": [
    {
      "filename": "main.py",
      "content": "<complete updated python code>"
    },
    {
      "filename": "new_feature.py",
      "content": "<new feature code>"
    },
    {
      "filename": "test_new_feature.py",
      "content": "<tests for new features>"
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown code blocks
- Include ALL files (both existing and new)
- Make sure the code is functional and well-integrated
- Keep using only Python standard library (no external dependencies except pytest)`;

    const requestBody: OpenAIRequest = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful coding assistant that extends Python projects with new features. Always return valid JSON without markdown formatting.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    };

    try {
      const response = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.text();

        // Check if it's an authentication error
        if (response.status === 401) {
          throw new Error(`Authentication failed - Invalid API key. Please check your OpenAI API key.`);
        }

        throw new Error(`OpenAI API error (${response.status}): ${errorData}`);
      }

      // @ts-ignore - fetch response.json() type inference issue
      const data: OpenAIResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error("No response from OpenAI API");
      }

      const content = data.choices[0].message.content;

      // Parse the JSON response
      let jsonContent = content.trim();
      if (jsonContent.startsWith("```json")) {
        jsonContent = jsonContent
          .replace(/^```json\s*/, "")
          .replace(/\s*```$/, "");
      } else if (jsonContent.startsWith("```")) {
        jsonContent = jsonContent.replace(/^```\s*/, "").replace(/\s*```$/, "");
      }

      const problem: MultiFileProblem = JSON.parse(jsonContent);

      if (
        !problem.files ||
        !Array.isArray(problem.files) ||
        problem.files.length === 0
      ) {
        throw new Error("Invalid problem structure: missing files array");
      }

      problem.type = "multi";

      console.log(
        `Extended project: ${problem.task_id} with ${problem.files.length} files`,
      );
      console.log(
        `Token usage: ${data.usage?.total_tokens || "unknown"} tokens`,
      );

      return problem;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse GPT response as JSON: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Test the API key validity
   */
  async testApiKey(): Promise<boolean> {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error("API key test failed:", error);
      return false;
    }
  }
}
