import { SecretStorage, window } from "vscode";

const setKey = async (secrets: SecretStorage) => {
    const key = await window.showInputBox({
        title: "OpenAI API Key",
        password: true,
        prompt: "Enter your OpenAI API key",
        ignoreFocusOut: true,
    });
    if (!key) {
        // return;
        await secrets.delete('openAIKey');
        return;
    }
    await secrets.store('openAIKey', key);
    void window.showInformationMessage("Secret set.");
};

export const setOpenAIKey = async (secrets: SecretStorage, skipQuickPick: boolean = false) => {
    if (skipQuickPick) {
        await setKey(secrets);
        return;
    }

    const option = await window.showQuickPick([{ label: "Set key" }, { label: "Delete key" }], {
        ignoreFocusOut: true,
    });
    if (!option) {
        return;
    }
    if (option.label === "Set key") {
        await setKey(secrets);
    } else {
        await secrets.delete('openAIKey');
        window.showInformationMessage('OpenAI key deleted');
    }

};