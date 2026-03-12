import { spawn, ChildProcess, execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile, realpath } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { app } from 'electron';
import * as WS from 'ws';
const serverRpc = require('vscode-ws-jsonrpc/server');

export class JavaLspService {
  private lspProcesses: Set<ChildProcess> = new Set();
  private wss: WS.Server | null = null;
  private debugBridges: Map<number, WS.Server> = new Map(); // tcpPort -> WSS
  private workspaceStateDirs: Set<string> = new Set();

  public findJavaExecutable(): string {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const javaExe = isWin ? 'java.exe' : 'java';

    // 1. Homebrew openjdk@21 (macOS)
    if (isMac) {
      const brewJava = '/opt/homebrew/opt/openjdk@21/bin/java';
      if (existsSync(brewJava)) {
        console.info(`[JavaLspService] Using Homebrew Java 21: ${brewJava}`);
        return brewJava;
      }
    }

    // 2. JAVA_HOME 환경변수
    if (process.env.JAVA_HOME) {
      const javaHomeExe = join(process.env.JAVA_HOME, 'bin', javaExe);
      if (existsSync(javaHomeExe)) return javaHomeExe;
    }

    // 3. 기본 PATH
    try {
      const pathJava = execSync(isWin ? 'where java' : 'which java').toString().trim().split('\n')[0];
      if (existsSync(pathJava)) return pathJava;
    } catch {
      // ignore
    }

    throw new Error('Java 21 실행 파일을 찾을 수 없습니다. (Homebrew openjdk@21 권장)');
  }

  private async getJdtlsLaunchArgs(javaBin: string, stateDir: string): Promise<string[]> {
    const resPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const jdtlsRoot = join(resPath, 'resources', 'bin', 'jdtls');
    const pluginsDir = join(jdtlsRoot, 'plugins');

    const files = await readdir(pluginsDir);
    const launcherJar = files.find(f => f.includes('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
    if (!launcherJar) throw new Error('JDTLS Launcher JAR not found');

    let configFolderName = 'config_mac';
    if (process.platform === 'win32') configFolderName = 'config_win';
    else if (process.platform === 'linux') configFolderName = 'config_linux';

    // ARM 아키텍처 대응
    if (process.arch === 'arm64') {
      const armConfig = `${configFolderName}_arm`;
      if (existsSync(join(jdtlsRoot, armConfig))) configFolderName = armConfig;
    }

    const jdkHome = resolve(javaBin, '..', '..');

    // 확장(extensions) 폴더에서 추가번들(예: java-debug) JAR들을 찾음
    const extensionsDir = join(jdtlsRoot, 'extensions');
    if (existsSync(extensionsDir)) {
      const extFiles = await readdir(extensionsDir);
      const bundles = extFiles.filter(f => f.endsWith('.jar')).map(f => join(extensionsDir, f));
      if (bundles.length > 0) {
        // bundles는 쉼표로 구분된 문자열이어야 함
        // 참고: JDTLS에서 번들을 로드할 때 사용하는 옵션이 있는지 확인 필요
        // 보통 VS Code에서는 initializationOptions.bundles 에 넣어서 보냄
      }
    }

    return [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.protocol=true',
      '-Dlog.level=ALL',
      '-Xmx1G',
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '-jar', join(pluginsDir, launcherJar),
      '-configuration', join(jdtlsRoot, configFolderName),
      '-data', stateDir
    ];
  }

  async prepareProject(code: string, snapshot?: Record<string, string>): Promise<{ projectDir: string, filePath: string }> {
    const tempDir = await mkdtemp(join(tmpdir(), 'java-proj-'));
    const projectDir = await realpath(tempDir).catch(() => tempDir);
    const srcDir = join(projectDir, 'src');
    await mkdir(srcDir, { recursive: true });

    let targetRelPath = '';

    if (snapshot && Object.keys(snapshot).length > 0) {
      for (const [relPath, content] of Object.entries(snapshot)) {
        const fullPath = join(projectDir, relPath);
        await mkdir(resolve(fullPath, '..'), { recursive: true });
        await writeFile(fullPath, content, 'utf8');
        
        if (!targetRelPath && relPath.endsWith('.java')) {
          targetRelPath = relPath;
        }
      }
    } else {
      const match = code.match(/public\s+class\s+([a-zA-Z_$][a-zA-Z\d_$]*)/);
      const className = match ? match[1] : 'Main';
      targetRelPath = join('src', `${className}.java`);
      await writeFile(join(projectDir, targetRelPath), code, 'utf8');
    }

    const mainFilePath = join(projectDir, targetRelPath);

    await writeFile(join(projectDir, '.project'), `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
	<name>temp-java-project</name>
	<natures><nature>org.eclipse.jdt.core.javanature</nature></natures>
</projectDescription>`, 'utf8');

    await writeFile(join(projectDir, '.classpath'), `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
	<classpathentry kind="src" path="src"/>
	<classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-21"/>
	<classpathentry kind="output" path="bin"/>
</classpath>`, 'utf8');

    // macOS 등에서 /var -> /private/var 심볼릭 링크 문제 방지를 위해 realpath 사용
    const realProjectDir = await realpath(projectDir).catch(() => projectDir);
    const realFilePath = await realpath(mainFilePath).catch(() => mainFilePath);

    return { projectDir: realProjectDir, filePath: realFilePath };
  }

  async getProjectSnapshot(projectDir: string): Promise<Record<string, string>> {
    const { realpath } = require('node:fs/promises');
    const realProjDir = await realpath(projectDir);
    
    const snapshot: Record<string, string> = {};
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const realFullPath = await realpath(fullPath);
        
        if (entry.isDirectory()) {
          // .metadata, bin, .settings 등 불필요한 폴더는 제외
          if (!['.metadata', 'bin', '.settings'].includes(entry.name)) {
            await walk(realFullPath);
          }
        } else {
          // 사용자 소스코드 및 설정 파일 포함 (단, IDE 전용 메타데이터 제외)
          if (!['.project', '.classpath'].includes(entry.name)) {
            const relPath = realFullPath.replace(realProjDir, '').replace(/^[/\\]/, '');
            snapshot[relPath] = await readFile(realFullPath, 'utf8');
          }
        }
      }
    };
    try {
      await walk(realProjDir);
    } catch (e) {
      console.error('[JavaLspService] Failed to create project snapshot', e);
    }
    return snapshot;
  }

