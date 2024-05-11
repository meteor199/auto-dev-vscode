import * as vscode from "vscode";

import { AutoDevWebviewViewProvider } from "./editor/webview/AutoDevWebviewViewProvider";
import { VSCodeAction } from "./editor/editor-api/VSCodeAction";
import { RecentlyDocumentManager } from "./editor/document/RecentlyDocumentManager";
import { DiffManager } from "./editor/diff/DiffManager";
import { StructurerProviderManager } from "./code-context/StructurerProviderManager";
import { CodebaseIndexer } from "./code-search/CodebaseIndexer";
import { AutoDevWebviewProtocol } from "./editor/webview/AutoDevWebviewProtocol";
import { LocalEmbeddingProvider } from "./code-search/embedding/LocalEmbeddingProvider";
import { SqliteDb } from "./code-search/database/SqliteDb";
import { getExtensionUri } from "./context";
import { channel } from "./channel";

export class AutoDevExtension {
	// the WebView for interacting with the editor
	sidebar: AutoDevWebviewViewProvider;
	ideAction: VSCodeAction;
	diffManager: DiffManager;
	documentManager: RecentlyDocumentManager;
	extensionContext: vscode.ExtensionContext;
	structureProvider: StructurerProviderManager | undefined;
	indexer: CodebaseIndexer | undefined;
	private webviewProtocol: AutoDevWebviewProtocol;

	constructor(
		sidebar: AutoDevWebviewViewProvider,
		action: VSCodeAction,
		documentManager: RecentlyDocumentManager,
		diffManager: DiffManager,
		context: vscode.ExtensionContext) {
		this.sidebar = sidebar;
		this.ideAction = action;
		this.diffManager = diffManager;
		this.documentManager = documentManager;
		this.extensionContext = context;

		this.webviewProtocol = this.sidebar.webviewProtocol;
	}

	public async indexing() {
		try {
			let sqliteDb = await SqliteDb.get();
		} catch (e) {
			console.log(e);
		}

		// waiting for index command
		let dirs = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath);
		if (dirs) {
			channel.appendLine("start indexing dirs:" + dirs);
			let localInference = new LocalEmbeddingProvider();
			let fsPath = getExtensionUri().fsPath;
			localInference.init(fsPath).then(() => {
				this.indexer = new CodebaseIndexer(localInference, this.ideAction);
				this.refreshCodebaseIndex(dirs).then(r => {
				});
			});
		}
	}

	private indexingCancellationController: AbortController | undefined;

	private async refreshCodebaseIndex(dirs: string[]) {
		if (this.indexingCancellationController) {
			this.indexingCancellationController.abort();
		}

		const that = this;

		this.indexingCancellationController = new AbortController();
		for await (const update of this.indexer!!.refresh(dirs, this.indexingCancellationController.signal)) {
			channel.appendLine("indexing progress: " + update.progress + " - " + update.desc);
			that.webviewProtocol?.request("indexProgress", update);
		}
	}
}
