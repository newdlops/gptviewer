// Mock vscode API for vscode-languageclient in Webpack
export const workspace: any = {
    textDocuments: [],
    workspaceFolders: [],
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} }),
    onWillSaveTextDocument: () => ({ dispose: () => {} }),
    onDidSaveTextDocument: () => ({ dispose: () => {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    getConfiguration: (): any => ({ get: (): any => undefined }),
    applyEdit: () => Promise.resolve(true)
};
export const window: any = {
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
    showTextDocument: () => Promise.resolve(),
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
export const languages: any = new Proxy({
    match: () => 10,
    createDiagnosticCollection: () => ({
        name: 'mock',
        set: () => {},
        delete: () => {},
        clear: () => {},
        forEach: () => {},
        get: (): any[] => [],
        has: () => false,
        dispose: () => {}
    })
}, {
    get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        if (typeof prop === 'string' && prop.startsWith('register')) {
            return () => new Disposable(() => {});
        }
        return undefined;
    }
});
export const commands: any = {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve(),
    getCommands: () => Promise.resolve([])
};
export const env: any = {
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
export const Uri: any = {
    parse: (url: string) => ({ toString: () => url, fsPath: url }),
    file: (path: string) => ({ toString: () => `file://${path}`, fsPath: path, scheme: 'file' })
};
export class Disposable {
    constructor(callOnDispose: () => any) {}
    dispose() {}
    static from(...disposableInstances: any[]) {
        return new Disposable(() => {});
    }
}
export class EventEmitter<T> {
    event = (listener: (e: T) => any, thisArgs?: any, disposables?: any[]) => {
        return { dispose: () => {} };
    };
    fire(data?: T) {}
    dispose() {}
}
export const ExtensionKind = { UI: 1, Workspace: 2 };
export const SymbolKind = { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 };
export const CompletionItemKind = { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13, Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20, Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 };
export const SymbolTag = { Deprecated: 1 };
export class CancellationError extends Error {}
export class Position {
    constructor(public line: number, public character: number) {}
}
export class Range {
    constructor(public start: Position, public end: Position) {}
}
export class Location {
    constructor(public uri: any, public range: Range) {}
}
export class Diagnostic {
    constructor(public range: Range, public message: string, public severity?: any) {}
}
export class CompletionItem {
    constructor(public label: string, public kind?: any) {}
}
export class SymbolInformation {
    constructor(public name: string, public kind: any, public containerName: string, public location: Location) {}
}
export class DocumentLink {
    constructor(public range: Range, public target?: any) {}
}
export class CodeLens {
    constructor(public range: Range, public command?: any) {}
}
export class InlayHint {
    constructor(public position: Position, public label: string | any[], public kind?: any) {}
}
export class CallHierarchyItem {
    constructor(public kind: any, public name: string, public detail: string, public uri: any, public range: Range, public selectionRange: Range) {}
}
export class TypeHierarchyItem {
    constructor(public kind: any, public name: string, public detail: string, public uri: any, public range: Range, public selectionRange: Range) {}
}
export class CodeAction {
    constructor(public title: string, public kind?: any) {}
}
export class FoldingRange {
    constructor(public start: number, public end: number, public kind?: any) {}
}
export class SignatureHelp {
    constructor() { this.signatures = []; this.activeSignature = 0; this.activeParameter = 0; }
    signatures: any[];
    activeSignature: number;
    activeParameter: number;
}
export class SignatureInformation {
    constructor(public label: string, public documentation?: string | any) { this.parameters = []; }
    parameters: any[];
}
export class ParameterInformation {
    constructor(public label: string | [number, number], public documentation?: string | any) {}
}
export const CodeActionKind = { Empty: { value: '' }, QuickFix: { value: 'quickfix' }, Refactor: { value: 'refactor' }, RefactorExtract: { value: 'refactor.extract' }, RefactorInline: { value: 'refactor.inline' }, RefactorRewrite: { value: 'refactor.rewrite' }, Source: { value: 'source' }, SourceOrganizeImports: { value: 'source.organizeImports' }, SourceFixAll: { value: 'source.fixAll' } };
export const Services = {
    install: (services: any) => ({ dispose: () => {} }),
    get: () => ({})
};
export const Severity = {
    Ignore: 0,
    Info: 1,
    Warning: 2,
    Error: 3
};
