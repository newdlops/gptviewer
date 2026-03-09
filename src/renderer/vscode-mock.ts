// Mock vscode API for vscode-languageclient in Webpack
export const workspace = {
    textDocuments: [],
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} }),
    onWillSaveTextDocument: () => ({ dispose: () => {} }),
    onDidSaveTextDocument: () => ({ dispose: () => {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    getConfiguration: () => ({ get: () => undefined })
};
export const window = {
    visibleTextEditors: [],
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
    onDidChangeVisibleTextEditors: () => ({ dispose: () => {} }),
    onDidChangeTextEditorSelection: () => ({ dispose: () => {} }),
    onDidChangeTextEditorVisibleRanges: () => ({ dispose: () => {} }),
    onDidChangeTextEditorOptions: () => ({ dispose: () => {} }),
    onDidChangeTextEditorViewColumn: () => ({ dispose: () => {} }),
    showErrorMessage: (m: string) => Promise.resolve(),
    showWarningMessage: (m: string) => Promise.resolve(),
    showInformationMessage: (m: string) => Promise.resolve(),
    createOutputChannel: () => ({
        name: 'Java LSP',
        append: () => {},
        appendLine: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {}
    })
};
export const languages = {
    match: () => 10,
    createDiagnosticCollection: () => ({
        name: 'mock',
        set: () => {},
        delete: () => {},
        clear: () => {},
        forEach: () => {},
        get: () => [],
        has: () => false,
        dispose: () => {}
    })
};
export const commands = {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve(),
    getCommands: () => Promise.resolve([])
};
export const env = {
    machineId: 'mock-machine-id',
    sessionId: 'mock-session-id',
    language: 'en',
    appRoot: '/',
    uriScheme: 'vscode',
    clipboard: {
        readText: () => Promise.resolve(''),
        writeText: () => Promise.resolve()
    }
};
export const Uri = {
    parse: (url: string) => ({ toString: () => url, fsPath: url })
};
export const Disposable = {
    from: () => ({ dispose: () => {} })
};
export class EventEmitter<T> {
    event = () => ({ dispose: () => {} });
    fire() {}
}
export const ExtensionKind = { UI: 1, Workspace: 2 };
export const SymbolKind = { File: 1, Module: 2, Namespace: 3, Package: 4, Class: 5, Method: 6, Property: 7, Field: 8, Constructor: 9, Enum: 10, Interface: 11, Function: 12, Variable: 13, Constant: 14, String: 15, Number: 16, Boolean: 17, Array: 18, Object: 19, Key: 20, Null: 21, EnumMember: 22, Struct: 23, Event: 24, Operator: 25, TypeParameter: 26 };
export const SymbolTag = { Deprecated: 1 };
