import * as vscode from "vscode";
import { AutoDevExtension } from "./AutoDevExtension";
import { NamedElement } from "./editor/ast/NamedElement";

import { channel } from "./channel";
import { PlantUMLPresenter } from "./editor/codemodel/presenter/PlantUMLPresenter";
import { AutoDocActionExecutor } from "./editor/action/autodoc/AutoDocActionExecutor";
import { AutoTestActionExecutor } from "./editor/action/autotest/AutoTestActionExecutor";
import { NamedElementBuilder } from "./editor/ast/NamedElementBuilder";
import { QuickActionService } from "./editor/editor-api/QuickAction";
import { SystemActionService } from "./editor/action/setting/SystemActionService";
import { toNamedElementBuilder } from "./code-context/ast/TreeSitterFileUtil";

const commandsMap: (
  extension: AutoDevExtension
) => {
  [command: string]: (...args: any) => any;
} = (extension) => ({
  "autodev.quickFix": async (message: string, code: string, edit: boolean) => {
    extension.sidebar.webviewProtocol?.request("newSessionWithPrompt", {
      prompt: `${
        edit ? "/edit " : ""
      }${code}\n\nHow do I fix this problem in the above code?: ${message}`,
    });

    if (!edit) {
      vscode.commands.executeCommand("autodev.autodevGUIView.focus");
    }
  },
  "autodev.sendToTerminal": (text: string) => {
    extension.action.runCommand(text).then(() => {}, (err) => vscode.window.showErrorMessage(err.message));
  },
  "autodev.debugTerminal": async () => {
    vscode.commands.executeCommand("autodev.autodevGUIView.focus");
    const terminalContents = await extension.action.getTerminalContents();
    extension.sidebar.webviewProtocol?.request("userInput", {
      input: `I got the following error, can you please help explain how to fix it?\n\n${terminalContents.trim()}`,
    });
  },
  "autodev.autoComment": async (
    document: vscode.TextDocument,
    range: NamedElement,
    edit: vscode.WorkspaceEdit
  ) => {
    await new AutoDocActionExecutor(document, range, edit).execute();
  },
  "autodev.autoTest": async (
    // in context menu, the first argument is not the document
    document?: vscode.TextDocument,
    element?: NamedElement,
    edit?: vscode.WorkspaceEdit
  ) => {
    const editor = vscode.window.activeTextEditor;
    const textDocument = editor?.document;
    if (!textDocument) { return; }

    let elementBuilder: NamedElementBuilder | null = null;
    await toNamedElementBuilder(textDocument).then((builder) => {
      elementBuilder = builder;
    }).catch((err) => {
      channel.appendLine(`Error: ${err}`);
    });

    if (elementBuilder === null) { return; }

    const selectionStart: number = editor?.selection.start.line ?? 0;
    const selectionEnd: number = editor?.selection.end.line ?? textDocument.lineCount;

    const nameElement = element || (elementBuilder as NamedElementBuilder)!!.getElementForSelection(selectionStart, selectionEnd)?.[0];
    if (!nameElement) { return;}

    const workspaceEdit = edit || new vscode.WorkspaceEdit();
    await new AutoTestActionExecutor(textDocument, nameElement, workspaceEdit).execute();
  },
  "autodev.explain": async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    let selection: string = editor.document.getText(editor.selection);

    let document = editor.document;
    let input;

    if (selection.length > 0) {
      input = selection;
    } else {
      input = document.getText();
    }

    extension.sidebar.webviewProtocol?.request("userInput", { input });

    vscode.commands.executeCommand("autodev.autodevGUIView.focus");
  },
  "autodev.fixThis": async (
    document: vscode.TextDocument,
    range: NamedElement,
  ) => {
    //
  },
  "autodev.menu.autoComment": async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    let edit = new vscode.WorkspaceEdit();
    let document = editor.document;
    //
    let elementBuilder = await toNamedElementBuilder(document);
    let currentLine = editor.selection.active.line;
    let ranges = elementBuilder.getElementForAction(currentLine);

    if (ranges.length === 0) {
      return;
    }

    await new AutoDocActionExecutor(document, ranges[0], edit).execute();
  },
  "autodev.terminal.explainTerminalSelectionContextMenu": async () => {
    //
  },
  "autodev.action.quickAction": async (
    document: vscode.TextDocument,
    range: NamedElement,
    edit: vscode.WorkspaceEdit
  ) => {
    let quickActionService = QuickActionService.instance();
    await quickActionService.show(extension);
  },
  "autodev.systemAction": async (
    document: vscode.TextDocument,
    range: NamedElement,
    edit: vscode.WorkspaceEdit
  ) => {
    await SystemActionService.instance().show(extension);
  },
  "autodev.git.generateCommitMessage": async () => {
    vscode.extensions.getExtension('vscode.git')?.activate().then((gitExtension) => {
      const gitAPI = gitExtension.getAPI(1);
      const repo = gitAPI.repositories[0];
      const commitMessage = repo.inputBox.value;

      channel.appendLine(`commit message: ${commitMessage}`);
    });
  },
  "autodev.genApiData": async (
    document: vscode.TextDocument,
    range: NamedElement,
    edit: vscode.WorkspaceEdit
  ) => {
    let structurer = extension.structureProvider?.getStructurer(document.languageId);
    if (!structurer) {
      vscode.window.showErrorMessage("No structurer provider found for this language");
      return;
    }

    const file = await structurer.parseFile(document.getText(), document.uri.path);
    if (file !== undefined) {
      const output = new PlantUMLPresenter().present(file);

      let relatedProvider = extension.relatedManager.getRelatedProvider(document.languageId);

      channel.append(`current uml: ${output}`);

      // todo: replace method to really method
      let outputs = await relatedProvider?.inputOutputs(file, file.classes[0].methods[0]);
      if (outputs !== undefined) {
        outputs.map((output) => {
          channel.append(`current outputs: ${JSON.stringify(output)}\n`);
        });
      }
    }
  }
});

export function registerCommands(extension: AutoDevExtension) {
  const commands = commandsMap(extension);
  Object.entries(commands).forEach(([command, handler]) => {
    extension.extensionContext.subscriptions.push(
      vscode.commands.registerCommand(command, handler)
    );
  });
}
