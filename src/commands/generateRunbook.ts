import {
    spawnSync,
} from "child_process";
import { TextEncoder } from "util";
import * as vscode from "vscode";
import OpenAI from 'openai';
import { prepareProjectPrompt } from "../utils/preparePrompt";
import { verifyHasOpenAIKey } from "../extension";
import { showPromptPicker } from "../utils/promptPicker";
import { prepareRunbookFile } from "../utils/runbookFilename";

// Must match package.json contributed configuration
const ENDPOINT_ENUM_MAP = {
    OpenAI: "https://api.openai.com/v1",
    Ollama: "http://localhost:11434/v1"
};

const START_DOCKER_COMMAND = {
    'win32': 'Start-Process -NoNewWindow -Wait -FilePath "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"',
    'darwin': 'open -a Docker',
    'linux': 'systemctl --user start docker-desktop',
};

const DEFAULT_USER = "local-user";


export const generateRunbook = (secrets: vscode.SecretStorage) => vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async progress => {

    // Coerce the error to have an exit code
    type DockerSpawnError = Error & { code: number };

    try {
        const res = spawnSync("docker", ["version"]);

        if (res.error) {
            // Using -1 to indicate docker is not installed
            (res.error as DockerSpawnError).code = -1;
            throw res.error;
        }

        if (res.status !== 0) {
            const err = new Error(`Docker command exited with code ${res.status} and output the following error: ${res.error || res.stderr.toString()}`);
            // Using -1 as a fallback, should have already been caught by res.error
            (err as DockerSpawnError).code = res.status || -1;
            throw err;
        }

        // @ts-expect-error
    } catch (e: DockerSpawnError) {

        const platform = process.platform;
        const actionItems = e.code !== -1 ? [(platform in START_DOCKER_COMMAND ? "Start Docker" : "Try again")] : ["Install Docker Desktop", "Try again"];
        return vscode.window.showErrorMessage("Error starting Docker", { modal: true, detail: (e as DockerSpawnError).toString() }, ...actionItems).then(async (value) => {
            switch (value) {
                case "Start Docker":
                    spawnSync(START_DOCKER_COMMAND[platform as keyof typeof START_DOCKER_COMMAND], { shell: true });
                case "Install Docker Desktop":
                    vscode.env.openExternal(vscode.Uri.parse("https://www.docker.com/products/docker-desktop"));
                    return;
                case "Try again":
                    return vscode.commands.executeCommand("docker.make-runbook.generate");
            }
        });
    }

    progress.report({ increment: 0, message: "Starting..." });

    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
        return vscode.window.showErrorMessage("No workspace open");
    }

    let workspaceFolder = workspaceFolders[0];

    if (workspaceFolders.length > 1) {
        // Multi-root workspace support WIP
        const option = await vscode.window.showQuickPick(workspaceFolders.map(f => ({ label: f.name, detail: f.uri.fsPath, index: f.index })), {
            title: "Select workspace",
            ignoreFocusOut: true,
        });
        if (!option) {
            return vscode.window.showErrorMessage("No workspace selected");
        }
        workspaceFolder = workspaceFolders[option.index];
    }


    if (vscode.workspace.getConfiguration('docker.make-runbook').get('openai-base') === 'OpenAI') {
        await verifyHasOpenAIKey(secrets, true);
    }

    const promptOption = await showPromptPicker();

    if (!promptOption) {
        return;
    }

    let apiKey = await secrets.get("openAIKey");

    const { editor, doc } = (await prepareRunbookFile(workspaceFolder, promptOption.id) || {});

    if (!editor || !doc) {
        return;
    }

    progress.report({ increment: 5, message: "Detecting docker desktop token" });

    try {
        const auth = spawnSync(
            `echo "https://index.docker.io/v1//access-token" | docker-credential-desktop get`,
            {
                shell: process.platform === 'win32' ? "powershell" : true,
            }
        );

        let Username = DEFAULT_USER;

        if (auth.stdout.toString().startsWith("{") && auth.status === 0 && !auth.error) {
            try {
                const authPayload = JSON.parse(auth.stdout.toString()) as {
                    "ServerURL": string,
                    "Username": string,
                    "Secret": string
                };
                Username = authPayload.Username;
            }
            catch (e) {
                throw new Error(`Expected JSON from docker-credential-desktop, got STDOUT: ${auth.stdout.toString()} STDERR: ${auth.stderr.toString()} ERR: ${(auth.error || "N/A").toString()}`);
            }

        }

        progress.report({ increment: 5, message: "Starting LLM ..." });

        const openai = new OpenAI({
            apiKey: apiKey || '',
            baseURL: ENDPOINT_ENUM_MAP[(await vscode.workspace.getConfiguration("docker.make-runbook").get("openai-base") as 'Ollama' | 'OpenAI')]
        });

        progress.report({ increment: 5, message: "Preparing payload..." });

        const messages = prepareProjectPrompt(workspaceFolder, Username, promptOption.id);

        progress.report({ increment: 5, message: "Calling LLM..." });

        const model = await vscode.workspace.getConfiguration("docker.make-runbook").get("openai-model") as string;

        const completionStream = await openai.chat.completions.create({
            messages,
            model,
            stream: true
        });

        progress.report({ increment: 5, message: `Streaming ${model}` });
        const doc = editor.document;
        for await (const chunk of completionStream) {
            const edit = new vscode.WorkspaceEdit();
            const text = chunk.choices[0].delta.content || '';
            edit.insert(
                doc.uri,
                new vscode.Position(doc.lineCount, 0), text);
            await vscode.workspace.applyEdit(edit);
        }

        await doc.save();
    } catch (e: unknown) {
        e = e as Error;
        void vscode.window.showErrorMessage("Error generating runbook");
        await editor.edit((edit) => {
            edit.insert(
                new vscode.Position(editor.document.lineCount, 0),
                '```json\n' + (e as Error).toString() + '\n```'
            );
        });
        return;
    }
});