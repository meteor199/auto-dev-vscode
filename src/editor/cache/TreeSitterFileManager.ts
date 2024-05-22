import { Edit, Point } from "web-tree-sitter";
import vscode, { TextDocumentChangeEvent, Uri } from "vscode";

import { TreeSitterFile } from "../../code-context/ast/TreeSitterFile";
import { isSupportedLanguage } from "../language/SupportedLanguage";
import { DefaultLanguageService } from "../language/service/DefaultLanguageService";
import { PositionUtil } from "../ast/PositionUtil";

export class TreeSitterFileManager implements vscode.Disposable {
	private documentUpdateListener: vscode.Disposable;

	private cache: Map<Uri, TreeSitterFile>;
	private static instance: TreeSitterFileManager;

	public static getInstance(): TreeSitterFileManager {
		if (!TreeSitterFileManager.instance) {
			TreeSitterFileManager.instance = new TreeSitterFileManager();
		}

		return TreeSitterFileManager.instance;
	}

	constructor() {
		this.cache = new Map<Uri, TreeSitterFile>();

		this.documentUpdateListener = vscode.workspace.onDidChangeTextDocument(async (event) => {
			if (!isSupportedLanguage(event.document.languageId)) {
				return;
			}

			await this.updateCacheOnChange(event);
		});
	}

	private async updateCacheOnChange(event: TextDocumentChangeEvent) {
		const uri = event.document.uri;
		let tsfile = this.getDocument(uri);
		const tree = tsfile?.tree;
		if (!tree) {
			if (!this.cache.has(uri)) {
				const file = await TreeSitterFileManager.create(event.document);
				this.setDocument(uri, file);
			}

			return;
		}

		for (const change of event.contentChanges) {
			const editParams = this.createEditParams(change, event.document);
			tree.edit(editParams);
		}

		tsfile!!.update(tree);
		this.setDocument(uri, tsfile!!);
	}

	static async create(document: vscode.TextDocument): Promise<TreeSitterFile> {
		const cached = TreeSitterFileManager.getInstance().getDocument(document.uri);
		if (cached) {
			return cached;
		}

		const src = document.getText();
		const langId = document.languageId;

		const file = await TreeSitterFile.create(src, langId, new DefaultLanguageService(), document.uri.fsPath);
		TreeSitterFileManager.getInstance().setDocument(document.uri, file);
		return file;
	}

	createEditParams(change: vscode.TextDocumentContentChangeEvent, document: vscode.TextDocument): Edit {
		const startIndex = change.rangeOffset;
		const oldEndIndex = change.rangeOffset + change.rangeLength;
		const newEndIndex = change.rangeOffset + change.text.length;
		const startPosition = document.positionAt(startIndex);
		const oldEndPosition = document.positionAt(oldEndIndex);
		const newEndPosition = document.positionAt(newEndIndex);

		return {
			startIndex: startIndex,
			oldEndIndex: oldEndIndex,
			newEndIndex: newEndIndex,
			startPosition: PositionUtil.toPoint(startPosition),
			oldEndPosition: PositionUtil.toPoint(oldEndPosition),
			newEndPosition: PositionUtil.toPoint(newEndPosition),
		};
	}

	dispose() {
		this.documentUpdateListener?.dispose();
	}

	public setDocument(uri: Uri, file: TreeSitterFile): void {
		this.cache.set(uri, file);
	}

	/**
	 * If you want to get doc with cache, please use `documentToTreeSitterFile` instead
	 * @param uri
	 */
	public getDocument(uri: Uri): TreeSitterFile | undefined {
		return this.cache.get(uri);
	}
}
