import { MonacoLanguageClient, MonacoServices } from 'monaco-languageclient';
import { CloseAction, ErrorAction } from 'vscode-languageclient';
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from 'vscode-ws-jsonrpc';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

let isServicesInstalled = false;

export async function createJavaLanguageClient(port: number, projectDir: string): Promise<MonacoLanguageClient> {
    if (!isServicesInstalled) {
        MonacoServices.install(monaco as any);
        isServicesInstalled = true;
    }

    const url = `ws://127.0.0.1:${port}`;
    console.info(`\n========== [LSP CLIENT START ATTEMPT] ==========`);
    console.info(`[JavaLspClient] Target URL: ${url}`);
    console.info(`[JavaLspClient] Workspace: ${projectDir}`);

    const webSocket = new WebSocket(url);

    return new Promise((resolve, reject) => {
        webSocket.onopen = async () => {
            console.info('[JavaLspClient] -> SUCCESS: WebSocket connection opened');

            // v4 API
            const socket = toSocket(webSocket);
            const reader = new WebSocketMessageReader(socket);
            const writer = new WebSocketMessageWriter(socket);

            try {
                console.info('[JavaLspClient] Creating MonacoLanguageClient (v4)...');
                const languageClient = createMonacoLanguageClient({ reader, writer }, projectDir);

                // Await start() to ensure client is running before resolve
                await languageClient.start();
                console.info('[JavaLspClient] -> SUCCESS: Language Client started and attached to Monaco.\n');

                reader.onClose(() => {
                    console.warn('\n[JavaLspClient] WebSocket connection CLOSED by server.');
                    // state를 확인하고 stop() 호출
                    if (languageClient.isRunning()) {
                        languageClient.stop();
                    }
                });
                resolve(languageClient);
            } catch (err) {
                console.error('\n[JavaLspClient] !!!!!!!!! CLIENT CREATION ERROR !!!!!!!!!');
                console.error(err);
                reject(err);
            }
        };

        webSocket.onerror = (error) => {
            console.error('\n[JavaLspClient] !!!!!!!!! WEBSOCKET CONNECTION ERROR !!!!!!!!!');
            console.error(error);
            reject(new Error('WebSocket connection failed'));
        };

        setTimeout(() => {
            if (webSocket.readyState !== WebSocket.OPEN) {
                console.error(`\n[JavaLspClient] !!!!!!!!! WEBSOCKET TIMEOUT !!!!!!!!!`);
                webSocket.close();
                reject(new Error('WebSocket connection timeout'));
            }
        }, 15000);
    });
}

function createMonacoLanguageClient(transports: any, projectDir: string): MonacoLanguageClient {
    return new MonacoLanguageClient({
        name: 'Java Language Client',
        clientOptions: {
            documentSelector: ['java'], // v4는 단순 string array 허용
            workspaceFolder: {
                uri: monaco.Uri.parse(`file://${projectDir}`) as any,
                name: 'temp-java-project',
                index: 0
            } as any,
            initializationOptions: {
                settings: {
                    java: {
                        configuration: { updateBuildConfiguration: "disabled" },
                        format: { enabled: true }
                    }
                }
            },
            errorHandler: {
                error: () => ({ action: ErrorAction.Continue }),
                closed: () => ({ action: CloseAction.DoNotRestart })
            }
        },
        connectionProvider: {
            get: () => Promise.resolve(transports)
        }
    });
}
