import { spawn, ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { app } from 'electron';
import * as rpc from 'vscode-ws-jsonrpc';

export class JavaLspService {
  private lspProcess: ChildProcess | null = null;
  private wss: any = null;
  private workspaceStateDir: string | null = null;

  private findJavaExecutable(): string {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const javaExe = isWin ? 'java.exe' : 'java';

    // 0. Check for explicit Java 21 (Homebrew) - required for modern JDT.LS
    if (isMac) {
        const brewJava21 = '/opt/homebrew/opt/openjdk@21/bin/java';
        if (existsSync(brewJava21)) {
            console.info(`[JavaLspService] Using Homebrew Java 21: ${brewJava21}`);
            return brewJava21;
        }
    }

    // 1. First, check if there is a system-wide java available and valid
    // On some environments, the embedded JDK might be a Git LFS pointer which causes ENOEXEC.
    try {
        const { execSync } = require('node:child_process');
        const systemJava = execSync(isWin ? 'where java' : 'which java').toString().trim().split('\n')[0];
        if (systemJava && existsSync(systemJava)) {
            // Check if it's a real executable (not an LFS pointer)
            const fs = require('node:fs');
            const stats = fs.statSync(systemJava);
            if (stats.size > 1024) { // LFS pointers are usually < 200 bytes
                console.info(`[JavaLspService] Using system Java: ${systemJava}`);
                return systemJava;
            }
        }
    } catch (e) {
        // ignore errors if java is not in PATH
    }

    // 2. Check embedded JDK
    const resPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    let embeddedJdkPath = join(resPath, 'resources', 'bin', 'jdk');

    if (isMac && existsSync(join(embeddedJdkPath, 'Contents', 'Home'))) {
      embeddedJdkPath = join(embeddedJdkPath, 'Contents', 'Home');
    }

    const javaBin = join(embeddedJdkPath, 'bin', javaExe);
    if (existsSync(javaBin)) {
        // Validation: Ensure it's not an LFS pointer
        const fs = require('node:fs');
        const stats = fs.statSync(javaBin);
        if (stats.size > 1024) {
            return javaBin;
        } else {
            console.warn(`[JavaLspService] Embedded Java at ${javaBin} seems to be a pointer file. Skipping.`);
        }
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
    if (!existsSync(pluginsDir)) {
        throw new Error(`JDT.LS plugins directory not found at ${pluginsDir}`);
    }

    const files = await readdir(pluginsDir);
    const launcherJar = files.find(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));

    if (!launcherJar) throw new Error('JDT.LS launcher jar not found');

    // Validation: Check if launcher JAR is an LFS pointer
    const fs = require('node:fs');
    const launcherPath = join(pluginsDir, launcherJar);
    const stats = fs.statSync(launcherPath);
    if (stats.size < 1024) {
        throw new Error(`JDT.LS launcher JAR at ${launcherPath} is a Git LFS pointer. Please install git-lfs and run 'git lfs pull' to get the real binaries.`);
    }

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

  async prepareProject(code: string): Promise<{ projectDir: string; filePath: string }> {
    const projectDir = await mkdtemp(join(tmpdir(), 'java-proj-'));
    const srcDir = join(projectDir, 'src');
    await mkdir(srcDir, { recursive: true });

    const classMatch = code.match(/public\s+class\s+([a-zA-Z0-9_$]+)/);
    const className = classMatch ? classMatch[1] : 'Main';
    const filePath = join(srcDir, `${className}.java`);

    await writeFile(filePath, code, 'utf8');

    await writeFile(join(projectDir, '.project'), `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
	<name>temp-java-project-${Date.now()}</name>
	<natures><nature>org.eclipse.jdt.core.javanature</nature></natures>
</projectDescription>`, 'utf8');

    await writeFile(join(projectDir, '.classpath'), `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
	<classpathentry kind="src" path="src"/>
	<classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
	<classpathentry kind="output" path="bin"/>
</classpath>`, 'utf8');

    return { projectDir, filePath };
  }

  async startServer(port: number = 5007) {
    if (this.wss) return { success: true, alreadyRunning: true, port };

    try {
      const WS = require('ws');
      const WSS = WS.WebSocketServer || WS.Server || WS;
      this.wss = new WSS({ port, host: '127.0.0.1' });
      console.info(`[JavaLspService] WebSocket Server listening on 127.0.0.1:${port}`);

      const javaBin = this.findJavaExecutable();

      this.wss.on('connection', async (socket: any) => {
        console.info('\n[JavaLspService] Renderer connection established');

        // Use a unique workspace state dir for each connection to avoid Eclipse locks
        const uniqueStateDir = await mkdtemp(join(tmpdir(), 'jdtls-state-'));
        this.workspaceStateDir = uniqueStateDir;

        // socket을 vscode-ws-jsonrpc 호환 객체로 변환
        const rpcSocket = {
            send: (content: string) => socket.send(content, (error: any) => {
                if (error) console.error(error);
            }),
            onMessage: (cb: any) => socket.on('message', (data: any) => cb(data.toString())),
            onError: (cb: any) => socket.on('error', cb),
            onClose: (cb: any) => socket.on('close', cb),
            dispose: () => socket.close()
        };

        const env = { ...process.env };
        const jdkHome = resolve(javaBin, '..', '..');
        let localLspProcess: ChildProcess | null = null;

        try {
            const args = await this.getJdtlsLaunchArgs(javaBin, uniqueStateDir);
            console.info(`\n========== [JDT.LS START ATTEMPT] ==========`);
            console.info(`[JavaLspService] Java Binary: ${javaBin}`);
            console.info(`[JavaLspService] Args:\n  ${args.join('\n  ')}`);

            // JDT.LS 프로세스 실행
            localLspProcess = spawn(javaBin, args, { env, stdio: 'pipe' });
            this.lspProcess = localLspProcess;

            if (localLspProcess && localLspProcess.pid) {
              console.info(`[JavaLspService] -> SUCCESS: Process spawned with PID: ${localLspProcess.pid}\n`);
            }

            localLspProcess.on('error', (err) => console.error('\n[JavaLspService] ! PROCESS SPAWN ERROR !', err));
            localLspProcess.on('exit', (code, signal) => {
                console.warn(`\n[JavaLspService] Process EXITED. Code: ${code}, Signal: ${signal}\n`);
                // cleanup state dir after exit
                rm(uniqueStateDir, { recursive: true, force: true }).catch(() => {});
            });

            if (localLspProcess) {
              localLspProcess.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                // 너무 많은 로그가 찍히는 것을 방지, 심각한 에러나 초기 정보만 출력
                if (msg.includes('ERROR') || msg.includes('WARNING') || msg.includes('Exception')) {
                  console.log(`[JDT.LS LOG] ${msg}`);
                }
              });

              // LSP 브릿징 (WebSocket <-> Process stdio)
              // vscode-ws-jsonrpc의 server 모듈을 사용하여 직접 파이핑 연결
              const serverRpc = require('vscode-ws-jsonrpc/server');
              if (serverRpc.createWebSocketConnection && serverRpc.createProcessStreamConnection) {
                  const socketConnection = serverRpc.createWebSocketConnection(rpcSocket);
                  const serverConnection = serverRpc.createProcessStreamConnection(localLspProcess);

                  if (serverConnection) {
                      serverConnection.forward(socketConnection, (message: any) => {
                          // console.log('[LSP MAIN <- SERVER]', JSON.stringify(message).substring(0, 500));
                          return message;
                      });
                      socketConnection.forward(serverConnection, (message: any) => {
                          // console.log('[LSP MAIN -> SERVER]', JSON.stringify(message).substring(0, 500));
                          return message;
                      });

                      serverConnection.onClose(() => socketConnection.dispose());
                      socketConnection.onClose(() => serverConnection.dispose());
                      console.info('[JavaLspService] -> SUCCESS: JSON-RPC Bridge Attached.');
                  }
              } else {
                  console.error('[JavaLspService] Could not find stream connection methods in vscode-ws-jsonrpc');
              }
            }
        } catch (e) {
            console.error('\n[JavaLspService] ! LAUNCH ERROR !', e);
        }

        socket.on('close', () => {
          console.info('[JavaLspService] WebSocket connection closed by Renderer');
          if (localLspProcess) {
            localLspProcess.kill();
          }
        });
      });

      return { success: true, port };
    } catch (error: any) {
      console.error('[JavaLspService] Bootstrap error:', error);
      return { success: false, error: error.message };
    }
  }

  async stopServer() {
    if (this.wss) this.wss.close();
    if (this.lspProcess) this.lspProcess.kill();
    if (this.workspaceStateDir) {
      await rm(this.workspaceStateDir, { recursive: true, force: true }).catch(() => {});
    }
    return { success: true };
  }
}

export const javaLspService = new JavaLspService();
