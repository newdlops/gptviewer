type IdleCallback = (deadline: IdleDeadlineLike) => void;

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type QueuedTask<T> = {
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
  run: () => Promise<T>;
  taskKey: string;
};

const FALLBACK_IDLE_DELAY_MS = 32;
const pendingTaskQueue: Array<QueuedTask<unknown>> = [];
const queuedTaskPromiseStore = new Map<string, Promise<unknown>>();

let activeTask: QueuedTask<unknown> | null = null;
let idleHandle: ReturnType<typeof globalThis.setTimeout> | number | null = null;

type IdleCapableWindow = Window &
  typeof globalThis & {
    cancelIdleCallback?: (handle: number) => void;
    requestIdleCallback?: (
      callback: IdleCallback,
      options?: { timeout?: number },
    ) => number;
  };

const createFallbackIdleDeadline = (): IdleDeadlineLike => ({
  didTimeout: false,
  timeRemaining: () => 0,
});

const cancelIdleTask = () => {
  if (idleHandle === null) {
    return;
  }

  const idleWindow = window as IdleCapableWindow;

  if (typeof idleWindow.cancelIdleCallback === 'function') {
    idleWindow.cancelIdleCallback(idleHandle as number);
  } else {
    globalThis.clearTimeout(idleHandle);
  }

  idleHandle = null;
};

const requestIdleTask = (callback: IdleCallback) => {
  const idleWindow = window as IdleCapableWindow;

  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleHandle = idleWindow.requestIdleCallback(callback, {
      timeout: FALLBACK_IDLE_DELAY_MS,
    });
    return;
  }

  idleHandle = globalThis.setTimeout(() => {
    callback(createFallbackIdleDeadline());
  }, FALLBACK_IDLE_DELAY_MS);
};

const pumpQueue = () => {
  if (activeTask || pendingTaskQueue.length === 0 || idleHandle !== null) {
    return;
  }

  requestIdleTask(async () => {
    idleHandle = null;

    if (activeTask || pendingTaskQueue.length === 0) {
      return;
    }

    const nextTask = pendingTaskQueue.shift();

    if (!nextTask) {
      return;
    }

    activeTask = nextTask;

    try {
      const result = await nextTask.run();
      nextTask.resolve(result);
    } catch (error) {
      nextTask.reject(error);
    } finally {
      queuedTaskPromiseStore.delete(nextTask.taskKey);
      activeTask = null;
      pumpQueue();
    }
  });
};

export const queueMermaidRenderTask = <T>(
  taskKey: string,
  run: () => Promise<T>,
): Promise<T> => {
  const existingPromise = queuedTaskPromiseStore.get(taskKey);

  if (existingPromise) {
    return existingPromise as Promise<T>;
  }

  const nextPromise = new Promise<T>((resolve, reject) => {
    pendingTaskQueue.push({
      reject,
      resolve,
      run,
      taskKey,
    });
    pumpQueue();
  });

  queuedTaskPromiseStore.set(taskKey, nextPromise);
  return nextPromise;
};

export const clearQueuedMermaidRenderTasks = () => {
  cancelIdleTask();

  while (pendingTaskQueue.length > 0) {
    const nextTask = pendingTaskQueue.shift();

    if (!nextTask) {
      continue;
    }

    queuedTaskPromiseStore.delete(nextTask.taskKey);
    nextTask.reject(new Error('Mermaid render task was cancelled.'));
  }
};
