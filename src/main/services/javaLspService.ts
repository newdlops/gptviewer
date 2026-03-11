import { spawn, ChildProcess, execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { app } from 'electron';
import * as WS from 'ws';
// @ts-ignore
import * as serverRpc from 'vscode-ws-jsonrpc/server';

export class JavaLspService {
  private lspProcess: ChildProcess | null = null;
  private wss: WS.Server | null = null;
  private workspaceStateDir: string | null = null;

  public findJavaExecutable(): string {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const javaExe = isWin ? 'java.exe' : 'java';

    if (isMac) {
        const brewJava21 = '/opt/homebrew/opt/openjdk@21/bin/java';
        if (existsSync(brewJava21)) {
            console.info(`[JavaLspService] Using Homebrew Java 21: ${brewJava21}`);
            return brewJava21;
        }
    }

    try {
        const { execSync } = require('node:child_process');
        const systemJava = execSync(isWin ? 'where java' : 'which java').toString().trim().split('\n')[0];
        if (systemJava && existsSync(systemJava)) {
            const fs = require('node:fs');
            const stats = fs.statSync(systemJava);
            if (stats.size > 1024) {
                console.info(`[JavaLspService] Using system Java: ${systemJava}`);
                return systemJava;
            }
        }
    } catch (e) {
        // ignore
    }

    const resPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    let embeddedJdkPath = join(resPath, 'resources', 'bin', 'jdk');

    if (isMac && existsSync(join(embeddedJdkPath, 'Contents', 'Home'))) {
      embeddedJdkPath = join(embeddedJdkPath, 'Contents', 'Home');
    }

    const javaBin = join(embeddedJdkPath, 'bin', javaExe);
    if (existsSync(javaBin)) {
        const fs = require('node:fs');
        const stats = fs.statSync(javaBin);
        if (stats.size > 1024) return javaBin;
    }

    if (process.env.JAVA_HOME) {
      const homeJava = join(process.env.JAVA_HOME, 'bin', javaExe);
      if (existsSync(homeJava)) return homeJava;
    }

    return javaExe;
  }

  private async getJdtlsLaunchArgs(javaBin: string, workspaceDir: string): Promise<string[]> {
    const resPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const jdtlsRoot = join(resPath, 'resources', 'bin', 'jdtls');
    const pluginsDir = join(jdtlsRoot, 'plugins');

    if (!existsSync(pluginsDir)) throw new Error(`JDT.LS plugins directory not found at ${pluginsDir}`);

    const files = await readdir(pluginsDir);
    const launcherJar = files.find(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
    if (!launcherJar) throw new Error('JDT.LS launcher jar not found');

    let configFolderName = 'config_mac';
    if (process.platform === 'win32') configFolderName = 'config_win';
    else if (process.platform === 'linux') configFolderName = 'config_linux';

    if (process.platform === 'darwin' && process.arch === 'arm64') {
        const armConfig = 'config_mac_arm';
        if (existsSync(join(jdtlsRoot, armConfig))) configFolderName = armConfig;
    }

    const jdkHome = resolve(javaBin, '..', '..');

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
      `-Dorg.eclipse.jdt.ls.vm.home=${jdkHome}`,
      '-jar', join(pluginsDir, launcherJar),
      '-configuration', join(jdtlsRoot, configFolderName),
      '-data', workspaceDir
    ];
  }

  async prepareProject(code: string, snapshot?: Record<string, string>): Promise<{ projectDir: string; filePath: string }> {
    const projectDir = await mkdtemp(join(tmpdir(), 'java-proj-'));
    const srcDir = join(projectDir, 'src');
    await mkdir(srcDir, { recursive: true });

    let mainFilePath = '';

    if (snapshot && Object.keys(snapshot).length > 0) {
      // 스냅샷이 있는 경우 전체 파일 복원
      for (const [relPath, content] of Object.entries(snapshot)) {
        const fullPath = join(projectDir, relPath);
        const dirPath = resolve(fullPath, '..');
        if (!existsSync(dirPath)) {
          await mkdir(dirPath, { recursive: true });
        }
        await writeFile(fullPath, content, 'utf8');
        
        // 원본 코드와 일치하는 파일이거나 Main.java 형태인 것을 초기 파일로 잡음
        if (relPath.endsWith('.java') && !mainFilePath) {
          mainFilePath = fullPath;
        }
      }
    } else {
      // 스냅샷이 없는 경우 기존처럼 단일 파일 생성
      const classMatch = code.match(/public\s+class\s+([a-zA-Z0-9_$]+)/);
      const className = classMatch ? classMatch[1] : 'Main';
      mainFilePath = join(srcDir, `${className}.java`);
      await writeFile(mainFilePath, code, 'utf8');
    }

    await writeFile(join(projectDir, '.project'), `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
	<name>temp-java-project-${Date.now()}</name>
	<natures><nature>org.eclipse.jdt.core.javanature</nature></natures>
</projectDescription>`, 'utf8');

    await writeFile(join(projectDir, '.classpath'), `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
	<classpathentry kind="src" path="src"/>
	<classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-21"/>
	<classpathentry kind="output" path="bin"/>
</classpath>`, 'utf8');

    return { projectDir, filePath: mainFilePath };
  }

  async getProjectSnapshot(projectDir: string): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // .metadata, bin 같은 불필요한 폴더는 제외
          if (!['.metadata', 'bin'].includes(entry.name)) {
            await walk(fullPath);
          }
        } else {
          // 사용자 소스코드(src 폴더 내부 등)와 관련 없는 설정 파일 제외
          if (!['.project', '.classpath'].includes(entry.name) && fullPath.includes(join(projectDir, 'src'))) {
            const relPath = fullPath.replace(projectDir, '').replace(/^[/\\]/, '');
            snapshot[relPath] = await readFile(fullPath, 'utf8');
          }
        }
      }
    };
    try {
      if (existsSync(projectDir)) {
        await walk(projectDir);
      }
    } catch (e) {
      console.error('[JavaLspService] Failed to create project snapshot', e);
    }
    return snapshot;
  }

  async updateProjectFile(filePath: string, code: string): Promise<{ success: boolean }> {
    try {
        await writeFile(filePath, code, 'utf8');
        return { success: true };
    } catch (e) {
        console.error('[JavaLspService] Failed to update project file:', e);
        return { success: false };
    }
  }

  async createProjectFile(projectDir: string, relativePath: string, content: string = ''): Promise<{ success: boolean, error?: string }> {
    try {
      const fullPath = resolve(projectDir, relativePath);
      if (!fullPath.startsWith(resolve(projectDir))) return { success: false, error: 'Invalid path' };
      
      const dirPath = resolve(fullPath, '..');
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }
      
      if (existsSync(fullPath)) return { success: false, error: 'File already exists' };
      await writeFile(fullPath, content, 'utf8');
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async createProjectDirectory(projectDir: string, relativePath: string): Promise<{ success: boolean, error?: string }> {
    try {
      const fullPath = resolve(projectDir, relativePath);
      if (!fullPath.startsWith(resolve(projectDir))) return { success: false, error: 'Invalid path' };
      
      if (existsSync(fullPath)) return { success: false, error: 'Directory already exists' };
      await mkdir(fullPath, { recursive: true });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async deleteProjectPath(projectDir: string, relativePath: string): Promise<{ success: boolean, error?: string }> {
    try {
      const fullPath = resolve(projectDir, relativePath);
      if (!fullPath.startsWith(resolve(projectDir))) return { success: false, error: 'Invalid path' };
      
      if (!existsSync(fullPath)) return { success: false, error: 'Path not found' };
      await rm(fullPath, { recursive: true, force: true });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async renameProjectPath(projectDir: string, oldRelativePath: string, newRelativePath: string): Promise<{ success: boolean, error?: string }> {
    try {
      const oldPath = resolve(projectDir, oldRelativePath);
      const newPath = resolve(projectDir, newRelativePath);
      
      if (!oldPath.startsWith(resolve(projectDir)) || !newPath.startsWith(resolve(projectDir))) {
        return { success: false, error: 'Invalid path' };
      }
      
      if (!existsSync(oldPath)) return { success: false, error: 'Source path not found' };
      if (existsSync(newPath)) return { success: false, error: 'Target path already exists' };
      
      const { rename } = require('node:fs/promises');
      await rename(oldPath, newPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async readProjectFile(filePath: string): Promise<string> {
    try {
      console.info(`[JavaLspService] Reading file: ${filePath}`);
      if (!existsSync(filePath)) {
        console.error(`[JavaLspService] File does not exist: ${filePath}`);
        return '';
      }
      return await readFile(filePath, 'utf8');
    } catch (e) {
      console.error('[JavaLspService] Failed to read project file:', e);
      return '';
    }
  }

  async getProjectTree(projectDir: string): Promise<any[]> {
    const walk = async (dir: string): Promise<any[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const nodes = await Promise.all(entries.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.replace(projectDir, '').replace(/^\//, '');
        if (entry.isDirectory()) {
          return { name: entry.name, type: 'directory', path: fullPath, relativePath, children: await walk(fullPath) };
        }
        return { name: entry.name, type: 'file', path: fullPath, relativePath };
      }));
      return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    };
    try {
      return await walk(projectDir);
    } catch (e) {
      return [];
    }
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
        this.workspaceStateDir = uniqueStateDir;
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
            this.lspProcess = localLspProcess;
            localLspProcess.on('exit', () => { rm(uniqueStateDir, { recursive: true, force: true }).catch(() => {}); });
            if (localLspProcess) {
              if (serverRpc.createWebSocketConnection && serverRpc.createProcessStreamConnection) {
                  const socketConnection = serverRpc.createWebSocketConnection(rpcSocket);
                  const serverConnection = serverRpc.createProcessStreamConnection(localLspProcess);
                  if (serverConnection) {
                      serverConnection.forward(socketConnection, (message: any) => {
                          console.log('[LSP MAIN <- SERVER]', JSON.stringify(message).substring(0, 500));
                          return message;
                      });
                      socketConnection.forward(serverConnection, (message: any) => {
                          console.log('[LSP MAIN -> SERVER]', JSON.stringify(message).substring(0, 500));
                          return message;
                      });
                      serverConnection.onClose(() => socketConnection.dispose());
                      socketConnection.onClose(() => serverConnection.dispose());
                  }
              }
            }
        } catch (e) { console.error(e); }
        socket.on('close', () => { if (localLspProcess) localLspProcess.kill(); });
      });
      return { success: true, port };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async stopServer() {
    if (this.wss) this.wss.close();
    if (this.lspProcess) this.lspProcess.kill();
    if (this.workspaceStateDir) await rm(this.workspaceStateDir, { recursive: true, force: true }).catch(() => {});
    return { success: true };
  }
}

export const javaLspService = new JavaLspService();