  async updateProjectFile(filePath: string, code: string): Promise<{ success: boolean }> {
    try {
        const { realpath } = require('node:fs/promises');
        let targetPath = filePath;
        try {
          targetPath = await realpath(filePath);
        } catch {
          // If file doesn't exist yet, we can't get realpath, but writeFile will create it.
        }
        await writeFile(targetPath, code, 'utf8');
        return { success: true };
    } catch (e) {
        console.error('[JavaLspService] Failed to update project file:', e);
        return { success: false };
    }
  }

  async getProjectTree(projectDir: string): Promise<any[]> {
    const buildTree = async (dir: string): Promise<any[]> => {
      const nodes: any[] = [];
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.metadata' || entry.name === 'bin' || entry.name === '.settings') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: 'directory',
            children: await buildTree(fullPath)
          });
        } else {
          nodes.push({ name: entry.name, path: fullPath, type: 'file' });
        }
      }
      return nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });
    };
    try {
      return await buildTree(projectDir);
    } catch (e) {
      console.error('[JavaLspService] Failed to get project tree', e);
      return [];
    }
  }

  async readProjectFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (e) {
      console.error('[JavaLspService] Failed to read project file', e);
      return null;
    }
  }

  async createProjectFile(projectDir: string, relativePath: string, content: string = ''): Promise<{ success: boolean; error?: string }> {
    try {
      const fullPath = join(projectDir, relativePath);
      await mkdir(resolve(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async createProjectDirectory(projectDir: string, relativePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fullPath = join(projectDir, relativePath);
      await mkdir(fullPath, { recursive: true });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async deleteProjectPath(projectDir: string, relativePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fullPath = join(projectDir, relativePath);
      await rm(fullPath, { recursive: true, force: true });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async renameProjectPath(projectDir: string, oldRelativePath: string, newRelativePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fs = require('node:fs/promises');
      const oldPath = join(projectDir, oldRelativePath);
      const newPath = join(projectDir, newRelativePath);
      await mkdir(resolve(newPath, '..'), { recursive: true });
      await fs.rename(oldPath, newPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  public async getBundleJars(): Promise<string[]> {
    const { realpath } = require('node:fs/promises');
    const path = require('node:path');
    const resPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const extensionsDir = await realpath(path.join(resPath, 'resources', 'bin', 'jdtls', 'extensions')).catch(() => path.join(resPath, 'resources', 'bin', 'jdtls', 'extensions'));
    
    console.info(`[JavaLspService] Searching for bundles in: ${extensionsDir}`);
    if (existsSync(extensionsDir)) {
      const files = await readdir(extensionsDir);
      // We are providing a plain absolute path because JDTLS failed with 'file:/' prefix.
      const bundles = files
        .filter(f => f.endsWith('.jar'))
        .map(f => path.join(extensionsDir, f));
      
      console.info(`[JavaLspService] Found ${bundles.length} bundles:`, JSON.stringify(bundles, null, 2));
      return bundles;
    }
    console.warn(`[JavaLspService] Extensions directory not found: ${extensionsDir}`);
    return [];
  }

  async startServer(port = 5007) {
    console.info(`\n[JavaLspService] startServer invoked. Target port: ${port}`);
    if (this.wss) {
        console.info(`[JavaLspService] Server already running on port ${this.wss.options?.port || port}`);
        return { success: true, alreadyRunning: true, port: this.wss.options?.port || port };
    }
    try {
      this.wss = new WS.Server({ port, host: '127.0.0.1' });
      console.info(`[JavaLspService] WebSocket Server listening on 127.0.0.1:${port}`);

      const javaBin = this.findJavaExecutable();
      console.info(`[JavaLspService] Found Java Executable: ${javaBin}`);

      this.wss.on('connection', async (socket: WS.WebSocket) => {
        const uniqueStateDir = await mkdtemp(join(tmpdir(), 'jdtls-state-'));
        this.workspaceStateDirs.add(uniqueStateDir);
        
        const rpcSocket = {
            send: (content: string) => socket.send(content, (error) => { if (error) console.error(error); }),
            onMessage: (cb: (data: string) => void) => socket.on('message', (data) => cb(data.toString())),
            onError: (cb: (error: Error) => void) => socket.on('error', cb),
            onClose: (cb: (code: number, reason: string) => void) => socket.on('close', cb),
            dispose: () => socket.close()
        };
        const env = { ...process.env };
        let localLspProcess: ChildProcess | null = null;
        try {
            const args = await this.getJdtlsLaunchArgs(javaBin, uniqueStateDir);
            localLspProcess = spawn(javaBin, args, { env, stdio: 'pipe' });
            this.lspProcesses.add(localLspProcess);

            // JDTLS 출력 로깅 (디버그 용도) - 로깅 길이 대폭 증가
            localLspProcess.stdout?.on('data', (data) => {
              console.log('[JDTLS STDOUT]', data.toString().substring(0, 10000));
            });
            localLspProcess.stderr?.on('data', (data) => {
              console.error('[JDTLS STDERR]', data.toString().substring(0, 10000));
            });

            localLspProcess.on('exit', () => {
              this.workspaceStateDirs.delete(uniqueStateDir);
              rm(uniqueStateDir, { recursive: true, force: true }).catch(() => {});
              if (localLspProcess) this.lspProcesses.delete(localLspProcess);
            });

            if (localLspProcess) {
              if (serverRpc.createWebSocketConnection && serverRpc.createProcessStreamConnection) {
                  const socketConnection = serverRpc.createWebSocketConnection(rpcSocket);
                  const serverConnection = serverRpc.createProcessStreamConnection(localLspProcess);
                  if (serverConnection) {
                      serverConnection.forward(socketConnection, (message: any) => {
                          return message;
                      });
                      socketConnection.forward(serverConnection, (message: any) => {
                          return message;
                      });
                      serverConnection.onClose(() => socketConnection.dispose());
                      socketConnection.onClose(() => serverConnection.dispose());
                  }
              }
            }
        } catch (e) { console.error(e); }
        socket.on('close', () => {
          if (localLspProcess) {
            localLspProcess.kill();
            this.lspProcesses.delete(localLspProcess);
          }
        });
      });
      return { success: true, port };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async stopServer() {
    if (this.wss) this.wss.close();
    
    for (const bridge of this.debugBridges.values()) {
      bridge.close();
    }
    this.debugBridges.clear();

    for (const proc of this.lspProcesses) {
      proc.kill();
    }
    this.lspProcesses.clear();

    for (const dir of this.workspaceStateDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    this.workspaceStateDirs.clear();

    return { success: true };
  }

  /**
   * TCP 디버그 포트를 WebSocket으로 브릿징합니다.
   * @param tcpPort Java 디버그 서버가 리스닝 중인 TCP 포트
   * @returns 브릿징된 WebSocket 포트
   */
  async startDebugBridge(tcpPort: number): Promise<number> {
    if (this.debugBridges.has(tcpPort)) {
      return (this.debugBridges.get(tcpPort) as any)._server.address().port;
    }

    const wsPort = tcpPort + 1000; // 단순 규칙: TCP 포트 + 1000
    const bridgeWss = new WS.Server({ port: wsPort, host: '127.0.0.1' });
    
    bridgeWss.on('connection', (ws) => {
      const net = require('node:net');
      const tcpClient = net.createConnection({ port: tcpPort, host: '127.0.0.1' });

      // DAP는 Content-Length 헤더가 포함된 프로토콜이거나 생 JSON일 수 있음.
      // 여기서는 바이너리 브릿징을 수행.
      ws.on('message', (data: any) => {
        const length = data.length || data.byteLength || 0;
        console.log(`[DAP Bridge] WS -> TCP (${length} bytes)`);
        if (typeof data === 'string') {
          tcpClient.write(Buffer.from(data, 'utf8'));
        } else if (Buffer.isBuffer(data)) {
          tcpClient.write(data);
        } else {
          tcpClient.write(Buffer.from(data as any));
        }
      });

      tcpClient.on('data', (data: Buffer) => {
        console.log(`[DAP Bridge] TCP -> WS (${data.length} bytes)`);
        if (ws.readyState === WS.OPEN) {
          ws.send(data);
        }
      });

      ws.on('close', () => tcpClient.destroy());
      tcpClient.on('close', () => ws.close());
      ws.on('error', () => tcpClient.destroy());
      tcpClient.on('error', () => ws.close());
    });

    this.debugBridges.set(tcpPort, bridgeWss);
    console.info(`[JavaDebug] DAP Bridge started: TCP ${tcpPort} -> WS ${wsPort}`);
    return wsPort;
  }
}

export const javaLspService = new JavaLspService();
